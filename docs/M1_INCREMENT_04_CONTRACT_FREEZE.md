# Increment 04 implementation freeze

Owner authorized implementation of planning commit `64dfffb`. Audio generation, infrastructure provisioning, custom keyboard work, merge and later increments remain unauthorized. This file records implementation interfaces, not a second planning cycle.

## Authority and playback

- Existing trusted receipt FIFO and commit-before-publish remain mandatory. Completion reports never change playback, typing or answer deadlines.
- Preparation expires 20,000 ms after trusted preparation receipt, only while preparing. Scheduling retires that expiry. Initial countdown remains 3,000 ms; later countdown/result hold remain 1,500 ms; common playback margin is 1,000 ms; Level 1 typing remains 8,000 ms.
- Both initial completions must be received in `[playbackAt + clipDurationMs, typingStartAt)`. Preserve timely receipts across slow COMMIT. At the fixed typing-start gate, missing completion interrupts with `AUDIO_UNAVAILABLE`, before scoring. No rescheduling in this increment.
- `round.audio_completed` takes `{matchId, roundId, audioVersion}`. `round.audio_failed` adds only the shared allowlisted reason. Both reuse gameplay replies, do not consume an attempt and cannot supply timestamps. Use explicit command-type branches.
- An early genuine local-end notification returns `INVALID_TIME` and may retry within the fixed window; no replay, offline buffering or time extension. Mobile completion reports retry at most 12 times, at 100 ms intervals within that same window, without waiting for the longer transport ACK timeout; a successful scoped ACK stops retransmission. Native reset/failure during an unclosed round still interrupts rather than silently continuing with impaired audio; closed/terminal outcomes remain immutable. Pretyping disconnect/replacement clears completion proof. Closed/terminal outcomes and all 48 counted ACKs remain immutable.
- Checkpoint v2 reads old terminal v1 state; unfinished old state is restart-interrupted rather than resumed. No old-binary rollback after v2 writes.

## Asset HTTP interface

- `POST /v1/matches/:matchId/audio-access`, strict `AudioAccessRequestSchema` body.
- Shared `AudioAccessReplySchema` scopes the grant to server instance, session, admission revision, request, match, round, asset and version. Canonical `AudioDescriptor` stays unchanged.
- `Authorization: Bearer …` and `X-TypeDuel-Session-Id` required on issue and download. Grants last 60 seconds and bind current owner/session. Canonical route is `/v1/audio/:assetId/:audioVersion`; signed query is an opaque `grant`. Revalidate after awaited byte retrieval; no redirects or credential forwarding to another origin. Do not log request URLs containing grants.
- Public limits: `MAX_AUDIO_BYTES = 1,048,576`, `MAX_AUDIO_DURATION_MS = 10,000`. Full verified local bytes precede native readiness. No streaming TTS or anonymous/public bucket.
- Backend runtime injects the reviewed source and private byte reader. `RoundSource` remains the domain interface; byte-reader/catalog implementation belongs to Backend, not shared/public contracts. No filesystem paths or answer mappings in wire data.

## Private manifest v1

Exact synthetic compatibility example: `tests/fixtures/catalog-manifest-v1.json`. It is test-only; its fake approvals and non-audio bytes are never real content evidence or a runtime fallback.

Top level: `formatVersion: 1`, UUID `catalogVersion`, `languageCode: "en-US"`, lowercase SHA-256 `generationConfigHash`, eight `entries`.

Each entry: UUID `wordId`, `canonicalText`, `allowedVariants`, `difficulty: 1`, `editorial: {status: "approved", reviewedBy, reviewedAt}`, `asset`.

Asset: UUID `assetId`/`audioVersion`, `path: "<assetId>/<audioVersion>.mp3"`, positive bounded `byteLength`/integer `clipDurationMs`, lowercase `sha256`, `provider`, and `listening: {status: "approved", reviewedBy, reviewedAt, sha256}` matching final bytes.

Provider: `{name: "amazon-polly", voiceId: "Joanna", engine: "neural", languageCode: "en-US", region: "us-east-1", outputFormat: "mp3", sampleRateHz: 24000}`.

Reject unknown fields, conflicting normalized words/variants, unsafe paths/symlink escape, mismatched checksums, invalid review records or fewer than eight eligible entries. General/Classic/Level 1 only; no fallback or in-match repeat. No hot reload. Backend and offline tooling validate the same fixture without runtime imports between them. Tool output starts pending until named human approval; no actual audio generation is authorized.

## Mobile integration boundary

Existing token provider, connection, consumer and command controller remain the entry points. Audio controller consumes committed state and emits existing/new commands; UI cannot award points or advance phase.

Fresh clock estimate age ≤10s, estimated half-RTT uncertainty ≤100ms, refresh every 3–5s, invocation lateness ≤150ms. These checks do not prove acoustic timing. Physical onset-skew plus measurement uncertainty must meet 150ms before acceptance.

Reserve replay locally before playback; max two, no refund after uncertainty. Ordinary reconnect retains ledger; cold process loss fails closed for the open round. Scope/fence every async callback. Input requires committed ACTIVE, real local initial-end record, foreground/current session/fresh estimate. Track up to eight received committed results for presentation; never infer missing history.

## Ownership and integration

Lead: contracts/tests, fixture, manifests/lockfile, shared config/environment examples, content tools/docs and integration. Backend: server source/migration/baseline tests. Mobile: mobile runtime/audio/screens and adjacent tests (no manifests/shared config). QA when a slot is free: `audio-qa` server integration tests, mobile `audio/qa` tests and existing adversarial/integration fixture adaptations. Two specialist workstreams initially. Agents commit only assigned paths; Lead cherry-picks in contracts → Backend → Mobile → QA order. No dependency installation by agents; use Lead's policy-validated workspace setup.
