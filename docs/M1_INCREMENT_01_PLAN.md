# M1 increment 01 — gameplay contracts and deterministic server core

**Status:** Proposed; awaiting explicit owner approval before application-code changes.

**Date:** October 29, 2026.

**Base:** `origin/main` at `26f8476ed900d4cfd17a97f229e0226ca7251c91` (merged PR #2).

**Branch:** `codex/m1-gameplay-core`.

**Sources:** approved PRD v0.4, System Design v1.2, UI/UX v1.0 and the owner's approved M1 scope/development reconnect policy in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## 1. Outcome and boundaries

Deliver a deterministic server-only game core and strict public gameplay contracts. Tests will drive two logical participants through timed rounds, counted attempts, scoring, Classic/Challenge progression, complete matches and reconnect expiry. This is the first independently reviewable piece of real multiplayer, not a claim that two phones can already connect.

Keep this increment free of new dependencies, network access, database operations and app/UI changes. Socket.IO, identity verification, actor scheduling, transaction persistence, actual prerecorded audio, mobile integration, custom keyboard selection and external provisioning belong to later approved increments. The existing Fastify application remains a health-only app until those adapters are implemented. No changes to approved designs, tokens, screenshots, package manifests, lockfile or dependency security settings are planned.

The engine computes authoritative deadlines and due transitions. A future actor will schedule real callbacks and serialize network receipts; increment 01 tests the timer logic using injected time, without adding an autonomous production timer loop.

## 2. Exact file scope after approval

Paths are relative to the repository root. New files below do not exist yet.

| File                                        | Action                      | Responsibility                                                                                                                                  |
| ------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/setup.ts`           | Add                         | Move existing mode/category/difficulty/setup schemas unchanged into a leaf module, avoiding circular imports when gameplay schemas reuse them   |
| `packages/contracts/src/gameplay.ts`        | Add                         | Strict public commands, acknowledgements, discriminated snapshots, round schedules/results, completion and interruption schemas; inferred types |
| `packages/contracts/src/index.ts`           | Modify                      | Re-export setup and gameplay schemas while preserving existing M0 exports and health/error contracts                                            |
| `packages/contracts/tests/gameplay.test.ts` | Add                         | Valid/invalid packets, authority boundaries, phase discriminators, ranges, cross-field invariants and answer exposure rules                     |
| `apps/server/src/game/types.ts`             | Add                         | Private state, trusted command context, server-selected round descriptor, transition output and injected clock types                            |
| `apps/server/src/game/rules.ts`             | Add                         | Server rule configuration, normalization and deterministic score/progression/match-completion helpers                                           |
| `apps/server/src/game/engine.ts`            | Add                         | Pure state transitions, readiness/timelines, attempt deduplication, scoring, expiry, reconnect grace and interruption                           |
| `apps/server/src/game/snapshot.ts`          | Add                         | Participant-authorized, explicit allowlist projections of internal state into public schemas                                                    |
| `apps/server/tests/game/fixtures.ts`        | Add                         | Deterministic IDs, clocks and server-only synthetic word/audio metadata for unit tests; no MP3s or approved-content claims                      |
| `apps/server/tests/game/engine.test.ts`     | Add                         | Rule, timing, ordering, normalization, idempotency, progression, terminal-state and reconnect tests                                             |
| `apps/server/tests/game/snapshot.test.ts`   | Add                         | Both-player state agreement, secret redaction, result reveal, snapshot immutability and membership checks                                       |
| `docs/M1_INCREMENT_01_PLAN.md`              | Update after implementation | Record actual files/checks/results and review status; never pre-mark acceptance passes                                                          |
| `docs/IMPLEMENTATION_PLAN.md`               | Update after implementation | Record increment status and next review gate                                                                                                    |

Existing `packages/contracts/tests/contracts.test.ts`, mobile tests and server health tests stay in the suite unchanged as regression coverage. Any additional application file or dependency discovered to be necessary must be explained at the review checkpoint rather than silently expanding the increment.

## 3. Dependencies and compatibility

**No new packages or version changes.** Reuse Node 24.13.0, pnpm 12.15.0, TypeScript 6.0.3, Zod 4.6.7 and Vitest 5.0.5. Existing Expo SDK 58 and React Native 0.88.1 stay untouched.

Keep `minimumReleaseAge: 1440`, existing build-script allowlisting and strict TypeScript settings intact. No new schema/state-machine framework, Socket.IO, Drizzle, database driver, audio library or custom keyboard package is needed to prove this core. Existing workspace test/build discovery should find the new files without script or CI edits.

Use explicit inputs for time, IDs, selected round data and processing order; no random UUID generation, `Date.now()`, uncontrolled timers, filesystem calls or HTTP in the reducer. Node built-ins may support a deterministic, private payload fingerprint for detecting conflicting reuse of an attempt ID; no raw guesses are logged or projected publicly.

## 4. Public contract design

Reuse existing `MatchSetupSchema` and its General-only Quick Match rule. Keep the existing public import path compatible.

Add the minimal gameplay protocol needed by this core:

- `answer.submit`: strict `{matchId, roundId, attemptId, text}`. UUID identities; bounded non-whitespace text (proposed maximum 128 UTF-16 code units). No client timestamp, score, player identity, level or deadline fields. Malformed commands do not consume attempts.
- `round.audio_ready`: round identity and the exact prepared public asset version, resolved within an authorized match context. Readiness is advisory and cannot choose a word or schedule.
- `round.replay_used`: round identity and replay sequence 1 or 2; used for idempotent bookkeeping only. Future legitimate-client playback is not gated on its network acknowledgement.
- Answer acknowledgement: stable status and private attempts remaining, without echoing the guessed text or expected spelling. Define explicit statuses for incorrect/correct, not typing, closed/stale round, exhausted attempts, invalid command, unauthorized member and conflicting attempt-ID reuse.
- `match.snapshot`: discriminated phase, match/settings identity, exactly two distinct participants, round number, scores, current level, authoritative schedule when applicable, connection/grace status, state version and viewer-specific counters. Do not include another player's guess or private attempt acknowledgement.
- `round.prepare` / `round.start`: opaque authorized audio descriptor, version and verified duration; scheduled playback/typing/deadline fields. No server catalog ID or answer. Unit tests use dummy opaque URLs and never fetch them; real authorization/signing is later work.
- `round.result`, `match.complete`, `match.interrupted`: mutually consistent winner/draw/interrupted states, participant-bound winner IDs, scores, round/level state and monotonic version. Correct spelling is allowed only for a closed round result; variants and internal lookup IDs stay private.

Validate unknown fields strictly and enforce integer/nonnegative counts, attempts 0–3, replay bookkeeping 0–2, level 1–5, round 1–8, participant uniqueness, winner membership and ordered schedule fields. A completed draw has no winner; interruption is not a draw or win. Schema-validation failures must not reflect private inputs in public errors.

Do not freeze queue, auth, persistence or audio-provider contracts that this increment cannot exercise. Extend them in their own reviewed increments.

## 5. Engine interface, authority and state

Proposed API: `createMatch`, `applyCommand`, `advanceTime`, `getNextWakeAt` and `projectSnapshot`. Keep the implementation functional: identical starting state, configuration and ordered inputs produce identical next state, acknowledgements and candidate events. Do not mutate prior states or fixtures.

`createMatch` receives immutable setup, a match ID and two distinct server-resolved participant IDs. This increment begins after room admission; waiting-room creation/join/authentication is not implemented. The engine still checks membership for every player-scoped action. Future transport adapters must verify authentication and supply the trusted identity separately from the validated public payload.

Internal phases cover `PREPARING_ROUND → COUNTDOWN → PLAYING_WORD → ACTIVE_TYPING → ROUND_RESULT`, followed by another preparation or `COMPLETED`; `ABORTED` is a separate terminal state. Use the existing approved phase meanings instead of introducing client-owned phase changes.

A trusted prepare command supplies the server-selected private word ID, canonical spelling/approved variants, category eligibility, difficulty, opaque public audio descriptor and verified clip duration. Enforce immutable match settings, the current level and no reuse of a private word ID. An invalid descriptor does not reveal its secret fields. Pool selection, eight-candidate coverage checks, cryptographic randomness and editorial approval occur in the future catalog adapter; tests nominate explicit synthetic descriptors and cannot certify real catalog coverage. An explicit unavailable-source command aborts without substituting a category or awarding a match win.

The engine returns **candidate state and events**, never socket broadcasts or committed database results. Increment 02 must install the serialized actor and atomic store: persist the relevant transition before publishing anything. In-memory unit-test success is not proof of database race/crash safety.

## 6. Timers and ordering

- Server context supplies nondecreasing monotonic time and an anchored UTC mapping for public schedules; clients supply neither. Unit tests advance an explicit clock instead of sleeping.
- Both participants must be connected and acknowledge the prepared asset version before scheduling. Duplicate readiness does not restart a countdown.
- First countdown is 3,000 ms. Later countdown lead and playback margin are explicit validated server configuration, not client inputs; test values do not claim measured audio tuning.
- `typingStart = playbackAt + verifiedClipDuration + playbackMargin`; `deadline = typingStart + typingDuration[level]`. Provisional level durations remain 8,000/8,000/10,000/12,000/15,000 ms.
- Input is rejected before typing, accepted exactly at typing start, and rejected exactly at or after deadline. Receipt time is assigned at the server boundary, not after a later asynchronous operation.
- Model commands in explicit server receipt order; same-time commands retain their ingress sequence. A future actor must preserve that order while a database operation is pending. There is no latency compensation or client-clock tie-breaker.
- `advanceTime` processes due phase/deadline/grace transitions in chronological order, including after a delayed wakeup; repeated calls at the same time do not repeat outcomes. `getNextWakeAt` exposes the next due transition for the future actor.
- At equal answer-deadline and reconnect-grace expiry, interruption takes precedence for an ongoing match, preventing a new final winner at the grace boundary. An arrival exactly at either closed boundary cannot revive play.
- Expiry closes a scoreless round once. Both players exhausting attempts does not create an earlier unapproved deadline. Preparing the next round is a trusted server action; a client cannot skip result presentation or generate a round.

## 7. Attempts, scoring and progression

1. Validate shape and authenticated-context membership, match and round identity.
2. Resolve a previously processed key `(matchId, roundId, playerId, attemptId)` before rejecting a retry solely because the round has since closed. Replay its original acknowledgement without another attempt/point. Retain history for the match lifetime; cross-process durability is later work.
3. Reject reuse of an ID with a different payload as an idempotency conflict, without counting it. A new ID with the same answer text is a new counted submission.
4. For a new submission, require connected membership, the correct round and server receipt within `[typingStart, deadline)`, with at least one attempt remaining.
5. Count the valid submission, normalize with NFC/trim/case folding appropriate to English, and compare only against the server's canonical spelling or approved variants. Do not strip internal whitespace, punctuation or accents. Incorrect attempts return remaining count without a hint.
6. The first correct ordered submission closes the round and adds exactly one point. Later or concurrent-order losers cannot add a second point. A duplicate command alone never bumps the authoritative version or emits another scoring event.
7. Keep five normal rounds even if a lead appears mathematically decisive. If tied after five, allow at most three extra rounds, ending immediately when scores differ. If still tied after round eight, complete as a draw.
8. Classic remains at its chosen level. Challenge begins at 1 and advances by one after a winning round (maximum 5); scoreless rounds do not advance it. Preserve the just-finished round's played level and represent the next level separately. Category stays fixed in normal rounds and sudden death.

Replay bookkeeping accepts sequences 1 and 2 only during typing, ignores duplicate telemetry and never changes attempts, scores, level or any schedule. Actual two-replay playback enforcement belongs to the mobile/audio increment; no tamper-proof replay claim is made.

## 8. Approved development reconnect policy

A trusted disconnect command starts a per-player deadline at `disconnectAt + 10,000 ms`. Duplicate disconnect notifications do not extend it. Existing round timers continue and the other connected participant may still submit within the valid window. No new audio countdown starts while a participant remains disconnected.

Reconnect strictly before grace expiry clears the pending disconnect and permits a canonical viewer snapshot; it does not reset attempts, replay bookkeeping, level or the round timer. Reconnect at/after expiry interrupts an ongoing match. Either player's unresolved disconnect is sufficient to abort; no winner, draw or forfeit point is awarded. Preserve already-earned scores as history, not as a winning match result.

Terminal outcomes stay terminal: an already legitimately completed match is not retroactively rewritten by a later grace callback. No win may be awarded _because_ someone disconnected. Repeated interruption/expiry commands are idempotent; reconnect cannot resume an aborted match. These are development semantics; future production forfeits require review.

## 9. Tests and proposed acceptance criteria

| Test area              | Required scenarios                                                                                                                                                                                                                                                |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public validation      | Existing M0 setup exports still work; malformed IDs/text, extra authority fields, wrong phases, invalid levels/counters, duplicate participants, inconsistent winner/draw and unordered schedules rejected                                                        |
| Determinism            | Replay the same input trace twice; deep-equal states, acknowledgements and events; prior inputs/state remain unchanged; backwards time rejected                                                                                                                   |
| Preparation            | Exactly two ready members for the same asset; duplicate/stale/wrong-version readiness cannot start or reset; category/level mismatch and reused word rejected without answer leakage                                                                              |
| Timing                 | Before/exactly at/after playback, typing start and deadline; all five provisional durations; delayed/duplicate ticks; no submission during original audio; no deadline extension                                                                                  |
| Attempts               | Three wrong submissions consume 3→2→1→0; fourth rejected; malformed/unauthorized/early/late submissions uncounted; identical text/new ID counts; same ID retry before and after closure returns original result; altered payload/same ID rejected                 |
| Scoring/order          | First valid correct receipt wins once; equal timestamps respect explicit ingress order; wrong then correct; both players correct in either ordering; duplicate result/expiry cannot add points; client timestamp injection rejected                               |
| Text matching          | NFC, outer trim and case accepted; only approved variants; internal punctuation/spaces/accent changes not silently accepted; no partial hints                                                                                                                     |
| Progression/completion | Classic levels 1–5 fixed; Challenge starts 1, advances on win only, caps 5, carries into sudden death; no early finish before five; tie/each sudden-death exit/full eight-round draw; no ninth round or repeated word                                             |
| Replays                | Two distinct valid telemetry sequences, duplicate/out-of-phase/third rejected or ignored consistently; no scoring/attempt/deadline changes                                                                                                                        |
| Reconnect              | Rejoin at 9,999 ms; boundary at 10,000 ms; repeated disconnect; both offline; current timer continues; reconnect cannot revive an aborted match; deadline/grace collision; completed match stays completed                                                        |
| Privacy/snapshots      | Both viewers agree on phase/scores/level/time/version; private counters scoped to viewer; unknown viewer denied; no live answer/variants/word lookup IDs/guesses/internal state in serialized events, snapshots or errors; answer revealed only for closed result |
| Regression             | Existing contract/server/mobile tests, strict types, import boundaries, design-token check, builds, production export/fixture isolation and Expo checks remain green                                                                                              |

Increment acceptance requires all tests above to pass, all planned files to be reviewed, and no modification of M0's UI, security configuration, package manifests or lockfile. There is no arbitrary target test count: tests must cover the stated behaviors. No real socket, database, audio synchronization, native gameplay or crash-durability pass will be claimed at this stage.

Commands after implementation, using the pinned toolchain:

```sh
pnpm build:contracts
pnpm --filter @typeduel/contracts test
pnpm --filter @typeduel/server test
pnpm install --frozen-lockfile
pnpm check
pnpm expo:check
git diff --check
```

The focused suites run while developing; the full suite runs once the increment is complete, and again only after relevant changes/failures. CI must pass at the review PR's exact head. Production exports verify that the new shared exports do not introduce server/test answers into the mobile graph; they are not a native gameplay test.

## 10. Commits and review checkpoint

The current planning commit changes only this document and `IMPLEMENTATION_PLAN.md`.

After explicit increment approval, use three small implementation commits:

1. `feat(contracts): define strict public gameplay schemas` — setup extraction, contracts and validation/privacy tests; run contract tests and consumer type checks.
2. `feat(server): add deterministic authoritative match core` — private types/rules/reducer and timing/attempt/progression/reconnect tests; run server and contract suites.
3. `test(game): verify snapshot privacy and core acceptance` — projection tests, regression verification and accurate documentation results; run the full quality/Expo/build suite and CI.

Each commit is reviewable; do not intentionally commit a failing intermediate state. Stop for the increment review before implementing persistence, transport or mobile integration. If the owner requests a checkpoint between commits, pause there. A final review report must distinguish deterministic core guarantees from capabilities still awaiting adapters.

## 11. Risks and later prerequisites

- The pure engine relies on trusted server identity, input order and clock context. Future adapters must enforce those boundaries and transaction-before-publication; the reducer alone does not make a network service authoritative.
- Simulated duration/clock tests cannot establish cross-device playback skew, real timer wakeup latency, Bluetooth behavior or actual keyboard fairness. These remain later M1 acceptance work.
- No reviewed production word/audio set is present in M0. Later integration needs the small reviewed prerecorded set before real spoken-word acceptance; do not generate paid content or treat synthetic unit fixtures as reviewed assets.
- Database/auth setup may require local tooling and resource approval; no such installation is necessary for increment 01. No services are provisioned by approving this code-only increment.
- Gboard prediction assistance remains open for M1. Evaluate the accessible approach before implementation; the first increment neither changes input UX nor claims to resolve that issue.
- The exact owner-tested iPhone model/runtime/commit and screenshots remain M0 documentation-only gaps. New M1 device testing must record actual build provenance.
