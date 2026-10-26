# TypeDuel · M0

Expo/React Native mobile shell, local Fastify API, public Zod contracts, and development-only screen previews. This milestone does not implement a playable match, authentication, persistence, audio playback, matchmaking, or paid infrastructure.

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

The only HTTP route is `GET /health/live`. Database-backed readiness and `/v1` APIs are intentionally absent until their milestones. SIGINT/SIGTERM close Fastify with a bounded shutdown.

## Design and architecture

`docs/design/tokens.json` remains canonical. Run `pnpm tokens:generate` after an approved token change; `pnpm tokens:check` detects drift. UI uses system fonts, semantic colors, native inputs, flexible wrapping, safe areas, and a keyboard-avoiding composer. No custom keyboard or animated competitive timer is implemented.

Read `AGENTS.md` and all planning documents before changing behavior. M0 decisions are in `docs/ARCHITECTURE_DECISIONS.md`; verification status is in `docs/M0_VERIFICATION.md`. Original documents/mockups are preserved.

## CI and release

GitHub Actions runs frozen installation, quality checks, bundle exports, and Expo dependency validation for PRs and pushes to main. No deployment, cloud resource creation, or store upload is configured. Native screenshots require separately available simulators/emulators; bundle export is not native acceptance. Review and approve M0 before beginning M1.
