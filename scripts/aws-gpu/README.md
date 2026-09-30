# scripts/aws-gpu - run the browser checks on a rented AWS GPU

The checks in `scripts/verify` need a real GPU. This laptop has one, but only
one full-app 3D browser fits in it at a time, so the checks queue. `scripts/
colab` already runs them on a rented Colab L4. This does the same on AWS, for
when the AWS credits are the ones available.

The current AWS quota is **8 vCPUs for G instances in us-east-1**: enough for
one `g6.2xlarge` (1x NVIDIA L4, 8 vCPU) or one `g5.2xlarge` (1x NVIDIA A10G,
8 vCPU), or two `*.xlarge`.

`launch` starts one instance from the Deep Learning Base GPU AMI (the NVIDIA
driver is already installed, so unlike Colab we do not unpack it), bakes the
run's inputs into `user-data`, and the instance installs Chrome, Node and
Playwright, clones the repo at a ref, serves it with `scripts/serve.py`, runs
the checks up to four in parallel, ships the results, and shuts itself down.

## Files here

- `launch` - AWS CLI v2 / bash. Resolves the AMI, renders `user-data`, runs one
  instance. `--print` prints every `aws` command and runs nothing; `--dry-run`
  passes `--dry-run` to `run-instances` so AWS validates permissions without
  launching.
- `user-data` - the cloud-init boot script that turns a fresh instance into a
  check runner and terminates it when done.
- `teardown` - one command that terminates every running instance tagged
  `project=flyover` and lists any leftover volumes or buckets.
- `iam-operator-policy.json` - least-privilege policy for the person/CLI that
  launches and tears down.
- `iam-instance-policy.json` - the policy attached to the instance's own role,
  so it can write results to the S3 bucket and nothing else.
- `test-offline` - the checks that pass with no AWS account and no network.

## Guardrails (all on by default, hard to forget)

- **Terminate on shutdown.** The instance is launched with
  `instance-initiated-shutdown-behavior=terminate`, so any `shutdown -h` ends
  the instance rather than just stopping it (a stopped GPU instance still bills
  for its EBS volume).
- **Hard maximum runtime.** `user-data` runs `shutdown -h +60` as its first real
  action (before the slow install/clone), so nothing that hangs later can
  outlive the cap. Default 60 minutes; `--max-runtime N` or
  `AWS_GPU_MAX_RUNTIME_MIN`.
- **Idle watchdog.** A background loop shuts the box down after 20 minutes with
  no check running (a heartbeat file is touched around each check). Default 20
  minutes; `--idle-timeout N` or `AWS_GPU_IDLE_TIMEOUT_MIN`.
- **`project=flyover` on the instance AND its volumes**, via `TagSpecifications`,
  so a forgotten disk is still findable and `teardown` can list it.
- **SwiftShader is a failure.** The run records the WebGL renderer string and
  fails if it says SwiftShader - a green suite on a CPU rasteriser is a lie.

Always run `./teardown` after a session (or any time) to be sure nothing is
left running.

## Prices

On-demand Linux, US East (N. Virginia), from AWS's public price list published
2026-09-25:

| Instance    | GPU              | vCPU | On-demand $/h |
|-------------|------------------|------|---------------|
| g4dn.xlarge | 1x T4            | 4    | 0.526         |
| g4dn.2xlarge| 1x T4            | 8    | 0.752         |
| g6.xlarge   | 1x L4            | 4    | 0.8048        |
| g6.2xlarge  | 1x L4            | 8    | 0.9776        |
| g6.4xlarge  | 1x L4            | 16   | 1.3232        |
| g5.xlarge   | 1x A10G          | 4    | 1.006         |
| g5.2xlarge  | 1x A10G          | 8    | 1.212         |

The default `g6.2xlarge` is about **$0.98/hour**, so a run capped at 60 minutes
costs at most about a dollar, usually much less because the idle watchdog and
the explicit shutdown at the end of a run end the instance early. The
`g5.2xlarge` fallback is about **$1.21/hour**. Spot pricing is lower but was not
used here, to keep the first runs simple and predictable.

## Browsers per box (expected, not measured)

These are **expectations**, not measured on AWS yet - the first real run
confirms them. For reference, a Colab **L4 with 12 CPUs** held **4** full-city
browsers at 16-26 fps. The `g6.2xlarge` has the same L4 GPU but **8** vCPUs, so
expect it to hold **about 4** browsers as well, with the CPU (not the GPU) as
the limit; the default concurrency is 4. The `g5.2xlarge` (A10G, 8 vCPU) has a
larger GPU and should hold at least as many. A `*.xlarge` (4 vCPU) should be
kept to 1-2 concurrent browsers.

## Results come back through S3

The instance writes each check's `stdout.txt`, exit code, any screenshots, a
`manifest.json` and the boot log to `s3://<bucket>/flyover-runs/<ref>-<id>/`.
Set the bucket with `--bucket` or `AWS_GPU_RESULT_BUCKET`. If no bucket is set,
results stay on the instance only (useful with `--dry-run` or SSM debugging).

Permissions this needs:

- The **instance role** (`iam-instance-policy.json`) allows only
  `s3:PutObject` on `arn:aws:s3:::<bucket>/flyover-runs/*`. Nothing else.
- The **operator** (`iam-operator-policy.json`) allows `s3:ListBucket` and
  `s3:GetObject` on the same prefix, to read results back.

S3 was chosen over `scp`/SSM copy because it needs no inbound port and no SSH
key on the instance: the instance pushes out through its role, and the box can
terminate the moment the upload finishes. To read results back:

```
aws s3 cp --recursive s3://<bucket>/flyover-runs/<ref>-<id>/ ./aws-out
```

## Running

```
./launch --ref main \
    --check graphics.mjs \
    --check "movement.mjs --report" \
    --bucket my-flyover-results
```

- `--ref` any git ref (branch, tag, full sha); shallow-cloned on the instance.
- `--check` one `scripts/verify/*.mjs` check with its args, quoted; repeatable.
  Up to `--parallel` (default 4) run at once.
- `--bucket` the S3 bucket for results.
- `--print` print the `aws` commands and run nothing.
- `--dry-run` ask AWS to validate `run-instances` without launching.

Every default is one environment variable or flag away from being overridden;
see the top of `launch`.

## The owner's one-time setup

Do this once, before the first real run.

1. **Create a least-privilege identity.** In IAM Identity Center, create a user
   and a permission set (or, with plain IAM, an IAM user) and attach the policy
   in `iam-operator-policy.json`. Before attaching, replace the two
   placeholders: `ACCOUNT_ID` with the AWS account number and
   `RESULT_BUCKET_NAME` with the results bucket name. The policy allows only:
   read-only `Describe*`; reading the Deep Learning AMI SSM parameter;
   `RunInstances` in `us-east-1` only; `CreateTags` only as part of a launch;
   `TerminateInstances` and `DeleteVolume` only on `project=flyover` resources;
   `PassRole` only for the runner instance role; and read access to the results
   bucket prefix.

2. **Create the instance role.** Create an IAM role named `flyover-gpu-runner`
   with EC2 as the trusted service, attach `iam-instance-policy.json` (replace
   `RESULT_BUCKET_NAME`), and create an instance profile of the same name. The
   `launch` script attaches this profile by default so the instance can write
   results. If you use SSM Session Manager to log in for debugging, also attach
   the AWS-managed `AmazonSSMManagedInstanceCore`.

3. **Create the results bucket** in `us-east-1`, keep it private (block all
   public access), and use its name for the two policy placeholders above and
   for `--bucket`.

4. **Configure the CLI.** With Identity Center:

   ```
   aws configure sso
   ```

   or with an IAM user:

   ```
   aws configure
   ```

   Confirm it works with a read-only call:

   ```
   aws sts get-caller-identity
   ```

5. **Set a monthly budget alarm.** In AWS Budgets, create a monthly cost budget
   (for example $20) with an email alert at 80% and 100% of the amount. This is
   the backstop if a guardrail is ever bypassed.

6. **Verify the AMI parameter on the first run.** The SSM parameter name in
   `launch` is marked "verify on first real run" because AWS renames these paths
   between AMI generations. Confirm it resolves:

   ```
   aws ssm get-parameter \
     --name /aws/service/deeplearning/ami/x86_64/base-oss-nvidia-driver-gpu-ubuntu-22.04/latest/ami-id \
     --region us-east-1 --query Parameter.Value --output text
   ```

   If it 404s, list the family and pick the current name:

   ```
   aws ssm get-parameters-by-path \
     --path /aws/service/deeplearning/ami/x86_64 --region us-east-1 \
     --query "Parameters[?contains(Name,'base') && contains(Name,'gpu')].Name"
   ```

   then set `AWS_GPU_SSM_AMI_PARAM` to the one you confirmed.

## Offline tests

`./test-offline` runs with no AWS account and no network:

1. `bash -n` on every script here.
2. `launch --print` asserting the guardrails: shutdown behaviour is
   `terminate`, `project=flyover` is tagged on the instance and the volume, the
   default type is `g6.2xlarge` and the fallback is `g5.2xlarge`.
3. `teardown --print` asserting it targets only `project=flyover`, terminates
   instances, and only lists (never deletes) volumes and buckets.
4. Both IAM policy files parse as JSON.

## Traps carried over from Colab

- **Serve with `scripts/serve.py`, never `python -m http.server`.** The stdlib
  server ignores `Range:` requests, so PMTiles archives come back whole and the
  layers that read slices out of them render nothing, with no console error.
- **Point the harness at Chrome with the EGL flags via `CHROME_PATH`.** The
  verify scripts stay unmodified; a small wrapper appends
  `--use-gl=angle --use-angle=gl-egl`, and `VERIFY_GL=hardware` stops
  `chrome.mjs` adding its SwiftShader flags. The renderer string in the output
  reads `ANGLE (NVIDIA ...)` on a real run.
- **Always stop the box.** Terminate-on-shutdown, the hard cap, the idle
  watchdog and the explicit shutdown at the end of a run are four independent
  ways the instance ends. If you edit `user-data`, keep all four.
