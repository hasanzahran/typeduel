# TypeDuel

Expo/React Native mobile shell, Fastify API, shared Zod contracts and a durable authoritative gameplay core. M0 and M1 Increments 01–02 are accepted. Increment 03 adds authenticated Socket.IO admission, private rooms, General-only matchmaking, committed-state recovery and a headless mobile consumer. The mobile screens remain development previews; playable native audio and screen bindings require Increment 04 approval.

## Prerequisites

- Node **24.13.0** (`.node-version`) and pnpm **12.15.0** (`packageManager`). Install the pinned pnpm with `npm install --global pnpm@12.15.0`, or prefix commands with `npx --yes pnpm@12.15.0`.
- Ensure your shell selects the pinned runtime (`node --version`; with nvm, `nvm use 24.13.0`). This machine also has an older system Node; strict engines reject it.
- For native previews: full Xcode 26.4+ and an iOS 16.4+ simulator, or Android Studio with an Android emulator. Expo SDK 58 targets React Native 0.88 / React 19.3. Use Expo's supported JDK/SDK versions for native builds. An Expo Go installation compatible with SDK 58 is required for `expo start` launches.
- No provider accounts, credentials, database, or EAS subscription are needed for M0.

## Start locally

```sh
pnpm install --frozen-lockfile
cp apps/server/.env.example apps/server/.env
cp apps/mobile/.env.example apps/mobile/.env
pnpm dev
```

`dev` builds and watches contracts, starts the API on port 3000, and starts Metro. In another terminal use the Metro launch shortcuts, or start the mobile app separately using `pnpm ios` / `pnpm android`. The latter commands start their own Metro session; do not run them on top of an existing Metro session on the same port.

For individual services use `pnpm dev:server` and `pnpm dev:mobile`. `pnpm web` is a supplementary browser preview; it cannot validate native keyboards. `curl http://127.0.0.1:3000/health/live` should return `{"status":"ok","service":"typeduel-api"}`.

### Device API addresses

Set `EXPO_PUBLIC_API_URL` in the mobile `.env`: iOS simulator uses `http://127.0.0.1:3000`, Android emulator uses `http://10.0.2.2:3000`, physical devices use the computer's LAN address. Set server `HOST=0.0.0.0` only when intentionally exposing the local API to your trusted LAN. Restart Metro after changing environment values. The Home development control can check API connectivity. Browser cross-origin access is not enabled; use the curl check for browser-only review.

Only public URLs belong in `EXPO_PUBLIC_*`. Never add provider keys, database credentials, word answers, or answer mappings.

## Screen review

Home → Quick Match / Play with Friend → Setup. Product CTAs explain that services are not connected. **Preview game** opens the static gameplay fixture; **Preview state** changes presentation examples; **Preview results** opens sample outcomes. Submit never checks a spelling or awards points. Replay does not play audio or modify the timer. Result statistics are omitted because none are measured.

Every screen identifies itself as **Development preview · Mock data**. Preview data is isolated behind a compile-time `__DEV__` branch. Release builds show a truthful unavailable shell. `pnpm build` scans production bundles for fixture markers. No match engine or secret word fixture exists in M0.

## Quality commands

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm expo:check
```

`pnpm check` runs formatting, lint, types, tests, and builds. `build` compiles contracts/server and exports iOS, Android, and web production bundles; it **does not compile signed native binaries**. Tests use Vitest for contracts/API and Jest with Expo's preset for native components. Server production startup is `pnpm --filter @typeduel/server start` after building.

`GET /health/live` reports process liveness, not database readiness. With multiplayer configuration, the server also mounts `/health/ready` (database/ownership readiness), authenticated `/v1/rooms` routes and the `/game` Socket.IO namespace. SIGINT/SIGTERM close sockets, runtime jobs, Fastify and database ownership with a bounded shutdown.

## Database and authenticated transport development

Use an explicitly configured private PostgreSQL database. The CI integration job runs PostgreSQL 18.6 in an ephemeral container with normal durability enabled. No local database installation or managed service is included. Keep credentials in the server environment, never mobile configuration.

```sh
# DATABASE_URL must already identify an authorized development database.
pnpm build:contracts
pnpm --filter @typeduel/server db:migrate

# TEST_DATABASE_URL must identify a disposable test database.
pnpm test:integration
```

The migration command loads the server `.env` and applies reviewed committed SQL. It does not run automatically with the API. `db:generate` prepares a migration for review; do not use schema push. The schema uses an explicitly validated private search path; generated foreign-key schema qualifiers must be reviewed for that namespace strategy before committing a new migration. Never run integration tests against production: they create and remove isolated test schemas and terminate test-owned sessions/processes.

Ownership requires a dedicated PostgreSQL session, so a transaction-pooling connection is unsuitable. Gameplay writes atomically commit before publication. A new fenced owner preserves completed results and interrupts unfinished matches rather than resuming an old process clock. See [the Increment 02 plan and verification](docs/M1_INCREMENT_02_PLAN.md) for exact boundaries and test results.

Configure both `DATABASE_URL` and `SUPABASE_URL` in the server environment to enable multiplayer. Use an existing approved Supabase project with asymmetric ES256/RS256 signing; the verifier derives its trusted issuer and JWKS endpoint from the HTTPS project origin. No provider is provisioned and no production test-token override exists. Configure `GAME_SCHEMA` consistently with migrations; default is `typeduel_game`. `GAME_ALLOWED_ORIGINS` accepts a comma-separated browser-origin allowlist; native clients need no Origin header. Supplying only one of the two required variables fails startup. Supplying neither keeps the M0 liveness server available.

Socket handshakes send the access token in `auth.accessToken`. HTTP room requests use a Bearer token and the current socket's `x-typeduel-session-id`. The shared event contracts and mobile token-provider injection boundary are in the [Increment 03 plan](docs/M1_INCREMENT_03_PLAN.md) and [mobile handoff](docs/M1_MOBILE_INTEGRATION.md). Never put tokens in URLs or logs.

The production round source deliberately reports unavailable until approved recordings and source integration exist. Real socket/database tests inject synthetic server-only descriptors and a local signed-token/JWKS provider; this proves transport behavior, not live Supabase or physical audio acceptance. Do not enable a fake production catalog to bypass that boundary. See the [physical-device protocol](docs/M1_INCREMENT_03_DEVICE_PROTOCOL.md) for the remaining two-phone prerequisites.

Unit tests remain database-independent. Integration tests fail if `TEST_DATABASE_URL` is missing or the database is unavailable; they are not silently skipped. `pnpm check` and `pnpm test:integration` are separate required acceptance commands.

## Design and architecture

`docs/design/tokens.json` remains canonical. Run `pnpm tokens:generate` after an approved token change; `pnpm tokens:check` detects drift. UI uses system fonts, semantic colors, native inputs, flexible wrapping, safe areas, and a keyboard-avoiding composer. No custom keyboard or animated competitive timer is implemented.

Read `AGENTS.md` and all planning documents before changing behavior. M0 decisions are in `docs/ARCHITECTURE_DECISIONS.md`; verification status is in `docs/M0_VERIFICATION.md`. Original documents/mockups are preserved.

## CI and release

GitHub Actions runs frozen installation, quality checks, bundle exports, Expo dependency validation and a separate PostgreSQL integration job for PRs and pushes to main or `codex/**` branches. Both jobs must pass at the submitted head. No deployment, managed service creation or store upload is configured. Native screenshots require separately available devices/simulators; bundle export is not native gameplay acceptance. Each M1 increment requires owner review before the next implementation begins.
