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

One browser session, about 10 minutes, once. No access key is made and nothing is typed on any
computer of ours: GitHub proves to AWS that a run comes from this repository's main branch.

1. **Billing.** Read the credit balance and its expiry date (Billing, Credits). Nothing below
   should be done before the credits show there.
2. **One stack.** CloudFormation, region `us-east-1`, Create stack, upload
   `scripts/aws-gpu/setup-stack.yaml`. Fill in the e-mail for alerts and the monthly ceiling
   (default 100 dollars of usage; credits are not subtracted, so it warns before the credits run
   out). Tick the box that allows IAM resources with names. Create.
   It makes: a private results bucket (files expire after 30 days), the machine's role, a role that
   only this repository's main branch can use and that can only start and stop `g6.2xlarge` /
   `g5.2xlarge` in `us-east-1`, a monthly budget with e-mails at 50%, 80% and a forecast of 100%,
   and an action that BLOCKS new launches when the ceiling is reached. Deleting the stack removes
   all of it.
3. **Two repository secrets.** From the stack's Outputs tab, copy `OperatorRoleArn` into the
   GitHub secret `AWS_GPU_ROLE_ARN` and `ResultsBucketName` into `AWS_GPU_BUCKET` (repository
   Settings, Secrets and variables, Actions). They hold no key; they are secrets only so the
   account number stays out of this public repository.
4. **First run.** GitHub, Actions, "AWS GPU checks", Run workflow (defaults: `main`,
   `graphics.mjs`, 45 minutes). After that any agent with write access can start it with
   `gh workflow run aws-gpu.yml`.

What stops the money: the machine switches itself off after the limit (set on the machine at boot),
after 20 idle minutes, and when its job ends; the workflow's last step removes anything tagged
`project=flyover`; the budget blocks new launches at the ceiling. A budget e-mail alone stops
nothing, which is why the other three exist.

The older manual way (an IAM user and `aws configure` on a laptop) still works with
`iam-operator-policy.json` and `iam-instance-policy.json`, but it puts a key on a machine. Prefer
the stack.

**Verify the AMI parameter on the first run.** The SSM parameter name in `launch` is marked
"verify on first real run" because AWS renames these paths between AMI generations. If the first
run fails at that lookup, the log names the parameter; list the family in the console
(Systems Manager, Parameter Store, public parameters, `deeplearning`) and set the current name in
`launch`.

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
