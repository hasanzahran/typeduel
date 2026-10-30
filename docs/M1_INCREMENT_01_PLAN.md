# M1 increment 01 — gameplay contracts and deterministic server core

**Status:** Implemented and locally verified; ready for final CI verification and owner review. Increment 02 remains unapproved.

**Date:** October 29, 2026.

**Base:** `origin/main` at `26f8476ed900d4cfd17a97f229e0226ca7251c91` (merged PR #2).

**Branch:** `codex/m1-gameplay-core`.

**Sources:** approved PRD v0.4, System Design v1.2, UI/UX v1.0 and the owner's approved M1 scope/development reconnect policy in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md).

## 1. Outcome and boundaries

Deliver a deterministic server-only game core and strict public gameplay contracts. Tests will drive two logical participants through timed rounds, counted attempts, scoring, Classic/Challenge progression, complete matches and reconnect expiry. This is the first independently reviewable piece of real multiplayer, not a claim that two phones can already connect.

Keep this increment free of new dependencies, network access, database operations and app/UI changes. Socket.IO, identity verification, actor scheduling, transaction persistence, actual prerecorded audio, mobile integration, custom keyboard selection and external provisioning belong to later approved increments. The existing Fastify application remains a health-only app until those adapters are implemented. No changes to approved designs, tokens, screenshots, package manifests, lockfile or dependency security settings are planned.

The engine computes authoritative deadlines and due transitions. A future actor will schedule real callbacks and serialize network receipts; increment 01 tests the timer logic using injected time, without adding an autonomous production timer loop.

## 2. Exact file scope after approval

Paths are relative to the repository root. All listed implementation and test files are now present.

| File                                         | Action                      | Responsibility                                                                                                                                  |
| -------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/contracts/src/setup.ts`            | Add                         | Move existing mode/category/difficulty/setup schemas unchanged into a leaf module, avoiding circular imports when gameplay schemas reuse them   |
| `packages/contracts/src/gameplay.ts`         | Add                         | Strict public commands, acknowledgements, discriminated snapshots, round schedules/results, completion and interruption schemas; inferred types |
| `packages/contracts/src/index.ts`            | Modify                      | Re-export setup and gameplay schemas while preserving existing M0 exports and health/error contracts                                            |
| `packages/contracts/tests/gameplay.test.ts`  | Add                         | Valid/invalid packets, authority boundaries, phase discriminators, ranges, cross-field invariants and answer exposure rules                     |
| `apps/server/src/game/types.ts`              | Add                         | Private state, trusted command context, server-selected round descriptor, transition output and injected clock types                            |
| `apps/server/src/game/rules.ts`              | Add                         | Server rule configuration, normalization and deterministic score/progression/match-completion helpers                                           |
| `apps/server/src/game/engine.ts`             | Add                         | Pure state transitions, readiness/timelines, attempt deduplication, scoring, expiry, reconnect grace and interruption                           |
| `apps/server/src/game/snapshot.ts`           | Add                         | Participant-authorized, explicit allowlist projections of internal state into public schemas                                                    |
| `apps/server/tests/game/fixtures.ts`         | Add                         | Deterministic IDs, clocks and server-only synthetic word/audio metadata for unit tests; no MP3s or approved-content claims                      |
| `apps/server/tests/game/engine.test.ts`      | Add                         | Rule, timing, ordering, normalization, idempotency, progression, terminal-state and reconnect tests                                             |
| `apps/server/tests/game/adversarial.test.ts` | Add                         | QA-owned receipt ordering, full 48-entry retention, retry floods and boundary/terminal tests                                                    |
| `docs/ARCHITECTURE_DECISIONS.md`             | Append                      | Lead records approved M1 contract/authority decisions without rewriting M0 history                                                              |
| `apps/server/tests/game/snapshot.test.ts`    | Add                         | Both-player state agreement, secret redaction, result reveal, snapshot immutability and membership checks                                       |
| `docs/M1_INCREMENT_01_PLAN.md`               | Update after implementation | Record actual files/checks/results and review status; never pre-mark acceptance passes                                                          |
| `docs/IMPLEMENTATION_PLAN.md`                | Update after implementation | Record increment status and next review gate                                                                                                    |

Existing `packages/contracts/tests/contracts.test.ts`, mobile tests and server health tests stay in the suite unchanged as regression coverage. Any additional application file or dependency discovered to be necessary must be explained at the review checkpoint rather than silently expanding the increment.

## 3. Dependencies and compatibility

**No new packages or version changes.** Reuse Node 24.13.0, pnpm 12.15.0, TypeScript 6.0.3, Zod 4.6.7 and Vitest 5.0.5. Existing Expo SDK 58 and React Native 0.88.1 stay untouched.

Keep `minimumReleaseAge: 1440`, existing build-script allowlisting and strict TypeScript settings intact. No new schema/state-machine framework, Socket.IO, Drizzle, database driver, audio library or custom keyboard package is needed to prove this core. Existing workspace test/build discovery should find the new files without script or CI edits.

Use explicit inputs for time, IDs, selected round data and processing order; no random UUID generation, `Date.now()`, uncontrolled timers, filesystem calls or HTTP in the reducer. Node built-ins may support a deterministic, private payload fingerprint for detecting conflicting reuse of an attempt ID; no raw guesses are logged or projected publicly.

## 4. Public contract design

Reuse existing `MatchSetupSchema` and its General-only Quick Match rule. Keep the existing public import path compatible.

Add the minimal gameplay protocol needed by this core:

- `answer.submit`: strict `{matchId, roundId, attemptId, text}`. UUID identities; bounded non-whitespace text (maximum 120 UTF-16 code units, measured before normalization). No client timestamp, score, player identity, level or deadline fields. Malformed commands do not consume attempts.
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
5. Count the valid submission, normalize with NFC → trim → locale-independent lowercase → NFC, and compare only against the server's canonical spelling or approved variants. Do not strip internal whitespace, punctuation or accents. Incorrect attempts return remaining count without a hint.
6. The first correct ordered submission closes the round and adds exactly one point. Later or concurrent-order losers cannot add a second point. A duplicate command alone never bumps the authoritative version or emits another scoring event.
7. Keep five normal rounds even if a lead appears mathematically decisive. If tied after five, allow at most three extra rounds, ending immediately when scores differ. If still tied after round eight, complete as a draw.
8. Classic remains at its chosen level. Challenge begins at 1 and advances by one after a winning round (maximum 5); scoreless rounds do not advance it. Preserve the just-finished round's played level and represent the next level separately. Category stays fixed in normal rounds and sudden death.

Replay bookkeeping accepts sequences 1 and 2 only during typing, ignores duplicate telemetry and never changes attempts, scores, level or any schedule. Actual two-replay playback enforcement belongs to the mobile/audio increment; no tamper-proof replay claim is made.

## 8. Approved development reconnect policy

A trusted disconnect command starts a per-player deadline at `disconnectAt + 10,000 ms`. Duplicate disconnect notifications do not extend it. Existing round timers continue and the other connected participant may still submit within the valid window. No new audio countdown starts while a participant remains disconnected.

Reconnect strictly before grace expiry clears the pending disconnect and permits a canonical viewer snapshot; it does not reset attempts, replay bookkeeping, level or the round timer. Reconnect at/after expiry interrupts an ongoing match. Either player's unresolved disconnect is sufficient to abort; no winner, draw or forfeit point is awarded. Preserve already-earned scores as history, not as a winning match result.

Terminal outcomes stay terminal: an already legitimately completed match is not retroactively rewritten by a later grace callback. No win may be awarded _because_ someone disconnected. Repeated interruption/expiry commands are idempotent; reconnect cannot resume an aborted match. These are development semantics; future production forfeits require review.

## 9. Tests and acceptance criteria

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

Owner approval covers all three small implementation commits without routine intermediate permission requests:

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

## 12. Approved contract freeze and implementation ownership

The owner approved implementation after the coordinated backend/mobile/QA/content review. Lead owns shared schemas, contract tests, canonical documents and integration. Backend exclusively owns the four server implementation files, `fixtures.ts` and `engine.test.ts`. QA exclusively owns `snapshot.test.ts` and `adversarial.test.ts` in an isolated worktree. Mobile/content prepare future requirements without application changes. Integrate contracts → engine → QA tests. No package, lockfile, UI, paid service or Increment 02 work is authorized.

- Only counted `INCORRECT`/`CORRECT` outcomes reserve an attempt ID. Retain all such acknowledgements for the match lifetime. Rejections do not reserve IDs or grow the ledger; later submissions use a fresh trusted receipt time. The proven maximum is 2 players × 3 counted attempts × 8 rounds = 48; no eviction or truncation is permitted. Each viewer can receive at most 24 private outcomes.
- Match/membership validation precedes historical lookup, which precedes current-round/terminal rejection. Compare the original validated text fingerprint before normalization. Counted retries return their original contextual ACK and version; later counters remain authoritative in the current snapshot.
- `applyCommand` drains due transitions through the trusted receipt time. The future actor must not advance time past already-received commands. Equal-time expiry precedes submission, with unresolved grace before round deadline. A rejected/duplicate action may drain timers but cannot itself score, consume attempts, or duplicate outcomes.
- Return ordered atomic transition batches `{stateVersion, events[]}`. A decisive round result and match completion share one batch. Empty batches represent context-bound private/phase changes; the caller already owns match identity. Viewer projection can produce version gaps; clients recover canonical snapshots on unexplained gaps. Do not split terminal batches into independently version-deduplicated events.
- Recovery snapshots include viewer-only counted outcomes and applicable closed/final result. Never project guesses, fingerprints, private catalog IDs or variants. A past closed spelling may appear in a closed-result field; an aborted unclosed answer is never revealed.
- Disconnect clears readiness only during unscheduled preparation. A fresh ready acknowledgement is required after reconnect. Committed schedules remain fixed. Trusted preparation installs the next descriptor atomically from `ROUND_RESULT`; initial empty preparation alone has round number 0.
- Use 120 UTF-16 units for the original bounded text, matching M0 input. Normalize only for matching: NFC → trim → lowercase → NFC; preserve internal whitespace, punctuation and accents. Public audio descriptors carry opaque UUID asset/version, measured duration and final-audio SHA-256; actual delivery provenance is a later adapter responsibility.
- The core interface uses explicit monotonic receipts with strictly increasing ingress sequence and a fixed monotonic/UTC anchor. Invalid inputs fail with static sanitized errors. Prior state, fixtures and returned projections must not alias mutable state.

Contract review added checks for mode-specific progression, per-round history bounds, legal atomic event combinations and possible sudden-death scores. Full acceptance must replay all 48 counted attempts after an eight-round draw, preserving original ACKs without loss.

## 13. Parallel mobile/content preparation (no implementation)

The mobile specialist reviewed the frozen schemas and mapped the existing presentation to canonical phases: preparation/preload → countdown → listening → typing → closed round feedback → complete or interrupted. Pending submission, reconnect and audio failure are local overlays, not client-authoritative game phases. Preserve the existing charcoal/teal hierarchy and keyboard-visible timer/composer.

Later mobile/transport requirements:

- Validate/apply each transition batch atomically, scoped to an authenticated match. Empty batches are not self-contained UI state updates; provide viewer snapshots or equivalent authoritative updates at the corresponding version. Snapshot application must not accidentally suppress an unprocessed result presentation effect.
- Request canonical sync on unexplained version gaps. Correlate ACKs independently of state version filtering; an older ACK cannot restore attempts, overwrite a counted outcome, reopen a round or clear another pending request. Retry only unresolved submissions with their original ID and exact text.
- Restore counters, closed results and counted history from snapshots; reconnect never restarts original playback or grants time. Preserve locally spent replay sequences conservatively. Restart recovery, failed-play accounting and playback overlap require an Increment 04 decision.
- Increment 04 needs a bounded mobile audio adapter/harness for measured playback before Increment 05 full screen wiring. Record iOS↔Android and same-platform device/build/OS/IME evidence, start/end skew, audio-route/interruption failures, poor network/ACK loss, large text, VoiceOver/TalkBack, switch/hardware input and actual keyboard assistance. M0 evidence does not establish M1 behavior.
- Evaluate competitive input early; native assistance limitations and accessible custom keyboard alternatives remain an M1 gate. No keyboard implementation is authorized here.

The content specialist found no approved playable catalog, audio assets or license inventory in repository source. Prepare private records for vocabulary provenance/rights, editorial word/variant/category/level approval, immutable asset/voice/configuration identity, final-byte SHA-256, measured decoded duration and human listening review. Do not treat candidate suggestions or synthetic engine fixtures as approved content.

Content workflow: provenance review → spelling/category/level and ambiguity review → separately authorized offline generation → byte integrity/duration/metadata checks → human listening approval → coverage gate → backend admission. Inspect MP3 tags, object paths, headers and errors for spelling leaks. Asset replacement requires a new version and renewed approval; unchanged audio can survive separately reviewed category edits.

- First restricted General/Classic/Level-1 device match: eight distinct approved word/audio pairs.
- Full M1: eight eligible candidates per reachable enabled category/level, including Challenge through Level 5; no silent category fallback.
- Beta: the existing launch gate is 30 approved playable words per named category/level, or 600 category-level memberships. Shared category membership can reuse a recording; General derives from the complete approved pool.

Future ownership: content receives explicitly assigned editorial/audio tools and private manifests; backend owns persistence, selection, coverage enforcement and authorized delivery; mobile owns decode/playback/native measurements; lead owns public contracts, dependency changes and canonical integration. Missing reviewed assets, licensing/review turnaround, keyboard fairness and device access remain beta schedule risks. No paid generation, storage provisioning or next-increment implementation is part of this preparation.

## 14. Increment 01 verification — October 29, 2026

All three approved implementation stages are complete: strict shared contracts, deterministic server core, and independent adversarial/privacy acceptance. Backend and QA worked on isolated branches/worktrees; the lead integrated contracts, engine, then QA tests. The final candidate code was validated in a clean detached worktree to exclude the owner's untracked agent setup package. No package manifest, lockfile, security policy, UI, HTTP route or CI workflow changed.

| Check                                | Actual result                                                                                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pinned runtime                       | Node 24.13.0; pnpm 12.15.0                                                                                                                        |
| `pnpm install --frozen-lockfile`     | Passed; lockfile and dependency policy unchanged. Initial isolated installs reused 918 cached packages with zero downloads.                       |
| `pnpm check` — formatting/lint/types | Passed, including import boundaries and design-token consistency.                                                                                 |
| Contract tests                       | 15 passed: 5 existing M0 plus 10 gameplay validation tests.                                                                                       |
| Server tests                         | 61 passed: 4 existing API, 34 backend core, 23 independent QA tests.                                                                              |
| Mobile regression tests              | 8 passed; no mobile application changes.                                                                                                          |
| Total automated tests                | 84 passed across 8 test files/suites.                                                                                                             |
| Builds/exports                       | Contracts and server TypeScript builds passed; web/iOS/Android production exports passed.                                                         |
| Production isolation                 | Existing release fixture check passed; supplementary scan of all 10 exported JS/Hermes bundles found none of the checked M0/M1 fixture sentinels. |
| `pnpm expo:check`                    | Dependencies up to date; Expo Doctor 20/20 passed.                                                                                                |
| Whitespace/scope                     | `git diff --check` passed; manifests, lockfile, workspace policies and mobile files unchanged.                                                    |
| GitHub CI                            | Required at the final pushed review head; remote run and PR evidence are reported in the review handoff after push, rather than pre-marked here.  |
| Native gameplay                      | Not exercised: this increment has no socket, audio or mobile gameplay integration. Exports do not establish native execution or accessibility.    |

The independent QA run demonstrates the complete history bound: eight scoreless rounds × two players × three submissions retain 48 counted outcomes; each viewer sees only their 24. Every original retry after terminal completion returns its exact original acknowledgement without eviction, new scoring, counter changes or duplicate events. Changed payloads conflict. Mixed-match histories remain isolated. Other accepted traces cover equal-time receipt order, input/deadline boundaries, chronological delayed wakes, 9,999/10,000 ms reconnect, staggered disconnects, completion/grace collisions, immutable terminal states and detached projections. Canonical spelling appears only after that round closes; aborting an unclosed round does not reveal it.

Review caught and resolved contract validation gaps for Challenge/score consistency, impossible sudden-death scores, invalid per-round histories, contradictory event batches and points assigned to an unclosed round. Backend checks also cover safe integer schedule/grace arithmetic. No engine blocker was found by independent QA. Final review added the missing cross-round stale-readiness trace: old readiness cannot change the new preparation; fresh acknowledgements schedule once and duplicates preserve that schedule.

Remaining boundaries are deliberate: the future authenticated actor must preserve ingress order, persist state/attempt history/results atomically before publication, route candidate events only to authorized match participants, and never serialize private `TransitionResult.state`. Database crash/restart behavior, real socket/network recovery, content selection/delivery, audio synchronization and competitive keyboard fairness remain later reviewed increments. Mobile/content preparation is recorded above; no reviewed playable audio set currently exists.

Owner review is the next gate. Do not automatically merge into main or begin Increment 02. The accepted M0 Gboard limitation remains an M1 acceptance requirement; no custom keyboard or visual changes were implemented.
