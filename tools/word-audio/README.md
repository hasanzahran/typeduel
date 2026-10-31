# Reviewed eight-word audio tooling

**Generation is not authorized.** The current owner approval covers application/tool implementation, tests and dry-run only. No provider request belongs in CI.

```sh
pnpm --filter @typeduel/word-audio build
pnpm --filter @typeduel/word-audio dry-run
```

Dry-run prints the exact eight requests and request hash; it creates no files and initializes no provider client. Proposed configuration: Joanna Neural, en-US, us-east-1, MP3 24 kHz. Eight calls / 29 characters / estimated US$0.000464 at US$16 per million characters. Proposed synthesis-only ceiling US$0.01. Recheck the quote and obtain explicit generation approval before execution; no infrastructure costs are authorized.

## Approval before any provider call

Use an existing authorized AWS account with short-lived least-privilege credentials. The operator must verify the active credential account in their AWS session; the tool's account comparison records the operator's confirmation, **not automated credential-account attestation**. Never put credentials in the approval file or repository.

An owner-approved private JSON record must contain exactly:

- `batchId`: new UUID; `approvedBy`: named approver; `approvedAt`/`expiresAt`: ISO timestamps, approval valid for at most 24 hours.
- `expectedAccountId`: verified 12-digit account; `accountVerifiedByOwner: true`.
- `outputDirectory`: new absolute canonical directory outside this repository; existing parent must be private. Resolve macOS `/var` aliases before recording the path.
- `requestHash`: exact current dry-run hash; `region: "us-east-1"`; `maxAttempts: 8`; `maxCharacters: 29`; `maxCostUsd: 0.01`.

No valid approval template is shipped. After separate authorization only:

```text
node tools/word-audio/dist/generate-eight.js --execute <private-approval.json> <approved-new-directory> <owner-confirmed-account-id>
```

The SDK uses one attempt, bounded response bytes and request timeout. An exclusive directory and durable per-request ledger prevent automatic replay of the same approved output. Every request is durably marked started **before** sending. Stop on any uncertain outcome; do not delete a ledger or rerun with another directory. Reconcile provider billing/output and seek a new bounded authorization for replacements. A US$0.01 application bound is not an instantaneous AWS billing alarm.

Output is private mode-0600 files under a mode-0700 directory, opaque asset/version names and a generation ledger. The tool never invents approved reviews or emits a playable manifest. No paid API is invoked by tests; synthetic byte fixtures are not recordings.

## Review and measurement

1. Named human reviews each candidate's spelling, ambiguity, Level-1 fit and source/provider rights.
2. Named human listens to every final MP3 for pronunciation, recognizability, clipping, silence and consistent loudness. Inspect tags for answer leakage. Any byte modification creates a new asset version and renewed review.
3. `decodeAndMeasure` uses built-in macOS `afconvert` to decode to PCM, with child-process file-size/time limits and bounded RIFF parsing. No resampling/trimming/normalization. Record macOS build, afconvert version, sample frames/rate, integer duration, final bytes/hash and diagnostics in the private review record. This is decoded duration, not acoustic latency. No FFmpeg installation is required.
4. Create a private manifest matching `docs/M1_INCREMENT_04_CONTRACT_FREEZE.md`, using actual named approvals, measured duration and final MP3 hashes. The synthetic repository fixture is only a format-compatibility test.
5. Validate final bytes and decoding:

```text
node tools/word-audio/dist/validate-eight.js <private-manifest.json> <private-asset-root>
```

6. Test the exact versions on physical iPhone/Android; record native duration, actual audible timing and accessibility. Successful synthesis, checksums or decoding cannot replace this evidence.

Private artifacts stay outside Git, mobile bundles, logs and public static hosting. Backend authorizes delivery; there is no upload or provisioning command in this tool.
