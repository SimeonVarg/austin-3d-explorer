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

## Checking a pull request on the GPU (`aws-pr-checks.yml`)

The free GitHub run draws in software on 4-core machines: about 45 minutes a pull request, hours when six are open.
This runs the SAME suite on the one rented L4 and posts the SAME report as a second comment.

```
gh workflow run aws-pr-checks.yml --ref main -f pr=435                      # every check + the before/after pictures
gh workflow run aws-pr-checks.yml --ref main -f pr=435 -f only=sky.mjs,dusk.mjs   # just those checks (names; the args come from checks.json)
```

- Hand-started, from main only, same-repository pull requests only (a fork's code never runs on the owner's account).
- The machine checks out `refs/pull/N/merge` (what the free run checks), takes `scripts/aws-gpu/pr-suite.sh` from main, runs
  the shards of `scripts/verify/ci/checks.json` four at a time (one tree and page server per browser), the graphics probe,
  and the three picture shoots (before, after, before again), then uploads to the results bucket and ends itself.
- A second job (no AWS credentials) runs `scripts/verify/ci/summary.mjs` over the files, uploads the logs and pictures as
  artifacts, and posts or updates ONE comment whose first line is `<!-- visual-checks-summary-aws -->`.
- Public cameras only. The inputs and logs are public; nothing here ever draws a photograph's camera (that is Colab's job,
  `astra-pipe/tools/colab-render.py`, which is private).
- `max_runtime` (default 90 minutes) is the hard limit on the machine; `wait_scale` multiplies the checks' own waits (1 here,
  3 on the free machines).

**The free run stays the verdict until two runs of this agree with it.** Two reasons it may not, both by design of the
checks and not bugs of the lane: about a hundred checks assert exact pixel colours, and a GPU and a software rasteriser
legitimately disagree about edges and filtering (`scripts/verify/chrome.mjs` explains why SwiftShader is the default); and
timing-sensitive checks see four browsers on 8 vCPUs, not one browser on a whole machine. So: compare the two comments for
the same commit. A check that fails here and passes there goes on the list to move to `VERIFY_GL=swiftshader` for this lane
or to quarantine for it; a check that fails on both is a real finding.

Needs the same one-time setup as `aws-gpu.yml` (the stack and the two secrets). It starts from main, so it works only after
this workflow file is on main. `scripts/aws-gpu/test-offline` covers the wiring; the first real run is the proof.

## Timing (`scripts/aws-gpu/perf`)

```
scripts/aws-gpu/perf --ref mac/speed-profile      # until the speed tools (PR #435) are on main
```

Starts `aws-gpu.yml` with the one check `perf-aws-suite.mjs` (the `scripts/perf` tools one after another: load-time table at
1x and 4x CPU throttle with 3 cold loads, frame time on the L4, phone-size memory, the apartment buffer sizes), waits,
downloads only that run's results and prints the tables. A quiet box by construction. About 25 minutes, about $0.40.

## Raising the limits: what it buys and the owner's one step each

Nothing here has been done; each is a step only the owner can take in his own browser.

| Lane | Now | Raise to | What it buys | The owner's step |
|---|---|---|---|---|
| AWS GPU machines | 8 vCPUs of "Running On-Demand G and VT instances", us-east-1: ONE g6.2xlarge (8 vCPU) at a time | 32 vCPUs = 4 machines at once; 64 = 8 machines (or 16 `g6.xlarge`) | A pull request's suite split over 4 machines instead of 1: roughly a quarter of the wall time, same cost. Two lanes (a suite and a timing run) no longer queue behind each other. Cost is the same hours, billed in parallel; the monthly budget in the stack (default 100 dollars) still blocks launches. | AWS console, region US East (N. Virginia), Service Quotas, "AWS services", Amazon EC2, the entry named "Running On-Demand G and VT instances" (code L-DB2E81BA), "Request increase at account level", New quota value `32` (or `64`), Request. New accounts are often granted small steps first; ask for 32, expect hours to two days. The workflow's concurrency group (`aws-gpu`) must then be widened too (a code change, not his). |
| Colab | Colab Pro, about 464 compute units on 2026-09-30 (expire about late December 2026); an L4 costs about 1.5 units an hour | Pro+ adds units and background runs | Units are not the limit: 464 units is about 300 L4 hours, and a render run is 0.4 units. The limit is sessions: Pro is documented as ONE high-resource session at a time (only a third-party source; not confirmed on his account). Four browsers in one L4 session is the current way to parallelise. | None needed for now. To test two sessions at once: run `colab-render.py` twice at the same time and read the second's error. Pro+ only if that fails and he wants more: colab.research.google.com/signup. |
| Azure | A GPU quota ticket was filed 2026-09-28: 32 vCPUs of NCADSA10v4 (A10) in East US, 0 to 32 (the automatic increase was rejected). Status not read since. | Approved ticket | Nothing that AWS plus Colab cannot already do; it adds a THIRD independent queue. An A10 has the same 24 GB as the L4 (speed difference not measured here). Fractional A10 VMs (NVadsA10 v5, from 1/6 of a GPU with 4 GB) are too small for the full city. Azure bills separately from the AWS credits, but the Founders Hub credits are the ones Astra also draws on (not checked). Azure Container Instances' GPU offer: not researched to the end, do not plan on it. It needs a launcher and guardrails like `scripts/aws-gpu` (none exist) before it is useful. | Look at the ticket's reply (sent to his Microsoft e-mail), and if approved: Azure portal, Quotas, Compute, confirm 32 vCPUs of "Standard NCADSA10v4 Family" in East US. Nothing else; he should NOT pay for a VM until an agent has a launcher for it. |
