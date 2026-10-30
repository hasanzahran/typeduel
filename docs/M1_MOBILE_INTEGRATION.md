# M1 mobile integration handoff

Date: October 30, 2026. Status: the six headless Increment 03 modules are implemented against the approved realtime freeze; audio and UI integration remain later increments. This document records the agreed consumer design and bounded route to the first physical iPhone versus Android match. It does not certify native behavior or change the approved UI.

Sources: [implementation plan](IMPLEMENTATION_PLAN.md), [increment 01 contract/core plan](M1_INCREMENT_01_PLAN.md), [architecture decisions](ARCHITECTURE_DECISIONS.md), [PRD](PRD.md) and [UI/UX design](UI_UX_DESIGN.md). The approved 10-second development interruption policy takes precedence over older System Design wording about forfeits. Companion content preparation is in `M1_CONTENT_PREPARATION.md`.

## 1. Ownership and boundaries

The server owns identity authorization, phase, word selection, clocks, attempts, correctness, scoring, progression and results. Mobile consumes shared Zod contracts and authoritative viewer snapshots. Only the lead changes shared contracts, dependency manifests/lockfile and canonical plans; backend owns persistence, actor scheduling and transport authorization. Mobile owns explicitly assigned consumer, audio, screen and mobile-test files.

Preserve the approved charcoal/teal tokens, hierarchy, native keyboard and existing compact keyboard-open layout. No custom keyboard, cloud provisioning, paid audio generation, release signing or store publication is authorized by this handoff. The existing fixture previews are not real gameplay and must never supply fallback outcomes.

## 2. Committed update and recovery contract

The increment 01 engine returns a final candidate state and an ordered list of versioned atomic batches. A delayed wake can produce several batches, so an intermediate snapshot for every batch is not required. The future transport sends one match-bound update containing the final authorized viewer snapshot and ordered batches from the committed operation.

The lead froze `packages/contracts/src/realtime.ts` for Increment 03. Its invariants are:

- The envelope identifies the match even when every batch has no events. Its final state version equals the snapshot version.
- Batch versions strictly increase, never exceed the final snapshot version, and end at that version when the list is nonempty. Every contained event belongs to that match.
- Snapshot-only sync is valid. A no-op historical answer retry may return an ACK whose original version is older than the accompanying current snapshot.
- The publisher exposes only committed state. The snapshot and batches represent the same committed operation, never a later actor state sampled opportunistically. Viewer counters/history are individually authorized; never broadcast one viewer's projection to the opponent.
- Public times are Unix UTC milliseconds. Monotonic receipt timestamps, ingress sequence and internal clock anchors stay server-private.
- The whole update is validated before application. An invalid packet causes sanitized error handling and canonical resynchronization, without exposing raw validation inputs.

With a full current snapshot in each update, a private version gap does not require reconstructing missing deltas or inferring a result. Reconnect, incomplete/invalid delivery and uncertainty require canonical sync. If a later transport chooses delta-only delivery, it must explicitly add gap recovery before use.

No outbox is required for this bounded recovery model: a lost post-commit publication is repaired from committed state and the viewer's counted-attempt ledger. Missed intermediate round feedback may not replay after advancement. Show the latest authoritative state; final completion includes the final round result. Persisted outcomes/history remain authoritative. This does not promise delivery of every past event, animation or audio effect, or resumption across server process loss.

## 3. State, effects and answer acknowledgements

Maintain separate canonical state and presentation-effect bookkeeping:

1. Scope state versions to the match. Apply a validated newer viewer snapshot atomically; never roll back to an older snapshot or derive scores from events.
2. Deduplicate presentation by match, round and effect identity, independently of state-version application. A snapshot arriving first must not suppress applicable same-version result feedback; repeated updates must not replay initial audio or navigate twice.
3. Discard superseded countdown, playback and result-overlay effects when a newer round/phase is already current. Snapshot recovery presents current result/completion without replaying all historical sounds.
4. Allocate one attempt ID per deliberate submission. Keep the exact validated payload while it is unresolved; retries use that ID and payload. Do not trim or otherwise change it after dispatch. The protocol limit is 120 UTF-16 code units before server normalization.
5. Only counted `INCORRECT`/`CORRECT` outcomes reserve IDs and replay immutably. Rejected IDs remain unreserved. A repeated rejected command is freshly evaluated and may later count, so the normal client does not automatically retry a definitive rejection; a new deliberate submission receives a new ID.
6. Correlate ACKs by match, round and attempt. An old rejection cannot replace a counted outcome, and an old counted ACK cannot overwrite newer attempts remaining. A result may arrive before its answer ACK. Resolve uncertain requests from the viewer's counted history after sync.
7. An ACK for one request cannot clear another pending request or reopen a closed round. Never derive current phase or score from the ACK's original version.

The core's global counted history is bounded to 48 submissions; the viewer receives at most their own 24. Do not retain raw guesses in logs or telemetry. Clear transient answer input when its round is superseded.

## 4. Authentication, sessions and connection loss

Use the authenticated `/game` namespace with an injected token-provider interface. The server verifies identity, expiry and match membership on connection/reconnection and each authorized action. Socket identifiers and client-supplied player IDs are not identity proofs. Provider-specific sign-in UX remains outside the bounded consumer.

Local test identities may be injected only through an explicitly enabled local/test server verifier. No arbitrary identity override is accepted by the production verifier, and no test credential, provider secret or answer catalog is bundled into mobile or `EXPO_PUBLIC_*` values. A development match link identifies a match; it grants no membership.

The adapter uses a server-owned session generation for each participant. After an authenticated replacement becomes current, commands and late disconnect callbacks from the superseded session are fenced out. Client callbacks also carry a local connection generation so an obsolete connection cannot update a new session. The frozen session scope is `{serverInstanceId, sessionId, admissionRevision}`. Compare admission revisions only within the same instance/session; compare match state versions separately by match. A replacement emits `SESSION_REPLACED`, which stops automatic reconnect until the host deliberately reconnects.

On connection loss, disable new submissions, retain unresolved request identity, and show reconnecting while the server timer continues. Authenticate and sync on return before enabling actions. Reconnect strictly before 10,000 ms may clear grace; at or after expiry an ongoing match is interrupted without a winner. An obsolete socket must not start or extend grace for the current session. Disconnect clears only unscheduled audio readiness; committed schedules never restart.

Surface authentication expiry, unavailable service, invalid membership and unrecoverable sync errors with honest recovery actions. Infrastructure restart needs an explicit `SERVER_RESTART` interruption reason and a non-win persisted/public outcome; do not label it as player disconnect or content failure. Confirmed terminal completion remains terminal.

## 5. Phase presentation and audio fairness

| Canonical phase   | Presentation and actions                                                                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `PREPARING_ROUND` | Preparing next word; preload and decode exact approved asset; submissions/replays disabled; readiness only after success. |
| `COUNTDOWN`       | Get ready; display time until scheduled playback; evaluate native keyboard pre-opening without enabling submissions.      |
| `PLAYING_WORD`    | Listen carefully; initial playback once for this round/asset; submissions disabled.                                       |
| `ACTIVE_TYPING`   | Time remaining; at most three counted submissions and two local replays; no timer extension.                              |
| `ROUND_RESULT`    | Read-only spelling reveal and winner/no-point feedback; played level and next level stay distinct.                        |
| `COMPLETED`       | Authoritative win/loss/draw and final round result; hide unmeasured statistics.                                           |
| `ABORTED`         | Match interrupted; historical scores may remain, with no winner or celebration.                                           |

Checking, reconnecting and audio failure are local presentation overlays, not client-owned game phases. The visual timer uses the server schedule plus measured clock offset and local monotonic elapsed time. Refresh sampling after foreground/resume. Local expiry can disable input but cannot invent a timeout result. Device timestamps never award points or compensate answer latency.

Replay playback starts locally without waiting for telemetry ACK. Keep spent replay sequences across ordinary reconnect and reconcile conservatively: a lower server telemetry count never restores credits. Before increment 04 implementation, decide failed-play accounting, overlapping replay behavior and durable local restart recovery. Do not claim replay limits survive lost local state until tested.

**Slow database/late audio-start gate:** committing before publication is required, but a slow commit can consume countdown lead and make a published playback time already past. Never silently play late and give that phone a private typing window. Measure commit-to-publication delay and actual playback start/end; test delayed commits and asymmetric delivery. Increment 04 must approve a common preflight failure/reschedule-or-interrupt policy, with no client complaint directly rewriting committed schedules or winners. Adequate lead/margin and the actor's committed publication timing must be verified together before claiming fair playable timing. The pure engine does not establish this gate.

## 6. Future file assignments and first-match sequence

Increment 03 implements only the six headless modules listed below. Increment 04/05 file assignments remain proposals requiring their own approval. Shared package/configuration edits remain lead-owned. Versions and compatibility of proposed dependencies must be verified at their implementation checkpoint; preserve Expo baseline and dependency-age policy.

| Increment                         | Proposed mobile files                                                                                                                                                                                                                                | Dependency and review gate                                                                                                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 03: bounded connection/consumer   | `apps/mobile/src/auth/token-provider.ts`; `apps/mobile/src/features/match/connection.ts`, `consumer.ts`, `commands.ts`, `lobby.ts`, `clock.ts`; six corresponding `.test.ts` files                                                                   | Auth/session/sync/update contracts and committed actor boundary; approved `socket.io-client` dependency. Two independent clients converge; no screen changes.                                     |
| 04: audio and first playable pair | `apps/mobile/src/audio/adapter.ts`, `preload.ts`, `scheduler.ts`, `replay.ts` and tests; `apps/mobile/src/features/match/GameScreen.tsx`, `ResultsScreen.tsx` and tests; `apps/mobile/src/dev/RealMatchHarness.tsx`; `apps/mobile/app/dev-match.tsx` | Reviewed eight-asset General/Classic/Level-1 set, authorized delivery, approved SDK-compatible audio/cache/integrity capability. Physical iPhone versus Android complete a restricted real match. |
| 05: complete flow                 | Explicitly assigned Home/Setup/Game/Results route wiring, lobby/queue/invite views and necessary shared UI primitive bindings                                                                                                                        | Broader modes/categories and navigation; owner reviews any required visual change.                                                                                                                |

Increment 04 explicitly brings forward only the minimum Game/Results bindings from 05. Reuse the approved layout and components; do not import fixture-driven preview state into real gameplay. The development-only harness authenticates two real test participants and opens an authorized server-created restricted match. It uses no mock opponent, local scoring or fake-success fallback. Guard the route/module using the existing development-only loading pattern and verify production exports exclude the harness and test configuration. Unsupported rematch/provider flows must not pretend to work.

This sequence permits the first real physical pair by the end of 04 without waiting for all Home/Setup/lobby polish. It does not shrink full M1 requirements. December is a target, not acceptance evidence.

## 7. Acceptance matrix and evidence

| Area                    | Required tests/evidence                                                                                                                                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Committed updates       | Rollback publishes nothing; lost publication syncs to durable state; multi-batch delayed wake; empty/private batches; cross-match or inconsistent envelopes rejected.                                          |
| State/effect separation | Snapshot before same-version batch; duplicate update; older batch after newer snapshot; atomic final result/completion; missing intermediate feedback followed by latest snapshot; no historical audio replay. |
| Commands                | Lost counted ACK, exact retry, stale rejection after acceptance, historical ACK after newer counters, definitive rejection followed by a deliberate new request, terminal result before ACK.                   |
| Session/recovery        | Replacement session; old socket disconnect/command; token expiry; unauthorized sync; reconnect at 9,999/10,000 ms; server restart interruption without phantom win.                                            |
| Audio/timing            | Same asset/checksum, decode readiness, bad/missing/expired access, slow commit, delayed start, speakers/headphones/Bluetooth, interruptions/backgrounding, two local replays and no extensions.                |
| Native input/layout     | Compact and tall iPhone/Android, keyboard open, larger text, timer/replay/input/Submit reachable, early focus, Submit/Send, hardware input, predictive bars and alternate IME behavior.                        |
| Accessibility/fairness  | VoiceOver/TalkBack, switch access, focus restoration, touch targets, reduced motion; prediction/autocorrect/spellcheck/autofill/paste/dictation/text replacement and English/diacritics evaluated honestly.    |

First-pair evidence records exact commit/build, device/OS/runtime, IME, font scale, network/audio route, screenshots, measured playback timings and matching client/database outcomes. Add same-platform pairs and broader network conditions afterward. M0 owner evidence and production exports are not proof of M1 native gameplay. Gboard assistance remains an M1 acceptance issue; custom keyboard implementation is unapproved.

## 8. Increment 03 integration API and verification

`MatchConnection` accepts the public API base URL, an injected `TokenProvider`, and an injected UUID request-ID factory. Provider sign-in/refresh and native UUID capability belong to the host integration; this module contains no Supabase SDK, credentials, test verifier or account setup. The default Socket.IO adapter connects to `/game` with handshake `auth.accessToken`, disables automatic reconnect/offline recovery, uses volatile emits and clears its isolated send buffer to cover unwritable/expired-heartbeat cases, and creates a fresh isolated socket after ordinary connection loss. Its bounded reconnect delay is connection retry pacing, not the authoritative server grace period.

`connect()` begins authentication; observe `status === 'ready'` and `consumer.ready` before enabling actions. `synchronize()` performs canonical `session.sync`. If publication arrives between snapshot capture and the sync ACK, another full sync completes before actions are enabled. `SESSION_REPLACED` and `UNAUTHENTICATED` stop automatic reconnect. A deliberate host action can call `connect()` after replacement or provider refresh. `disconnect()` fences callbacks and removes transport listeners. No packet is queued while offline and no gameplay command is automatically retransmitted.

`MatchConsumer.state` and `.snapshot` return copies. `subscribe()` observes canonical application; `takeEffects()` drains independently deduplicated applicable presentation events. The host observes connection status separately. Historical audio and superseded overlays are discarded. Canonical state remains available while disconnected, but its actions are disabled. Only authenticated full sync establishes a new server/session scope. Empty batches and version gaps are safe because every accepted envelope contains a complete viewer snapshot.

`MatchCommands.createAnswer(text)` returns a new attempt ID for one deliberate submission; `sendAnswer(id)` sends or explicitly retries its exact uncertain payload. Concurrent retries share one request. Counted history resolves lost ACKs and takes precedence over delayed rejected ACKs; ACK counters never mutate canonical counters. Rejected submissions require a new deliberate ID. Raw pending text is cleared when authoritative state supersedes its round. `GameplayFailure` exposes an allowlisted engine code; `ClientFailure` exposes an allowlisted transport/local code. Neither includes submitted text, provider errors or raw validation details. Call `dispose()` when discarding a command adapter. New pending submission creation is capped at 64 local records; counted recovery is separately bounded by the viewer's 24-entry history.

`MatchLobby` implements queue join/leave, lobby readiness and private-room create/preview/join/cancel. `ready(lobbyId, ready)` never emits audio readiness. HTTP uses Bearer authorization and `x-typeduel-session-id`; scoped replies cannot replace newer admission. A reused control request ID preserves its original `expectedAdmissionRevision` and payload fingerprint. Its bounded 128-request ledger rotates settled records when authenticated server/session scope changes, retains unresolved fingerprints, and fails closed at capacity; it never evicts an uncertain request then silently retries it with a new revision. Hosts should create one adapter per admission flow, keep it through uncertain retries, and use fresh UUIDs for subsequent flows. Reusing IDs across discarded adapters is unsupported. Preview data never changes admission.

`reportDecodedAudio()` is an explicit, exact-current-round/asset call reserved for the future audio adapter. `reportReplay()` reports an already allocated local replay sequence and conservatively retains spent credits through ordinary reconnect, including lost telemetry ACKs. It does not play audio and makes no claim about replay recovery after process death. The Increment 04 adapter must decide failed playback and overlapping playback accounting.

`DisplayClock` uses correlated server samples and monotonic elapsed time, discards wall-clock jumps and stale samples, and supplies display estimates only. Call `clock.invalidate()` on suspension/foreground changes and `sampleClock()` after reconnect/resume and periodically during a match. No client clock value changes a gameplay payload, timer, score or winner.

Local validation: pinned Node 24.13.0/pnpm 12.15.0 frozen installation, contracts build, mobile TypeScript, ESLint and the complete mobile Jest suite. The added cases cover private version gaps, final result/completion atomicity, snapshot-before-same-version effects, stale admission/HTTP ordering, sync/publication races, replacement reconnect suppression, token refresh, exact answer retries, stale ACKs, transient input cleanup, UTF-16 bounds, conservative replay recovery and clock sampling. The UTF-16 case exposed a shared-schema gap; the lead supplied the explicit 120-code-unit refinement before final validation.

These are headless adapter and fixture tests. They do not certify live Supabase authentication, production-source availability, actual native networking/audio, physical keyboard behavior or two-phone fairness. The lead/QA own real Socket.IO plus PostgreSQL integration evidence at the final integrated head. No screen, route, theme, keyboard or audio implementation was changed here.

## 9. Increment 04 entry gates and minimum binding strategy

Keep the approved Game/Results hierarchy and primitives. Use the development-only real-match harness and minimum existing Game/Results bindings from section 6; full Home/Setup/lobby polish remains 05. Bind rendering exclusively to canonical snapshots; bind checking/reconnecting overlays to local adapter state. Never use preview fixtures as fallback outcomes or claim unsupported rematch/provider behavior works.

Before first physical iPhone versus Android play, obtain the owner-approved eight-asset General/Classic/Level-1 set, actual provider/test identities and reachable authenticated backend/TLS configuration. Approve SDK-compatible preload/decode/checksum/playback capabilities; validate exact bytes/version before readiness. Add lifecycle wiring that invalidates the display clock and suspends input during synchronization, while server timers continue.

Agree the shared slow-commit/late-audio-start failure policy before claiming a fair match: measure commit-to-publication, scheduled versus actual playback start/end, asymmetric delivery, interruptions and background/resume. No phone gets a private timer extension. Test the unchanged layouts with native keyboards, compact/tall phones, font scaling, VoiceOver/TalkBack and available keyboard-assistance controls. Record exact build/device/OS, audio route, timings and matching server outcomes. The first complete physical pair is the Increment 04 acceptance milestone; exports and headless tests are preparation evidence only.
