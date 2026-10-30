# M1 Increment 02 — Durable authoritative match actor

Status: implementation authorized by the owner. Baseline: accepted PR #3,
merged at `99910e5`. This increment does not authorize Increment 03, UI changes,
audio generation, external provisioning, large local installations or a main merge.

## Frozen boundaries

- The pure engine remains authoritative. Capture server monotonic receipt and
  sequence synchronously before asynchronous work; serialize each match's player,
  trusted-control and timer inputs in that receipt order.
- The private store exposes `createMatch({ owner, operationId, state })`,
  `commitTransition({ owner, matchId, expectedRevision, operationId, candidate })`,
  `readCommitted(matchId)`,
  `resolveOperation({ owner, matchId, operationId, expectedRevision })` and
  `interruptOrphans(owner)`. Concrete typed adapters and test hooks are coordinated
  between Backend and QA; semantics are frozen here.
- The actor accepts a trusted principal separately from the public payload.
  `acceptPlayerCommand`, `acceptTrustedCommand`, `wake`, `getSnapshot` and `close`
  are internal boundaries, not public endpoints. No client clocks or identity.
- One transaction commits the counted attempt, fingerprint, original ACK, round
  outcome, scores, difficulty, checkpoint, state version, store revision and
  operation ID. No success ACK, state adoption or publication before commit proof.
- Public `stateVersion` and private `storeRevision` are distinct. Ordering-only
  operations may advance the latter. Retain atomic ordered event batches and the
  final viewer snapshot together when publishing; never expose private state.
- All 48 counted ACKs remain durable, including after completion/interruption.
  Counted retries return the original ACK. Rejected IDs stay unreserved and a new
  delivery receives a fresh receipt. Internal transaction retries retain the
  original operation ID and receipt; those are not new player deliveries.
- A blocked/uncertain COMMIT blocks same-match successors. Reconcile on primary
  storage only after proving the old guarded transaction ended. Missing response,
  timeout or absent row alone is not rollback evidence. Confirmed commit adopts
  persisted state; confirmed rollback retries; unresolved state stays unavailable.
- One dedicated PostgreSQL session advisory lock plus an owner epoch fences
  processes. Each writer locks owner row FOR SHARE before match row FOR UPDATE.
  Takeover obtains the advisory lock and advances epoch under FOR UPDATE, waiting
  for existing writers. Never infer death from a new process's empty registry.
- Ownership loss stops old admission/publication. Already-enqueued committed
  updates may arrive late; consumers must compare versions. Publication failure
  does not undo a commit. Canonical snapshots and retained ACKs recover state;
  no outbox or exactly-once historical event-delivery promise is included.
- Recovery-only `interruptForServerRestart` never advances the old process clock
  or deadlines. Preserve terminal outcomes; interrupt unfinished matches once with
  `SERVER_RESTART`, preserving earned scores/history but awarding no match winner.
  Unfinished gameplay is not resumed across processes.
- Ten-second reconnect grace and existing deadline precedence remain unchanged.
  Raw guesses, private fingerprints, variants and checkpoints stay out of public
  events/errors/logs. Raw guesses are not persisted.

## Ownership and integration

Lead owns public contracts, manifests/lockfile, test configuration, CI and shared
documentation. Backend exclusively owns database schema/migrations, store,
ownership, actor/clock, restart helper and baseline tests. QA exclusively owns
`apps/server/tests/integration/qa/`, including child-process fixtures. Mobile owns
`docs/M1_MOBILE_INTEGRATION.md`; Content owns `docs/M1_CONTENT_PREPARATION.md`.
Neither preparation role changes application code.

Branches/worktrees: lead `codex/m1-02-actor`; Backend `codex/m1-02-backend` in
`TypeDuel-worktrees/m1-02-backend`; QA `codex/m1-02-qa` in
`TypeDuel-worktrees/m1-02-qa`; preparation `codex/m1-02-mobile-prep` in
`TypeDuel-worktrees/m1-02-mobile-prep`. Mobile and Content rotate through one worker
slot while Backend and QA run concurrently. Setup ZIP/extracted files and local
agent definitions are excluded from implementation commits.

Integrate shared boundaries/configuration, transactional persistence, actor and
recovery, then independent adversarial tests. Review at each integration point;
routine coding and fixes require no additional owner approval. Pause before 03.

## Dependencies and database

Owner-approved exact pins: `drizzle-orm@0.45.4`, `pg@8.23.1`,
`drizzle-kit@0.31.11`, `@types/pg@8.23.1`. pnpm accepted the full install with
`minimumReleaseAge: 1440`, engine strictness and build-script allowlist unchanged.
Frozen installation and final checks still require completion below.

Use reviewed generated migrations, never schema push or automatic startup
migration. Private tables: owner control, categories, matches, match participants,
match rounds, answer attempts. Catalog/provider integration is deferred.

Approved ephemeral CI image:
`postgres:18.6@sha256:979bccfde35445db618c65107d27d08c6c21339d8dc3ad4c830c6633947be0e4`.
The registry manifest response digest was independently SHA-256 verified before
pinning. Tests must confirm the running version. No local PostgreSQL/Docker is
available; no installation or external database was provisioned. Real database
evidence must come from the authorized CI service unless local tooling becomes
available with approval. Dedicated ownership connections cannot use transaction
pooling. Keep normal database durability settings.

## Required verification

- Fresh migration, constraints and rollback after every physical write.
- Real SQL failure, same-match races and independent-match concurrency.
- Timely delayed command, exact deadline and fresh rejected-ID retries.
- Confirmed/rolled-back/unresolved COMMIT, delayed old transaction and no phantom
  success ACK/publication. Repeated deliveries never add points or attempts.
- Kill before commit, after nonfinal commit and after final commit; healthy process
  overlap, fenced takeover, old writers and interrupted recovery.
- All 48 ACKs recovered, terminal outcomes immutable, ten-second grace boundaries.
- Public projections/errors/logs sanitized, no precommit point, atomic final batch.
- Frozen install; formatting, lint, strict types, all unit/mobile/integration tests;
  production builds/exports, fixture isolation, Expo compatibility and Doctor.
- CI passes at the exact final PR head. Missing TEST_DATABASE_URL fails the
  integration command rather than skipping. Existing unit tests remain DB-free.

## Next approved-planning boundaries

03: authenticated Socket.IO rooms/General matchmaking, session fencing,
snapshot/ACK recovery and mobile headless committed-state consumer in parallel
with independent transport QA. Dependencies and implementation need owner review.

04: reviewed eight-word audio set, delivery/preflight, scheduling/replays and
minimal real Game/Results bindings preserving approved visuals. Target the first
physical iPhone-versus-Android General/Classic/Level-1 match here; complete broader
Home/Setup/lobby integration afterward. Both phones and database must agree.
Resolve common missed-start behavior before audio acceptance: slow commits must
not silently extend one player's clock. Actual device access and an approved
development database/server environment remain prerequisites.

Custom-keyboard evaluation remains an M1 requirement; implementation and audio
generation are not authorized. The eight proposed words are editorial candidates,
not approved recordings or production coverage. See the separate preparation docs.

## Verification results

Implementation and final verification are in progress. No real-PostgreSQL, native
gameplay or final-head CI pass is claimed by this planning baseline.
