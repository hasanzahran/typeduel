# TypeDuel — Codex Implementation Plan v1.1

**Date:** October 25, 2026  
**Status:** M0 implemented; native iOS acceptance pending. M1 has not started

**Sources of truth:** TypeDuel PRD v0.4, System Design v1.2, UI/UX Design v1.0.

## Build strategy

Use **Codex + VS Code + GitHub**, with a **pnpm TypeScript monorepo**. Each milestone is a reviewable PR that passes lint/typecheck/tests, updates docs as needed, and can be run locally. Avoid a one-shot prompt to generate the entire application. Continue using the approved stack: Expo/React Native, Node/Fastify/Socket.IO, PostgreSQL/Supabase, Drizzle, offline Amazon Polly audio, and a managed single active game backend.

**Operating rules:** Branch and review changes. Do not commit secrets. Do not connect paid providers, create cloud resources, publish app builds, or deploy production without explicit owner approval. No disguised stub features or manufactured win rates.

## Milestone plan

### M0 — Repository foundation and UI primitives

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
- Record OS keyboard assistance limitations and keep supported disabling flags in place. The owner accepts the documented Gboard prediction limitation for the M0 UI foundation; complete resolution belongs to M1 gameplay and does not block M0. Native iOS validation remains an M0 acceptance gate.

### M1 — Private real-time match vertical slice

**Goal:** Two devices connect to one room and complete a match with authoritative scoring.

Deliverables:
- Socket.IO join/ready/countdown/game-state events and match actor.
- Database migrations for match, round and answer events; atomic persistence.
- A small **development-only approved test word/audio fixture**; never ship hardcoded secret answer in the client.
- Submissions validated server-side, three counted attempts with idempotent attempt IDs.
- Basic game UI wired to real server results, basic reconnect/snapshot.
- Resolve keyboard assistance as an M1 gameplay requirement: autocorrection, prediction, spellcheck, autofill, clipboard/dictation and text-replacement paths must be evaluated for all supported competitive input methods. Preserve the documented M0 Gboard evidence as a regression case.
- Evaluate an accessible custom in-game keyboard against native-input alternatives, including consistent iOS/Android behavior, spelling fairness, language/diacritic support, compact/large-text layouts, physical hardware keyboards and input injection paths, VoiceOver/TalkBack, switch access, focus order and minimum touch targets. Record the recommendation, test matrix and tradeoffs before implementation. This planning addition authorizes evaluation in M1 only; it does not start M1 or approve a custom keyboard. Changing the current native-keyboard UI policy requires design review.

Acceptance:
- Two real devices/emulators see identical results over repeated five-round matches.
- A replayed attempt ID does not consume a second attempt.
- Early/late/correct/incorrect submissions are rejected/accepted deterministically.
- Server-simulated network delay and disconnect do not create contradictory scores.
- The approved competitive input approach resolves the observed Gboard prediction issue and passes equivalent iOS/Android spelling-fairness checks on supported keyboards, including hardware input. Document remaining external-assistance limits without claiming tamper-proof anti-cheat.
- Accessibility tests cover screen readers, switch access, large text, contrast, focus order, reachable controls and compact-screen target sizes. No custom keyboard is implemented before its design and accessibility approach are reviewed; M1 acceptance requires evidence for the chosen approach.

### M2 — Curated words + offline audio pipeline

Deliverables: PostgreSQL word catalog and named-category tags; General as virtual all-words; editorial statuses; batch Amazon Polly script; immutable versioned MP3s; admin review/regeneration/disable mechanism; audio preloading and scheduled playback/typing start.

Acceptance: no secret spelling delivered to mobile before round.result; both phones use the same approved recording; audio fails safely; word bank coverage report per category × level; no word reused within a match.

### M3 — Complete Classic/Challenge rules

Deliverables: five levels, configurable provisional timer windows, fixed Classic difficulty, automatic shared Challenge level, two additional replays, three sudden-death maximum/draw, in-screen results and level-up.

Acceptance: all PRD combinations and boundary cases have deterministic unit/integration tests; backend governs all progression; replay does not extend time; no invalid level progression displayed.

### M4 — Social authentication, profile & settings

Deliverables: Supabase Auth integration, Apple/Google/Facebook sign-in on actual supported builds, secure Socket.IO identity validation, user profile/stats/history, sign-out, privacy links, functional account deletion.

Acceptance: providers work on tested Android and iOS builds; unauthorized users cannot access other users' data; account deletion completes relevant backend cleanup.

### M5 — Matchmaking, invites & rematches

Deliverables: General-only public queues segmented by compatible mode/difficulty; private friend invitation with one of five categories; server-frozen settings and ready states; deep links, cancel/timeout, rematch by both players.

Acceptance: no public category fragmentation; named categories selectable in private rooms; expired/full/unavailable invites have graceful messaging; simultaneous joins produce exactly one match.

### M6 — Fairness, recovery, security, operational readiness

Deliverables: RTT/jitter telemetry, safe resubmission/ACKs, reconnection snapshots with 10s proposed grace, audio error flows, bot/guess throttles, graceful drain and documented release procedure; automated load/fault tests.

Acceptance: high/variable-latency and near-tie tests are documented; outages do not fabricate winners; planned production deployment rejects new queues and drains active matches; unexpected crash results in honest interruption.

### M7 — Real-device beta and app-store readiness

Deliverables: real iOS/Android builds via Expo EAS, cross-platform two-phone smoke tests, native keyboard QA (small screens, accessibility font sizes), audio/Bluetooth QA, store asset checklist, category/audio inventory audit, release notes, staging signoff.

Acceptance: zero inconsistent completed-match scores; all three gameplay restrictions exercised; sound and timer correct; app policies/privacy/account deletion met; product owner approves before any production publish.

## Immediate next action — M0 Plan Mode prompt

> Read `docs/PRD.md`, `docs/SYSTEM_DESIGN.md`, `docs/UI_UX_DESIGN.md`, `docs/design/tokens.json`, and `AGENTS.md`. Plan **Milestone M0 only**. Propose a pnpm monorepo structure with Expo/React Native, Fastify, shared Zod contracts, CI, theme tokens, and reusable mobile components. Include exact commands, package/version compatibility checks, test strategy, UI screenshot checklist, risks, and a definition of done. **Do not modify files until the plan is reviewed**. Do not deploy or create paid cloud infrastructure.

On review, issue a follow-up authorization for Codex to implement M0 in its feature branch. Inspect and test before moving to M1. Source of truth: the agreed PRD, architecture and design, not illustrative screenshot numbers.

## Useful official documentation

- [Expo monorepos](https://docs.expo.dev/guides/monorepos/)
- [Expo keyboard handling](https://docs.expo.dev/guides/keyboard-handling/)
- [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/)
- [Amazon Polly SynthesizeSpeech](https://docs.aws.amazon.com/polly/latest/APIReference/API_SynthesizeSpeech.html)
- [Apple game design](https://developer.apple.com/design/human-interface-guidelines/designing-for-games/)
