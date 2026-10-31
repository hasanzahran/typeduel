# M1 Increment 04 — First playable phone match

**Status:** Owner approved planning commit `64dfffb`; Increment 04 implementation is in progress. Recording generation, infrastructure provisioning and physical acceptance remain pending. See `M1_INCREMENT_04_CONTRACT_FREEZE.md` for implementation interfaces.

**Baseline:** PR #5 accepted and merged at `8c29e2a83c43dfa8dea284a10e33589e3247a6ba`. Planning branch: `codex/m1-04-plan`. Reviewed October 30, 2026 against AGENTS.md, the approved PRD, System Design, UI/UX, Increment 03 contracts and its mobile/content handoff. This continues the approved architecture; it does not reopen it.

## 1. Deliverable and shortest path

Two actual authenticated users on a physical iPhone and Android complete a **General / Classic / Level 1** match: eight reviewed prerecorded words, five standard rounds, up to three sudden-death rounds, three counted submissions per player per round, two extra replays per player per round, authoritative scoring and a durable final winner or draw.

Use existing private-room admission, Socket.IO transport, serialized durable actors, PostgreSQL, recovery and committed-state consumers. Connect the existing Game and Results visual hierarchy to those consumers. A small development-only sign-in/create/join/ready entry is sufficient; full Home/Setup flows, invitation polish, profiles, store builds, additional content pools and custom-keyboard implementation are outside this increment.

**Rule clarification:** distinct attempts mean distinct submission IDs, not distinct spellings. The same ID recovers its original counted acknowledgement; submitting the same spelling under a new ID costs another attempt. Preserve the approved PRD and existing tests.

The critical path is **contract freeze → parallel Backend/Mobile/QA implementation → approved and listened-to recordings + authorized reachable environment → integrated checks → physical pair**. Editorial and environment preparation can run alongside coding. Audio generation requires its own bounded approval; approving application work does not authorize cloud provisioning.

## 2. Reconciled contract freeze for approval

### Existing guarantees remain

- The server owns identities, receipt order, phases, deadlines, attempts, scores, difficulty and results. Use the existing trusted ingress receipt before asynchronous work; no client timestamp can backdate a command.
- Persist transitions before publication, retain atomic event batches and increasing state versions, reconcile uncertain COMMITs, preserve all 48 counted acknowledgements and immutable terminal outcomes.
- The ten-second reconnect grace begins at **server-observed disconnect**. Time continues. Unresolved disconnects interrupt with no winner. An earlier audio safety deadline can interrupt first; reconnect grace does not suspend other rules.
- Production consumers never substitute preview scores, fixture words or test identities. Existing test fixtures remain isolated from server/mobile production output.

### Private catalog and audio delivery

Use a schema-validated, read-only private manifest and eight immutable MP3 files behind the existing `RoundSource` plus a separate private byte-reader interface. This is the first catalog/storage adapter, not a second game engine or hardcoded word list. Catalog eligibility, asset authorization and byte retrieval remain separate; M2 can replace storage/metadata adapters without changing actor or phone contracts. Reuse `RoundSource`; do not add a public catalog or a second word-selection implementation. Full PostgreSQL editorial catalog/object-storage tooling remains M2. The selected private word/asset is already persisted in the match checkpoint. Freeze private manifest format v1: `formatVersion`, `catalogVersion`, `languageCode`, `generationConfigHash`, and entries containing `wordId`, `canonicalText`, `allowedVariants`, `difficulty`, editorial decision/reviewer/date, plus `assetId`, `audioVersion`, opaque relative path, byte length, SHA-256, integer `clipDurationMs`, provider configuration and final-hash listening decision/reviewer/date. Reject unknown/invalid fields, duplicate normalized canonical/variant answers, unapproved entries, unsafe paths and changed bytes. No hot reload in 04. Backend and tooling validate the same synthetic compatibility fixture; neither imports the other’s runtime.

Require eight distinct approved, eligible entries before admission. Reject other setups or missing/unapproved assets with `SOURCE_UNAVAILABLE`. Select without replacement; do not repeat words to fill sudden death. Validate manifest shape, approved final hashes, measured durations and bytes at startup. Use opaque UUID/version paths, bounded file sizes and path containment; no directory listing, answer-derived filename, ID3 spelling or client-visible lookup ID.

Keep the canonical `AudioDescriptor` unchanged. Its stable opaque URL identifies the asset route, not an expiring participant credential. Add strict shared HTTP contracts:

- `POST /v1/matches/:matchId/audio-access`: body `{requestId, roundId, assetId, audioVersion}`; validate the path match ID once. Validate the Bearer JWT, `X-TypeDuel-Session-Id`, current admitted participant/session and current open round. Return `Reply<{serverInstanceId, sessionId, admissionRevision, requestId, matchId, roundId, assetId, audioVersion, url, expiresAt, byteLength}>` for that exact descriptor. Mobile validates all scope fields before using the grant. Reuse static transport error codes; no internal paths or guesses in errors.
- The signed download URL expires after **60 seconds** and is scoped to participant/session/match/round/asset/version. Download also requires the current Bearer JWT and session header. Recheck authorization/expiry before returning bytes. Use existing Node crypto/jose facilities, not a storage SDK.
- Grant refresh changes only access credentials, never canonical asset identity, state version or schedule. Stop stale work when scope changes. Suppress tokens, signatures and URL query strings in logs; mark delivery private/no-store and validate HTTPS origin/redirect behavior. The client downloads the complete bounded file before readiness, verifies SHA-256 over its bytes, then plays the local file. Never forward Bearer/session headers to another origin or redirect. Bind grants to the current server owner/session, and recheck ownership, session and round after asynchronous byte retrieval. Serve verified immutable bytes rather than trusting a file that may have changed after startup.

### Audio readiness, completion and failure

Add two strict client commands alongside existing `round.audio_ready`:

| Event                   | Payload                                 | Semantics                                                            |
| ----------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| `round.audio_completed` | `{matchId, roundId, audioVersion}`      | Initial local playback ended; not a replay and not an answer attempt |
| `round.audio_failed`    | Same identity plus allowlisted `reason` | Scoped audio/lifecycle failure; no native error string or URL        |

Failure reasons: `DOWNLOAD_FAILED`, `INTEGRITY_FAILED`, `DECODE_FAILED`, `PLAYBACK_FAILED`, `LATE_PLAYBACK`, `APP_INACTIVE`. Both events reuse existing `Reply<GameplayReplyData>`; success has null answer ACK/error. Completion retries are idempotent bookkeeping, not entries in the 48-answer ledger. Existing session fencing and command validation apply. Add interruption reason `AUDIO_UNAVAILABLE`, including the database constraint.

Replace the engine's current structural `audioVersion` readiness dispatch with explicit command-type branches, and extend ingress/actor gameplay allowlists. A completion or failure must never accidentally execute the readiness branch.

Persist a **20,000 ms preflight deadline** from the trusted round-preparation receipt; reconnects/readiness retries never extend it. It applies only during preparation and is retired when both timely readiness receipts schedule the round; an obsolete preflight wake cannot interrupt a scheduled countdown. Readiness requires exact-version bytes, valid hash, native loaded/prepared state and a usable clock sample. Native `isLoaded` is not a claim that every audio frame has already decoded.

Keep the initial countdown **3,000 ms**, subsequent countdown **1,500 ms**, and Level-1 typing window **8,000 ms**. Propose a common initial-playback margin of **1,000 ms** instead of the current unmeasured 100 ms. This is a shared development tuning change requiring this plan's approval, not a per-player extension.

The authoritative initial-completion receipt window is:

`[playbackAt + clipDurationMs, typingStartAt)`

Both participants' completion flags must persist before the actor opens typing. At the exact upper boundary, due work wins: missing proof interrupts the match before any answer can score. A timely receipt queued at `typingStartAt - 1` remains timely even if its COMMIT finishes later; later timers/answers cannot overtake it. Client callback time is never authoritative.

An honest native end callback can precede the server's lower bound because of clock-estimation error or rounded duration. Retain the scoped local-ended record and allow a bounded defer/retry inside the unchanged valid window; do not replay the clip, invent completion, extend time or queue the command offline. Test early rejection followed by a timely retry and expiry without a successful retry.

**Resolved cross-review:** publish the same truthful committed schedule through updates and sync, even after a slow schedule COMMIT. A client that cannot meet it refuses late playback and reports failure; the mandatory completion gate prevents a point. Do not invent a separate suppressed snapshot projection or privately move a deadline. Test both publication and explicit sync under this delay.

Before typing, the existing trusted disconnect/reconnect replacement pair clears the old device's completion proof. Old queued proof precedes the pair and is invalidated; stale-session packets cannot restore it. The current session may report retained completion only within the unchanged valid window. A late failure cannot undo an already closed round or terminal result.

Completion flags and preflight deadlines remain private checkpoint fields, not a new public phase. Add checkpoint format v2 with a v1 read adapter: old terminal results and counted retries remain readable; old unfinished matches recover through the existing server-restart/no-win policy, never by reusing previous monotonic clock values. New matches cannot bypass the audio gate to keep legacy tests passing. Apply the additive migration before v2 writers; the old Increment 03 binary is not a safe rollback target after v2 writes. Record backup/restore or compatible forward-fix instructions. Do not downgrade checkpoint versions or claim seamless live migration.

### Mobile timing, replay and recovery

Use the existing clock estimator and absolute server schedule. Proposed development thresholds: clock sample age at most **10 seconds**, estimated half-RTT uncertainty at most **100 ms**, playback invocation lateness at most **150 ms**, native status interval **100 ms**. These are proposed supported-profile thresholds, not acoustic guarantees; asymmetric latency can exceed the estimate. Fix the existing clock helper’s 30-second best-sample retention: select from a bounded set of qualifying samples no older than 10 seconds, refresh every 3–5 seconds while foregrounded, expose age/uncertainty explicitly and invalidate on lifecycle/session changes. A successful ping parse does not prove the selected estimate is fresh. Test newer samples with worse RTT and wall/monotonic clock discontinuities.

Expo Audio does not supply a sample-accurate absolute scheduled-play API or proof of audible output. Schedule a foreground JS invocation mapped from server time and record invocation/status evidence separately from actual audible onset/end. Input requires committed `ACTIVE_TYPING`, this runtime's initial-completion record, foreground state, current session and fresh clock. Never announce the answer through accessibility before the canonical result.

Reserve each extra replay locally before seeking/playing; await seek-to-zero, prevent overlap/double taps and allow at most two. Replay telemetry does not delay playback or extend typing. On uncertain playback, do not refund a consumed replay. Ordinary reconnect retains the maximum of local consumption and committed server telemetry, refreshes auth/clock/snapshot and never repeats the initial clip automatically.

If a cold process loses its playback/replay ledger, fail closed for the current unclosed round and report scoped failure. Do not restore replay credits or autoplay an old initial clip. Terminal results remain recoverable. Fence asynchronous download, decode, player and timer callbacks by session/match/round/version/generation. Backgrounding, interruption or media reset cannot silently resume stale playback. Use foreground playback, silent-mode support and no mixing/background recording.

### Reusable mobile runtime and restricted test entry

Keep the reusable match runtime, audio controller, token-provider interface and live screens independent of the development launcher. Only the password-entry/lobby test wrapper is development-only; future social sign-in and Home flows inject the same interfaces. Do not put gameplay behind a fake-auth branch.

Use two existing confirmed Supabase test users with the existing asymmetric JWT verifier. A `__DEV__` entry performs password/refresh-token REST requests using the project's public URL/publishable key. Password input is masked and cleared; access/refresh tokens remain in memory, with single-flight refresh and generation fencing. No service-role key, test password, access token or refresh token enters an environment-public value, QR, route, log or checked-in file. No new Supabase SDK or social-auth flow is needed. Cold restart requires sign-in again.

Bind existing Game/Results layouts to committed state, including disconnected/interrupted states. Results return to the development lobby; do not simulate a rematch. Preserve colors, spacing, typography, safe areas, keyboard avoidance and supported assistance-disabling flags. Production match/audio modules must never import `src/dev`; release-boundary tests must exclude password-entry code, catalog/tool fixtures and all credentials. Existing preview remains explicitly separate; live routes cannot fall back to mock data. Gboard assistance remains the accepted M0 limitation and an unresolved **M1 competitive-acceptance requirement**.

Preserve the existing 1,500 ms round-result hold. Add a bounded ledger of received committed round results (maximum eight, keyed by match/round), so rapid updates or React batching cannot erase feedback. Populate only validated committed batches or applicable snapshots; never invent missed history. Prior-round feedback cannot delay readiness or obscure the next playback/typing controls. Hide unavailable statistics; do not fill approved result layouts with invented values. Keep screen-reader announcements meaningful and nonrepetitive, maintain focus, support reduced motion/large text, and never announce a secret word early. Playback requires no recording permission or background-audio capability.

## 3. Dependencies proposed, not installed

| Package                 | Exact proposed pin | Registry publication UTC | Purpose                                                       |
| ----------------------- | ------------------ | ------------------------ | ------------------------------------------------------------- |
| `expo-audio`            | `58.0.10`          | 2026-10-21 18:16:03.288  | Native local-file playback/status                             |
| `expo-file-system`      | `58.0.13`          | 2026-10-28 15:39:27.892  | Authenticated bounded download/private cache                  |
| `expo-crypto`           | `58.0.7`           | 2026-10-16 15:42:06.380  | Hash downloaded binary bytes                                  |
| `@aws-sdk/client-polly` | `3.1159.0`         | 2026-10-28 18:47:05.296  | Offline eight-request tool only; never mobile/backend runtime |

The three Expo pins match the installed SDK 58 compatibility map and their APIs are available in Expo Go. Exact registry publication times and non-deprecated status were rechecked on October 30; all direct versions exceed 24 hours; **full transitive resolution has not been installed or approved by pnpm yet**. At implementation, accept only a full graph admitted by `minimumReleaseAge: 1440`, preserving existing build-script policy, frozen installs and strict engines. Report any ineligible transitive package instead of overriding it. Do not automatically choose a newly published latest version. No new backend runtime dependency, database service or paid build is proposed.

Sources: [Expo Audio](https://docs.expo.dev/versions/v58.0.0/sdk/audio/), [FileSystem](https://docs.expo.dev/versions/v58.0.0/sdk/filesystem/), [Crypto](https://docs.expo.dev/versions/v58.0.0/sdk/crypto/), and registry publication metadata. Actual installed Expo Go compatibility remains a device check.

## 4. Exact proposed file ownership

Paths below are repository-relative. All listed files are proposed, not implemented. Each file has one writer; cross-owner changes go through Lead. Existing test files remain active with narrowly adapted mandatory-completion fixtures.

### Lead — contracts, shared configuration and integration

Modify:

- `packages/contracts/src/gameplay.ts`, `src/realtime.ts`, `src/index.ts`
- `packages/contracts/tests/gameplay.test.ts`, `tests/realtime.test.ts`
- `apps/mobile/package.json`, `apps/mobile/app.config.ts` (playback-only native configuration), `pnpm-lock.yaml`, `pnpm-workspace.yaml` only as needed to include the bounded tools workspace; preserve security settings
- `apps/server/.env.example`, `apps/mobile/.env.example`
- `package.json`, `.github/workflows/ci.yml`, `scripts/boundaries.mjs`, `scripts/check-release.mjs` for tool validation and fixture/dev-entry isolation
- `docs/IMPLEMENTATION_PLAN.md`, `docs/M1_INCREMENT_04_PLAN.md`, `README.md`

New: `packages/contracts/src/audio.ts`, `packages/contracts/tests/audio.test.ts` for HTTP asset access; `tests/fixtures/catalog-manifest-v1.json` as an isolated synthetic private-format compatibility fixture, never bundled. Lead owns the shared private manifest interface specification in this plan; Backend implements its runtime schema and Content conforms to it.

Proposed server configuration: private `GAME_AUDIO_MANIFEST_PATH`, `GAME_AUDIO_ROOT`, `GAME_AUDIO_SIGNING_KEY` and public `GAME_PUBLIC_ORIGIN`, alongside existing database/auth configuration. Use a locally generated high-entropy signing key after approval, never a source default. Explicitly enable the development catalog; refuse accidental production use. Mobile adds only public Supabase project URL/publishable key configuration and the reachable API origin.

### Backend — catalog, delivery and authoritative gate

New:

- `apps/server/src/words/catalog.ts`, `src/words/source.ts`
- `apps/server/src/audio/access.ts`, `src/http/audio.ts`
- `apps/server/drizzle/0002_audio_gate.sql`, `drizzle/meta/0002_snapshot.json`
- `apps/server/tests/words/catalog.test.ts`, `tests/words/source.test.ts`, `tests/http/audio.test.ts`

Modify:

- `apps/server/src/runtime.ts`, `src/server.ts`, `src/config/env.ts`
- `apps/server/src/game/types.ts`, `rules.ts`, `engine.ts`, `actor.ts`, `registry.ts`
- `apps/server/src/socket/handlers.ts`, `src/socket/server.ts`
- `apps/server/src/db/checkpoint.ts`, `src/db/schema.ts`, `drizzle/meta/_journal.json`
- `apps/server/tests/db/checkpoint.test.ts`
- `apps/server/tests/game/fixtures.ts`, `runtime-fixtures.ts`, `engine.test.ts`, `actor.test.ts`, `registry.test.ts`
- `apps/server/tests/integration/backend/store.test.ts`, `bindings.test.ts` where new fixture state requires adaptation

Keep the byte-reader interface in `src/audio/access.ts` and metadata validation in `src/words/catalog.ts`; no additional repository framework/package. Test path/symlink escape, replacement bytes, normalized-answer collisions, grant/session/owner changes during reads, and v1/v2 recovery.

No application catalog migration beyond the audio-gate/checkpoint compatibility work. Preserve ownership fencing, transactional commits, private participant bindings and existing restart semantics.

### Mobile — audio runtime and minimal live screens

New:

- `apps/mobile/src/audio/asset-cache.ts`, `native-player.ts`, `round-audio.ts` and their adjacent `.test.ts` files
- `apps/mobile/src/features/match/runtime.tsx`, `GameScreen.tsx`, `ResultsScreen.tsx` and adjacent `.test.tsx` files
- `apps/mobile/src/dev/supabase-session.ts`, `supabase-session.test.ts`, `real-match.tsx`, `real-match.test.tsx`
- `apps/mobile/app/playtest.tsx`

Modify:

- `apps/mobile/app/_layout.tsx`, `app/game.tsx`, `app/results.tsx`
- `apps/mobile/src/features/match/clock.ts`, `commands.ts`, `connection.ts`, `consumer.ts` and their existing tests

Reuse UI primitives unchanged. Any necessary shared primitive alteration requires Lead assignment and a visual review rather than concurrent ownership.

### QA — independent adversarial verification

New:

- `apps/server/tests/integration/audio-qa/assets.test.ts`, `preflight.test.ts`, `playback-gate.test.ts`, `recovery.test.ts`, `support/harness.ts`
- `apps/mobile/src/audio/qa/lifecycle.test.ts`, `replay-recovery.test.ts`
- `docs/M1_INCREMENT_04_DEVICE_EVIDENCE.md`

Own narrowly required compatibility adaptations to `apps/server/tests/game/adversarial.test.ts`, `snapshot.test.ts`, and existing `apps/server/tests/integration/qa/**` / `transport-qa/**`, especially their shared harnesses/child processes. Never disable the production gate or weaken old assertions to avoid fixture work.

### Content — bounded offline tooling and review

New: `tools/word-audio/package.json`, `tsconfig.json`, `README.md`, `src/generate-eight.ts`, `src/validate-eight.ts`, `src/manifest.ts`, `tests/generation.test.ts`, `tests/validation.test.ts`.

Modify: `docs/M1_CONTENT_PREPARATION.md`.

The tool defaults to dry-run and requires an explicit approved batch/account/region/cap to synthesize. Lead owns dependency manifests/lockfile integration; Content must not install independently. Keep runtime outputs in an owner-approved private external directory: editorial decisions, generation ledger, private manifest and opaque UUID/version MP3s. No generated catalog or secret answer assets enter mobile bundles or public static hosting.

### Worktrees and checkpoints

After approval, Lead creates `codex/m1-04-playable` from accepted main and commits the contract/configuration freeze. Create sibling worktrees outside the repository at `/Users/hasanzahran/workspace/TypeDuel-m1-04-{backend,mobile,qa,content}` on corresponding `codex/m1-04-*` branches from that commit. Preserve existing unrelated files and downloaded agent setup artifacts.

1. Lead records the frozen schemas, mandatory gate, manifest/byte-reader and mobile adapter interfaces, then commits shared contracts/tests. Reuse this review; do not repeat whole-repository architecture research.
2. Start **at most two specialists**: Backend and Mobile implement concurrently in their isolated worktrees. Lead integrates shared configuration and runs existing checks. QA can define cases from the freeze, but starts an independent agent pass when a slot frees; add another specialist only for a concrete independent benefit.
3. Content worksheet/tooling is a bounded task for Lead or a free specialist slot. Editorial/credential approval can proceed while engineers code; synthesis never runs as part of a test. Use lower-cost capable models for routine documentation/worksheet work where selectable; reserve stronger reasoning for security, actor ordering, audio races and difficult failures. No duplicate broad reviews or model-cost claims without pricing evidence.
4. Integrate contracts → Backend gate/delivery → Mobile runtime/screens → independent QA tests. Preserve meaningful commits. Cross-review only changed interfaces and identified risks. Run targeted tests during each task, the complete suite at integration, and repeat only affected checks until the final exact-head CI pass.
5. Perform physical acceptance on the candidate build, then open one reviewable PR. No automatic merge, later increment or additional provisioning. Owner approval is required for implementation and external actions, not repeated routine engineering checkpoints within approved scope.

## 5. Exact eight-clip approval request

These remain **candidates**, not owner-approved recordings. Textual review found no concrete new homophone conflict in this bounded review; it is not exhaustive pronunciation clearance. Preserve the prior rejection of fish/phish. No dictionary recordings or definitions are copied into the assets.

| Exact input | Characters | Listening check                                |
| ----------- | ---------- | ---------------------------------------------- |
| `cat`       | 3          | Clear vowel and final /t/                      |
| `dog`       | 3          | Recognizable consistent US vowel; final /g/    |
| `cup`       | 3          | Clear final /p/                                |
| `milk`      | 4          | Intact /lk/, no added syllable                 |
| `desk`      | 4          | Intact final /sk/                              |
| `hand`      | 4          | Clear nasal and final /d/                      |
| `drum`      | 4          | Clear initial /dr/ and final /m/               |
| `frog`      | 4          | Recognizable US vowel, initial /fr/, final /g/ |

Request: **eight separate Amazon Polly `SynthesizeSpeech` attempts**, `us-east-1`, voice `Joanna`, engine `neural`, language `en-US`, `mp3`, sample rate `24000`, text type `text`. Each request contains exactly the lowercase word above, with no punctuation, whitespace, SSML, lexicons or speech marks. No alternate voice/engine, retries or speculative replacements. Configure SDK `maxAttempts: 1`; record an attempt before sending and stop/reconcile an uncertain response before requesting any further batch authority.

Total: **29 characters**. At the published Neural price of **US$16 per million characters**, estimated synthesis charge is **US$0.000464** before taxes or separate delivery costs, without assuming a free tier. Request a **US$0.01 synthesis-only ceiling**, plus hard eight-attempt/29-character limits. This is a software request bound, not a claim that a cloud billing alarm enforces an instantaneous cap. It authorizes neither storage creation nor hosting/egress charges. [Pricing](https://aws.amazon.com/polly/pricing/), [supported neural voices](https://docs.aws.amazon.com/polly/latest/dg/neural-voices.html), [API configuration](https://docs.aws.amazon.com/polly/latest/APIReference/API_SynthesizeSpeech.html).

An existing AWS account and authorized short-lived credentials with only the necessary synthesis access must be available. Do not create accounts, IAM resources or paid services implicitly. The proposed SDK avoids requiring an AWS CLI installation.

Before use, all eight exact final files need a named human editorial/listening decision with date, original input/provider provenance, generation configuration/run ID, opaque immutable version, final byte count, SHA-256 and measured decoded duration. Measure final decoded sample frames/rate and round duration up to milliseconds; do not estimate from text or MP3 bitrate. Strip/reject revealing metadata; any byte-changing processing creates a new version and needs renewed hash/duration/listening review. Record clipping, silence and intelligibility. Native duration cross-check and device playback remain required.

Built-in macOS `afinfo` and `afconvert` 2.0 support the proposed decode path; no FFmpeg installation is needed. After approval, inspect the final MP3 with `afinfo --warnings -r`, then run `/usr/bin/afconvert -f WAVE -d LEI16 <opaque.mp3> <private-temp.wav>` using argument arrays, bounded output and a timeout. Do not resample, trim or normalize during measurement. Parse bounded RIFF chunks (not an assumed 44-byte header), validate PCM, 24 kHz, channel/block alignment, nonempty complete frames and decoder exit status. Compute `ceil(frames * 1000 / sampleRate)` with integer arithmetic; cross-check the PCM metadata and unchanged original MP3 hash. Preserve tool/OS versions and measurement evidence; the canonical asset remains the MP3. Linux CI tests the parser and adapter without requiring Apple tools. Actual decoding awaits approved assets. Decoder success is not universal corruption detection or proof of acoustic timing; native playback and listening checks still apply. [Apple audio tooling](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/MultimediaPG/UsingAudio/UsingAudio.html).

Text sources: Merriam-Webster entries for [cat](https://www.merriam-webster.com/dictionary/cat), [dog](https://www.merriam-webster.com/dictionary/dog), [cup](https://www.merriam-webster.com/dictionary/cup), [milk](https://www.merriam-webster.com/dictionary/milk), [desk](https://www.merriam-webster.com/dictionary/desk), [hand](https://www.merriam-webster.com/dictionary/hand), [drum](https://www.merriam-webster.com/dictionary/drum), [frog](https://www.merriam-webster.com/dictionary/frog). Provider-output references: [Polly FAQ](https://aws.amazon.com/polly/faqs/), [AWS terms, section 50](https://aws.amazon.com/service-terms/). These references are not a fabricated human editorial or legal approval.

## 6. Environment inventory and owner prerequisites

Observed in this checkout during planning; unavailable locally does not mean the owner has no external account.

| Resource           | Observed                                                                                                                 | Needed for the phone pair                                                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Repository/runtime | Accepted main available; Node 24.13.0 and pnpm 12.15.0 available through the existing NVM path                           | No runtime upgrade                                                                                                                    |
| Supabase           | No local project URL, credentials or server/mobile `.env`; no connector session                                          | Existing project URL, public publishable key, asymmetric signing and two confirmed test users; configure secrets locally, not in chat |
| PostgreSQL         | No configured `DATABASE_URL`/`TEST_DATABASE_URL`, local server listener, Docker, Podman or PostgreSQL executable on PATH | Authorized private app database and separate disposable integration target; approved migrations and session ownership privileges      |
| Backend            | No API listening on port 3000; no configured reachable phone API origin                                                  | Run accepted backend plus approved 04 changes; separately make HTTP/WebSocket/audio routes reachable over HTTPS/WSS                   |
| AWS/audio          | No local AWS config/credentials or AWS CLI; no approved recordings                                                       | Owner approves bounded request and supplies existing authorized credentials; human listening approval                                 |
| iOS                | Command Line Tools only; no Xcode/Simulator tools                                                                        | Physical iPhone + compatible Expo Go preferred; previous M0 owner evidence is historical, not new gameplay evidence                   |
| Android            | SDK/adb, platform/build tools 37, JDK 17 and existing M0 AVD available off PATH                                          | Physical Android + compatible Expo Go for cross-phone acceptance; emulator is supplementary                                           |
| Devices/network    | No physical device details or current shared-network availability confirmed                                              | Owner confirms both phones, OS/Expo Go versions, Wi-Fi and permission for test session                                                |
| Audio inspection   | Built-in `afinfo`/`afconvert` 2.0 support MP3 to PCM; no FFmpeg/ffprobe                                                  | Run the bounded full-decode/frame-count validator on approved files; no new decoder installation proposed                             |
| TLS tunnel         | No cloudflared/ngrok/tailscale found on PATH                                                                             | Existing reachable TLS backend preferred; otherwise approve a temporary tunnel/tool separately                                        |

Use a direct PostgreSQL session connection. An existing Supabase session pooler can be evaluated if direct IPv6 connectivity is unavailable; verify connection options, private schema and advisory-lock fencing with actual tests. **Do not use the transaction pooler** for this actor's dedicated-session ownership or disable TLS certificate validation. An externally supplied database's actual version must be recorded; do not label it PostgreSQL 18.6 without checking. The already approved pinned PostgreSQL 18.6 GitHub Actions service remains the reproducible CI target. [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres).

The least disruptive route is existing authorized Supabase/database resources, Node on this Mac, and Expo Go on both phones. **The Expo QR code connects Metro; it does not expose or configure the backend.** `EXPO_PUBLIC_API_URL` must be a phone-reachable origin, never the phone's `127.0.0.1`; use that same approved origin for canonical audio routes.

If no existing TLS endpoint is available, propose an owner-approved development-only Cloudflare Quick Tunnel after tool approval: `cloudflared tunnel --url http://127.0.0.1:3000`. It supplies a temporary HTTPS origin without an account/domain, is not a production service guarantee, and still requires application authentication and WebSocket reachability testing. No tunnel has been installed or started. Do not add browser-interactive tunnel authentication that breaks native API requests. [Official quick-tunnel requirements](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).

No Xcode installation, paid Apple developer account, EAS/cloud build, public bucket or managed-backend subscription is required by this proposed Expo Go foreground slice. Actual network/account availability and existing plan costs remain owner confirmations. Do not provision a new project if resources are absent without permission.

## 7. Reproducible Increment 03 developer demo

### Available and rerun locally

With the installed workspace dependencies and Node 24.13.0:

```sh
cd /Users/hasanzahran/workspace/TypeDuel
export PATH=/Users/hasanzahran/.nvm/versions/node/v24.13.0/bin:$PATH
pnpm build:contracts
pnpm --filter @typeduel/server exec vitest run tests/game/registry.test.ts -t 'drives a complete' --reporter=verbose
```

**Observed in the earlier October 30 planning pass (not rerun for this documentation refinement):** contracts build passed; both selected tests passed (winner and eight-round draw; eight unrelated tests skipped by the filter). They use two actual Socket.IO clients and execute the real engine/transport with a component in-memory store, injected test identity, controlled clock and server-only synthetic word/audio fixtures. Scores are computed by the engine, not fabricated in a UI. This is a component technical demonstration, not actual Supabase, durable PostgreSQL or phone/audio acceptance.

### Real PostgreSQL + authenticated sockets

Provide `TEST_DATABASE_URL` through a private local environment pointing to an **already authorized disposable database**, never production. Do not paste it into a shared command transcript. Then:

```sh
pnpm build:contracts
pnpm --filter @typeduel/server test:integration tests/integration/transport-qa/delivery.test.ts -t 'five-round classic winner'
pnpm --filter @typeduel/server test:integration tests/integration/transport-qa/recovery.test.ts -t 'all 48 original ACKs'
pnpm test:integration
```

These start real backend HTTP/Socket.IO listeners, issue test-only signed JWTs against a local JWKS fixture and use real transactional PostgreSQL. They exercise computed scores, durable recovery and original ACKs without printing fixture answers or credentials. Synthetic descriptors/manual clock do not become approved audio. No production fixture endpoint or fake Supabase login is needed.

No local database is configured, so this tier was **not rerun locally**. Historical accepted evidence: [Increment 03 CI](https://github.com/hasanzahran/typeduel/actions/runs/41010072411), successful at `c9ce561c80d369969e8877fc207c7318a84d8761`, with 102 real PostgreSQL/Socket.IO integration tests and 198 unit/component tests. API status was rechecked during that planning pass; main was reconfirmed at the accepted merge during this refinement. The accepted merge has the same implementation tree. GitHub's ephemeral database is a test target, not an always-on phone backend.

## 8. Tests and acceptance

### Automated gates after implementation

Run a clean full-graph policy-respecting install, then `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm expo:check`, `pnpm test:integration`. Existing build covers web/iOS/Android production exports and release-boundary checks. Include offline-tool tests/type checks and no-service dry-run. Require both quality and real PostgreSQL/Socket.IO CI jobs at the exact final PR head; no paid calls in CI.

Independent QA must demonstrate:

| Scenario                                                        | Required outcome                                                                          |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Foreign user, stale session, wrong round/version, expired grant | No privileged bytes/metadata; static errors                                               |
| Corrupt/truncated/hash-mismatched or undecodable audio          | No readiness; common interruption, no point                                               |
| Fewer than eight approved assets or unsupported setup           | Admission unavailable; no fallback/repeated word                                          |
| Readiness just before, at and after preflight deadline          | Trusted FIFO before deadline only; retries never extend it                                |
| Completion before clip end / exactly at lower boundary          | Early rejected; lower-bound eligible                                                      |
| Completion just before `typingStartAt`, COMMIT delayed          | Timely receipt retained in FIFO; no speculative ACTIVE                                    |
| Completion at typing start, or only one completion              | Shared interruption before scoring                                                        |
| Slow schedule COMMIT, update and explicit sync                  | Same canonical schedule; late playback refused, gate prevents scoring                     |
| Replacement after old completion                                | Proof cleared, stale socket fenced, no schedule extension                                 |
| Rollback/uncertain COMMIT/restart                               | Only reconciled committed state published; no phantom wins or resumed stale clock         |
| Late failure after closed round/terminal result                 | Existing outcome immutable; original counted retries recoverable                          |
| Double replay tap, ACK loss, reconnect, cold restart            | No third replay, refund or accidental initial replay                                      |
| Old async callback/background/media reset                       | No stale playback, unlocked input or automatic resume                                     |
| Secret/fixture/bundle/log inspection                            | No early spelling, token, submitted guess, private catalog or synthetic production source |

Keep previous Classic/Challenge core tests intact even though only General/Classic/Level 1 has real assets in this slice.

### Physical pair evidence, never inferred from exports

Record actual commit/build, both device models/OS/Expo Go versions, network, exact asset hashes and measurement method. Complete a five-round winner and an eight-round draw, then compare both phones with persisted database state. Exercise attempts/exhaustion, two replays, late messages, delayed asset delivery/completion, ACK loss, reconnect inside/outside ten seconds, backgrounding and server interruption.

Capture Gameplay/Results on both phones, including the keyboard. Validate safe areas, Submit/Send, large text, VoiceOver/TalkBack, focus and audible status behavior. Record acoustic onset/end separately from JS invocation/native callbacks using a shared external recording or another documented synchronized measurement; report resolution and uncertainty. For approval, freeze the supported-profile gate at worst-observed inter-phone audible onset skew **plus measurement uncertainty ≤150 ms**. The earliest possible input unlock must be no earlier than the latest possible audible end on either phone. Inconclusive measurements do not pass; improve measurement or the implementation instead of widening the gate after a failure.

Any premature unlock, phantom point, per-player deadline extension, pre-result spelling disclosure, divergent result or changed terminal outcome blocks this increment. Client completion reports and local replay controls are advisory behavior of the reviewed app, not cryptographic proof against a modified client or external recording. Record keyboard assistance honestly: a playable development pair may be demonstrated, but **full competitive M1 acceptance remains blocked until the approved fairness solution is evaluated and resolved**.

### Strict definition of done

- All existing and new unit, security, regression and real PostgreSQL/Socket.IO tests pass; clean policy-compliant installation, frozen lockfile, formatting/lint/types, Expo Doctor/compatibility and all production exports pass. Required CI is green at the exact final PR head.
- All eight recordings have actual editorial and listening approval, immutable hashes/version IDs, measured duration and proven matching bytes on both phones. The application contains no catalog/answer fixture fallback.
- Run **20 attempted healthy-profile matches** on the exact candidate build: eight planned iPhone wins, eight Android wins and four eight-round draws through actual human input/expiry. Record all failed attempts in the denominator. Require at least 18/20 completion (the PRD's observed 90% target), zero safety defects and no unresolved reproducible defect; a small acceptance sample is not proof of a production SLO. Repeat the affected matrix after fixes, retaining prior failures.
- Initial supported profile: the recorded physical iPhone/Android pair, foreground, built-in speakers, same stable Wi-Fi and the authorized backend path. Freeze actual OS/Expo Go versions and measured RTT/jitter before the run. Meet the acoustic/typing gate above on measured rounds. Bluetooth and broader devices remain documented later coverage, not implied passes; route changes must still fail safely.
- Automated network matrix includes 20/100/200 ms RTT, asymmetric delay/jitter, loss/reordering, delayed database COMMIT and 300+ ms/timeout scenarios. Outside the supported freshness/timing envelope, prove visible refusal/interruption with no score or private time extension; do not promise successful matches on every connection.
- Physical failure checks cover attempts, two replays, dropped ACK recovery, asset failure, backgrounding, ordinary reconnect inside/outside ten seconds and server restart. Compare both clients with persisted outcomes. Test terminal immutability and retained ACKs automatically and in representative device recovery.
- Native keyboard-open layouts, Submit/Send, large text, screen-reader focus/announcements, reduced motion and accessible controls pass on both platforms. Record screenshots/video and exact build provenance. Exports, simulated adapters and M0 evidence cannot substitute.
- Lead and independent QA review the integrated diff. No unresolved authorization leak, early spelling, premature unlock, phantom point, altered terminal result, divergent score or unbounded resource path. Physical evidence is required before calling Increment 04 complete. Competitive keyboard resolution remains a separate unwaived M1 acceptance gate.

### Rework risks and extension boundaries

| Risk                                                             | Required prevention / boundary                                                                                                                                                                                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native scheduling or clock uncertainty exceeds the acoustic gate | Measure early with the native adapter; fix causes. If Expo Audio cannot meet the gate, stop for a narrowly scoped native-library/build proposal. Do not hide skew by extending one player's timer.                                                 |
| Filesystem catalog becomes permanent game logic                  | Existing `RoundSource` selects reviewed metadata; separate private byte reader supplies immutable versions. M2 replaces adapters, not actors/contracts/screens. No live file overwrite or hidden pool fallback.                                    |
| Dev sign-in becomes the gameplay architecture                    | Restricted launcher injects the existing token-provider/runtime interfaces. OAuth, secure persistent credentials and full Home flows remain later scope without rebuilding gameplay.                                                               |
| Session/owner changes during awaited download or commit          | Reauthorize after awaits, fence callbacks, reconcile uncertain COMMIT and preserve receipt ordering; independent fault tests.                                                                                                                      |
| Checkpoint migration or deployment overlap                       | v1 read compatibility/v2 writes, reviewed migration and explicit rollback constraint. Owner fencing is not zero-downtime deployment. No rolling deploy during phone tests; controlled production drain remains required before production hosting. |
| UI loses committed results or uses a stale clock sample          | Bounded result ledger, fresh-sample selection and focused regression tests; presentation never controls server phase.                                                                                                                              |
| Eight-word inventory mistaken for launch content or anti-cheat   | Enough only for five plus three rounds without repeats. Human review, expanded M2 pools and M1 keyboard fairness remain required; modified-client capture/assistance is not solved by completion reports.                                          |

Future rematches create a **new match ID** through existing admission; invitations reuse room preview/join; sharing uses a sanitized completed-result projection; keyboard work replaces an input adapter without changing commands; statistics/rankings derive from durable committed outcomes, not socket delivery. Privacy-conscious analytics can consume allowlisted post-commit events later with explicit retention/consent. Do not add endpoints, tables, SDKs, analytics services or speculative frameworks for these future features now.

## 9. Approval and outstanding items

Requested approvals are separable:

1. Implement this bounded Increment 04 plan, including the shared 1,000 ms playback margin, 20-second preparation expiry, separate fixed typing-start completion gate, proposed dependencies under unchanged security policy, private development manifest and minimal dev authentication entry.
2. Approve the eight candidate inputs and Joanna configuration, and authorize the single eight-attempt/29-character synthesis batch with US$0.01 ceiling using an existing authorized account. Human listening approval remains necessary afterward.
3. Identify existing Supabase/database resources and both available phones. If a reachable TLS backend is absent, approve the specific tunnel installation/exposure separately before it occurs.

No Increment 04 application implementation, dependency installation, generation, paid service, custom keyboard, major visual change, merge or later increment is authorized by this document itself. Planning checks and the existing component demonstration are actual evidence; all new-feature/native checks remain pending.
