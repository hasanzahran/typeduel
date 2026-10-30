# TypeDuel — Codex Implementation Plan v1.2

**Date:** October 29, 2026

**Status:** M0 formally accepted by the owner; PR #2 merged. M1 architecture and staged scope approved; increment 01 implementation is owner-approved and in progress; acceptance remains pending.

**Sources of truth:** TypeDuel PRD v0.4, System Design v1.2, UI/UX Design v1.0, plus the owner-approved M1 scope and development reconnect policy recorded below.

## Build strategy

Use **Codex + VS Code + GitHub**, with a **pnpm TypeScript monorepo**. Each milestone is a reviewable PR that passes lint/typecheck/tests, updates docs as needed, and can be run locally. Avoid a one-shot prompt to generate the entire application. Continue using the approved stack: Expo/React Native, Node/Fastify/Socket.IO, PostgreSQL/Supabase, Drizzle, offline Amazon Polly audio, and a managed single active game backend.

**Operating rules:** Branch and review changes. Do not commit secrets. Do not connect paid providers, create cloud resources, publish app builds, or deploy production without explicit owner approval. No disguised stub features or manufactured win rates.

## Approved handoff and controls — October 29, 2026

- PR #1 and PR #2 are merged; M0 is formally accepted. PR #2 merge commit is `26f8476ed900d4cfd17a97f229e0226ca7251c91`. Preserve the Android captures and owner-confirmed iPhone results in `M0_VERIFICATION.md`. Missing iOS screenshots and device/runtime/exact-build metadata remain documentation-only gaps, not fabricated passes.
- The owner approved expanded M1 planning: real two-player gameplay, Socket.IO rooms, basic General-only matchmaking, authoritative scoring/timing/attempts, reviewed prerecorded audio, Classic/Challenge progression, snapshots/recovery and competitive-input evaluation. Core prototype work previously assigned to M2/M3/M5 is intentionally brought into M1; later milestones retain production content tooling, tuning, social/account features and release hardening.
- Development reconnect policy is now approved: **10,000 ms grace**, server deadlines continue, and an unresolved disconnect interrupts an ongoing match with **no match winner/forfeit award**. This resolves the previously open development grace-expiry policy; production abandonment policy still requires review.
- Implement through small, independently testable increments, separate commits and review checkpoints. Approval of the overall plan is not approval to implement increment 01: present its exact scope first and wait for the owner. Pause at each increment's review checkpoint before moving on.
- Preserve `minimumReleaseAge: 1440`, strict types, existing dependency/build-script policies and the approved UI/UX. Any gameplay-driven visual change needs explicit review. Do not provision external services, incur costs, generate large Polly batches or install large system dependencies without approval.
- Start real audio integration with a small reviewed prerecorded set. Synthetic word/duration data in engine unit tests are test fixtures only, never an approved playable catalog or production client data.
- Gboard predictions remain an accepted M0 limitation with resolution required for M1 competitive acceptance. Evaluate native alternatives and an accessible custom keyboard before choosing; implementation of a custom keyboard remains unapproved.

## Milestone plan

### M0 — Repository foundation and UI primitives

**Status:** Formally accepted by the owner after merged PR #2, green CI, Android validation and owner-confirmed physical-iPhone testing. Original acceptance requirements and historical evidence are retained below.

**Goal:** Run a real mobile shell and API locally, with the approved visual theme and clean tests.

Deliverables:

- `apps/mobile` Expo/React Native TypeScript + Expo Router.
- `apps/server` Fastify TypeScript with health endpoint.
- `packages/contracts` shared Zod schemas; `packages/config` TS/lint rules.
- pnpm workspace, lockfile, environment example files, CI: lint, typecheck, tests.
- `docs/PRD.md`, `docs/SYSTEM_DESIGN.md`, `docs/UI_UX_DESIGN.md` and approved mockups/tokens.
- Theme tokens, reusable button, text, segmented mode control, chips, timer display, scoreline, text input composer.
- Development-only navigation of the four main screens using **clearly marked mock data**.

Acceptance:

- A physical iPhone with compatible Expo Go (preferred), or iOS Simulator, and an Android environment open the same home shell with the correct theme. Validate all four screens, navigation, keyboard layout, safe areas and basic accessibility; retain native screenshots.
- `pnpm lint`, `pnpm typecheck`, and `pnpm test` pass.
- UI screenshots show no broken layouts at small/large screen widths.
- `.env.example` exists; secrets are not checked in; README startup succeeds.
- Record OS keyboard assistance limitations and keep supported disabling flags in place. The owner accepts the documented Gboard prediction limitation for the M0 UI foundation; complete resolution belongs to M1 gameplay and does not block M0. Native iOS functional validation was confirmed by the owner; screenshots and device/build provenance remain documentation-only follow-ups.

### M1 — Real multiplayer gameplay

**Goal:** Two devices complete a real match with matching authoritative state and durable outcomes, using reviewed prerecorded audio and the approved Classic/Challenge rules.

**First review:** [Increment 01 — contracts and deterministic game core](M1_INCREMENT_01_PLAN.md). The owner approved this bounded increment and all three implementation commits; stop for review before increment 02.

| Increment                             | Bounded deliverable                                                                                                                                              | Review checkpoint                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 01 — Contracts and deterministic core | Shared strict gameplay schemas, pure server engine, timelines, idempotent attempts, scoring, progression, bounded match completion, development reconnect policy | Deterministic unit/contract tests and unchanged M0 app; no sockets, database, real audio or UI integration       |
| 02 — Persistence and actor boundary   | Drizzle/PostgreSQL migrations, atomic outcomes, serialized actor/clock adapter, identity boundary, crash-safe commit-before-publish behavior                     | Real database race/rollback/idempotency tests; confirm local infrastructure separately before provisioning       |
| 03 — Rooms, matchmaking and recovery  | Authenticated Socket.IO namespace, exactly-two-player private rooms, immutable setup, General-only compatible queues, snapshots and reconnect                    | Two independent socket clients converge under loss, duplicate commands, cancellation and 10-second grace expiry  |
| 04 — Reviewed audio integration       | Small approved prerecorded set, private opaque delivery, same-asset preflight, scheduled playback and typing, two extra local replays, telemetry                 | iOS/Android playback/timing measurements and failure handling; no live TTS or large Polly batch                  |
| 05 — Mobile gameplay integration      | Wire approved Home/Setup/Game/Results primitives to canonical state; contextual lobby, result and reconnect states                                               | Owner review of gameplay-required UI changes; real two-device matches with preserved keyboard/safe-area behavior |
| 06 — Fairness and acceptance          | Complete competitive-input evaluation, reviewed solution validation, device/network/accessibility matrix and final M1 evidence                                   | No M1 sign-off until keyboard-assistance requirement is resolved through an approved approach                    |

Keyboard evaluation can be planned alongside the early increments and must be reviewed **before** the input implementation is selected or changed. Increment 06 is the final acceptance checkpoint, not permission to postpone the design decision until after building a custom keyboard.

Full M1 deliverables and acceptance:

- Exactly two participants; one authoritative backend process, shared strict Zod contracts and PostgreSQL/Drizzle durability. Do not add Redis or distributed ownership for this slice.
- Five normal rounds, up to three sudden-death rounds, final draw if still tied; no repeat word within a match. Private category and mode stay locked; Quick Match is General-only.
- Server-received, validated correct answer wins one point. Three counted submissions; the same attempt ID is idempotent, while the same text under a new ID counts again. No client scoring or deadline decisions.
- Initial prerecorded clip precedes typing. Three-second initial countdown; server-owned provisional typing windows 8/8/10/12/15 seconds. Two additional replays during typing never extend time. Actual playback skew must be measured on devices.
- Classic holds difficulty fixed; Challenge starts at Level 1, advances only after a winning round and caps at Level 5, including sudden death. Scoreless rounds do not advance it.
- Both clients and the database agree on completed outcomes under simultaneous submissions, lost acknowledgements, retries and snapshots. Persist outcomes before publication; a crash or unresolved development disconnect cannot invent a win.
- Use the approved 10-second development grace. The current timer continues; expired grace interrupts ongoing play without a match winner. No client timestamp can backdate an answer.
- No pre-result spelling, variants, word lookup identifiers, secret catalog or privileged keys in public contracts, snapshots, URLs, errors, analytics or mobile bundles.
- Evaluate prediction/autocorrect/spellcheck/autofill, clipboard/dictation/text replacement, iOS/Android consistency, hardware input, English/diacritics, compact/large text, VoiceOver/TalkBack, switch access, focus order and touch targets. Document external-assistance limits honestly. An approved effective approach is required before competitive-input acceptance; a custom keyboard needs separate design approval.
- Preserve the approved visual tokens and hierarchy. Record new two-device gameplay evidence and exact tested builds; M0 screenshots are historical evidence, not proof of M1 gameplay.
- Keep all quality, Expo compatibility, dependency-age, frozen-lockfile and CI checks green. Pause for review after each increment; final M1 sign-off is separate from individual increment approval.

### M2 — Curated words + offline audio pipeline

**Scope adjustment:** M1 includes the minimum reviewed-fixture audio integration; M2 owns the production catalog, editorial coverage and full offline generation/review pipeline.

Deliverables: PostgreSQL word catalog and named-category tags; General as virtual all-words; editorial statuses; batch Amazon Polly script; immutable versioned MP3s; admin review/regeneration/disable mechanism; audio preloading and scheduled playback/typing start.

Acceptance: no secret spelling delivered to mobile before round.result; both phones use the same approved recording; audio fails safely; word bank coverage report per category × level; no word reused within a match.

### M3 — Rule tuning and extended validation

**Scope adjustment:** Core Classic/Challenge rules, attempts, replays and sudden death are implemented in M1. M3 expands playtesting, timing calibration and edge/device coverage instead of reimplementing that engine.

Deliverables: playtest and tune the M1 five-level timer configuration, progression feedback, replay behavior, sudden-death/draw handling and result transitions; expand the rule/category/device regression matrix.

Acceptance: all PRD combinations and boundary cases have deterministic unit/integration tests; backend governs all progression; replay does not extend time; no invalid level progression displayed.

### M4 — Social authentication, profile & settings

Deliverables: Supabase Auth integration, Apple/Google/Facebook sign-in on actual supported builds, secure Socket.IO identity validation, user profile/stats/history, sign-out, privacy links, functional account deletion.

Acceptance: providers work on tested Android and iOS builds; unauthorized users cannot access other users' data; account deletion completes relevant backend cleanup.

### M5 — Matchmaking, invites & rematches

**Scope adjustment:** M1 includes the basic General-only queue and private-room lifecycle. M5 adds production invitation/deep-link/rematch polish and full release coverage.

Deliverables: General-only public queues segmented by compatible mode/difficulty; private friend invitation with one of five categories; server-frozen settings and ready states; deep links, cancel/timeout, rematch by both players.

Acceptance: no public category fragmentation; named categories selectable in private rooms; expired/full/unavailable invites have graceful messaging; simultaneous joins produce exactly one match.

### M6 — Fairness, recovery, security, operational readiness

Deliverables: RTT/jitter telemetry, safe resubmission/ACKs, production recovery review, preserving M1’s approved 10-second development grace and interrupted/no-win outcome, audio error flows, bot/guess throttles, graceful drain and documented release procedure; automated load/fault tests.

Acceptance: high/variable-latency and near-tie tests are documented; outages do not fabricate winners; planned production deployment rejects new queues and drains active matches; unexpected crash results in honest interruption.

### M7 — Real-device beta and app-store readiness

Deliverables: real iOS/Android builds via Expo EAS, cross-platform two-phone smoke tests, native keyboard QA (small screens, accessibility font sizes), audio/Bluetooth QA, store asset checklist, category/audio inventory audit, release notes, staging signoff.

Acceptance: zero inconsistent completed-match scores; all three gameplay restrictions exercised; sound and timer correct; app policies/privacy/account deletion met; product owner approves before any production publish.

## Immediate next action — implement and verify increment 01

Review [M1_INCREMENT_01_PLAN.md](M1_INCREMENT_01_PLAN.md): exact files, zero-new-dependency approach, deterministic command/time semantics, contract privacy, acceptance tests and commit checkpoints. The owner has approved the reconciled contract freeze, isolated backend/QA worktrees and all three Increment 01 implementation commits. Run full acceptance at the integrated head and stop before Increment 02. No new dependencies, services, UI changes or automatic main merge are authorized.

## Useful official documentation

- [Expo monorepos](https://docs.expo.dev/guides/monorepos/)
- [Expo keyboard handling](https://docs.expo.dev/guides/keyboard-handling/)
- [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/)
- [Amazon Polly SynthesizeSpeech](https://docs.aws.amazon.com/polly/latest/APIReference/API_SynthesizeSpeech.html)
- [Apple game design](https://developer.apple.com/design/human-interface-guidelines/designing-for-games/)
