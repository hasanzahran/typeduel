# M1 Increment 02 — Durable authoritative match actor

Status: implemented and verified; ready for owner review. Baseline: accepted PR #3,
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
ownership, clock, restart helper and persistence baseline tests. During execution,
actor implementation and its unit tests moved exclusively to Lead so Backend and
QA could continue concurrently; Backend and Mobile cross-reviewed the actor. QA exclusively owns
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
The initial frozen installation passed. Final integrated checks still require completion below. Drizzle Kit brings deprecated esbuild-kit development tooling; no additional build scripts were authorized. The existing mobile Metro peer warning (0.88.0 installed versus a 0.88.1 peer request) also exists in the merged baseline and is not changed by this increment.

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

## Verification results — October 29, 2026 (local time)

Implementation head: `8ee584adfd10a1fd0f8ef6e83a5ae80eeb10c733`.
[GitHub CI run 41000754332](https://github.com/hasanzahran/typeduel/actions/runs/41000754332)
passed both `quality` and `postgres-integration` at that exact head. This report is
committed afterward; the lead verifies both checks again at the final PR head
before handing it to the owner. No automatic merge or Increment 03 implementation.

| Check                           | Actual result and environment                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency installation         | Approved four exact pins installed; entire resolved graph accepted under unchanged `minimumReleaseAge: 1440`, strict engines and build-script allowlist. No mobile dependency changes.                        |
| Frozen installation             | Passed in the main workspace, a clean validation worktree, and both CI jobs. The clean install reused the local package store; no database installation.                                                      |
| `pnpm check`                    | Passed in the clean validation worktree at `8ee584a`, including formatting, lint/boundaries/tokens, TypeScript, tests, builds and production fixture-isolation scan.                                          |
| Unit/component tests            | **104 passed**: 16 contracts, 80 server, 8 mobile.                                                                                                                                                            |
| `pnpm test:integration`         | **44 passed** in CI: 5 Backend baseline tests and 39 independent QA cases across five files. Real PostgreSQL connections and Node child processes, not an in-memory database substitute.                      |
| Database identity/durability    | CI asserted `server_version_num=180006`, `fsync=on`, `full_page_writes=on`, `synchronous_commit=on` before testing. Image manifest digest independently verified and pinned above.                            |
| Server/contracts builds         | Passed; strict TypeScript compilation.                                                                                                                                                                        |
| Production exports              | Web, iOS and Android exports passed; development fixture markers excluded. These are bundle checks, not native gameplay evidence.                                                                             |
| `pnpm expo:check`               | Dependencies up to date; Expo Doctor **20/20** locally and in CI.                                                                                                                                             |
| Missing-database negative check | `pnpm test:integration` without `TEST_DATABASE_URL` failed explicitly as intended; no skipped-test pass.                                                                                                      |
| Scope/history check             | Mobile application, design, M0 evidence, architecture source documents and dependency security configuration unchanged; setup ZIP/extracted package/local agent definitions excluded. Main history preserved. |

The real-database suite proves rollback after individual writes, actual SQL
constraint rejection, initial-create rollback, concurrent answers and independent
matches, original receipt order behind delayed storage, exact deadline/grace
behavior, fresh evaluation of rejected IDs, lost COMMIT response reconciliation,
48 original counted ACKs after terminal recovery, closed-result atomicity, viewer
privacy, and failure of an asynchronous publication subscriber without rescoring.

Crash tests kill a Node actor process before COMMIT, after COMMIT and before
publication. A separate cross-process test leaves the old Node process alive,
terminates only its ownership session, observes takeover waiting for its old
transaction, then proves the old process cannot commit or serve authoritative
state. Unfinished matches interrupt without a match winner; confirmed final
results stay completed. Owner loss during acquisition and repeated recovery are
also exercised.

Cross-review and the first full database run found issues that were fixed and
retested: SQL NULL acceptance in terminal CHECK constraints; lost-session
activation during ownership acquisition; pre-lock operation ambiguity; foreign
round-ID collision handling; operation reconciliation against a different owner;
and unhandled errors on checked-out PostgreSQL clients. The initial full CI run
also caught two QA trace errors: forbidding the permitted closed-result spelling
reveal, and preparing another round before the scoreless round deadline. Tests
now distinguish raw submitted text from canonical reveal and explicitly advance
the deadline without changing gameplay rules or weakening the 48-ACK assertion.

## Delivered responsibilities and commits

| Commit    | Responsibility and change                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `3c036a3` | Lead: frozen boundaries, restart contract/test, approved dependencies, integration configuration and pinned database CI.                                           |
| `e1caeee` | Lead: approved architecture/roadmap and database version/durability verification.                                                                                  |
| `f805445` | Mobile: future Socket.IO/committed-state consumer design only.                                                                                                     |
| `83497bb` | Content: eight-word editorial worksheet and audio validation requirements only.                                                                                    |
| `1a44e0f` | Lead: development commands, dependency notes and formatted preparation handoffs.                                                                                   |
| `759658c` | Backend: private schema/migration, checkpoints, transactional store, owner fencing, clock and pure restart helper; baseline tests.                                 |
| `8c5b743` | Lead, cross-reviewed by Backend/Mobile: serialized actor, committed publication, uncertainty pause/reconciliation, read-only terminal ACK recovery and unit tests. |
| `3471bb4` | QA: independent real-PostgreSQL race, failure, privacy and crash tests.                                                                                            |
| `16d14d6` | Lead/Backend review: sanitized synchronous actor admission failures and regression test.                                                                           |
| `ae68aa7` | Backend: reconcile only operations belonging to the current owner, with regression test.                                                                           |
| `ab3fb16` | Backend/QA review: handle asynchronous loss of checked-out transaction connections.                                                                                |
| `8ee584a` | QA: live-process fencing and corrected deadline/privacy test traces.                                                                                               |

Documentation-only verification commits follow this implementation list. Source
agent work stayed in isolated worktrees and was cherry-picked without rewriting
existing history. No application code was written by the Mobile/Content roles.

## Remaining limits and next parallel work

- No material Increment 02 blocker remains after the passing checks above. Owner
  review is still required; the lead must check the final PR head, not rely only on
  this earlier implementation-head run.
- PostgreSQL tests ran in the explicitly authorized ephemeral CI service. No local
  PostgreSQL installation or external database/service was provisioned. A later
  device-play environment needs separately approved infrastructure/tooling.
- `createMatchActor` is an internal runtime boundary, not wired into the HTTP
  server. Increment 03 must maintain one live actor per match, supply verified
  identities/session generations, and call `reconcile()` when paused storage can
  be checked again. A bounded retry budget pauses the FIFO rather than guessing a
  result. Permanent conflicts/fencing fail closed.
- This increment does not promise live gameplay restoration across process loss,
  historical event replay, multi-active deployments or transaction-pooled session
  locks. Snapshot/ACK recovery remains the agreed model.
- The suite covers actual session termination and controlled COMMIT-response loss.
  It does not claim real network-partition, managed-database failover or production
  load testing. A real SQL lock-timeout followed by actor reconciliation is not a
  distinct end-to-end case; in-flight DB ambiguity and paused actor FIFO are
  separately tested.
- Existing Metro peer-version warning and Drizzle Kit's deprecated esbuild-kit
  development dependencies remain documented. Frozen installation and Expo
  validation pass; policies and unrelated dependency versions were not changed.
- Native gameplay, synchronized audio and keyboard fairness remain later M1
  acceptance gates. Preserve accepted M0 Gboard limitation; custom keyboard
  selection/implementation still needs review. Eight candidate words are pending
  editorial/rights/listening approval, with no generated audio or invented device
  evidence.

After acceptance and explicit Increment 03 approval, Backend can implement the
Socket.IO identity/session/room adapter around the frozen actor while Mobile
implements the headless committed-state consumer and QA independently exercises
transport loss/duplicates/reconnects. Lead owns the shared transport schema and
integration. Content editorial review can proceed independently; generation still
requires its separate authorization. Increment 04 then joins reviewed audio and
minimal approved Game/Results bindings for the first real physical two-phone
match, with common late-start handling agreed before claiming timing fairness.

## Exact changed files

- `.github/workflows/ci.yml`
- `README.md`
- `apps/server/.env.example`
- `apps/server/drizzle.config.ts`
- `apps/server/drizzle/0000_game_core.sql`
- `apps/server/drizzle/meta/0000_snapshot.json`
- `apps/server/drizzle/meta/_journal.json`
- `apps/server/package.json`
- `apps/server/src/db/checkpoint.ts`
- `apps/server/src/db/client.ts`
- `apps/server/src/db/match-store.ts`
- `apps/server/src/db/migrate.ts`
- `apps/server/src/db/owner.ts`
- `apps/server/src/db/schema.ts`
- `apps/server/src/db/types.ts`
- `apps/server/src/game/actor.ts`
- `apps/server/src/game/clock.ts`
- `apps/server/src/game/engine.ts`
- `apps/server/tests/db/checkpoint.test.ts`
- `apps/server/tests/game/actor.test.ts`
- `apps/server/tests/integration/backend/store.test.ts`
- `apps/server/tests/integration/qa/atomicity.test.ts`
- `apps/server/tests/integration/qa/privacy.test.ts`
- `apps/server/tests/integration/qa/receipt-order.test.ts`
- `apps/server/tests/integration/qa/recovery.test.ts`
- `apps/server/tests/integration/qa/support/actor-child.ts`
- `apps/server/tests/integration/qa/support/harness.ts`
- `apps/server/vitest.config.ts`
- `apps/server/vitest.integration.config.ts`
- `docs/ARCHITECTURE_DECISIONS.md`
- `docs/IMPLEMENTATION_PLAN.md`
- `docs/M1_CONTENT_PREPARATION.md`
- `docs/M1_INCREMENT_02_PLAN.md`
- `docs/M1_MOBILE_INTEGRATION.md`
- `package.json`
- `packages/contracts/src/gameplay.ts`
- `packages/contracts/tests/gameplay.test.ts`
- `pnpm-lock.yaml`
