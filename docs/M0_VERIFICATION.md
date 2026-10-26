# M0 verification

Date: 2026-10-25. Scope: M0 only. Implementation and portable checks complete; native acceptance remains pending.

## Executed checks

| Check                                              | Result                                                                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Write access to requested workspace                | Confirmed with a temporary create/remove probe                                                                             |
| GitHub repository                                  | `git ls-remote` succeeded with no refs; local repository was also unborn; no existing history overwritten                  |
| Frozen lockfile installation                       | Passed under Node 24.13.0 / pnpm 12.15.0                                                                                   |
| Formatting, ESLint, import boundaries, token drift | Passed                                                                                                                     |
| Strict TypeScript                                  | Passed for contracts, server, mobile                                                                                       |
| Vitest contracts                                   | 5 tests passed                                                                                                             |
| Vitest Fastify integration/configuration           | 4 tests passed                                                                                                             |
| Jest mobile UI/API configuration                   | 7 tests passed; process exits normally                                                                                     |
| Production builds                                  | Contracts + server compiled; iOS/Android Hermes and web bundles exported                                                   |
| Release fixture scan                               | Passed; fixture sentinel/banner absent from production bundles                                                             |
| Expo dependency compatibility                      | Passed                                                                                                                     |
| Expo Doctor                                        | 20/20 checks passed                                                                                                        |
| Documented `pnpm dev`                              | Starts contracts watcher, Fastify, Metro                                                                                   |
| Live local API                                     | `/health/live` returned 200 with shared health contract                                                                    |
| Compiled server smoke                              | Started separately, health passed, SIGTERM exited with code 0                                                              |
| Browser supplemental review                        | All four screens at 390×844; compact 320×568 navigation/Results and 430×932 Setup reviewed; mode/category behavior checked |
| GitHub-hosted Actions execution                    | Not run: commits remain local; workflow is included                                                                        |

## Native checks not available

- Xcode is not installed; the active developer directory is Command Line Tools. iOS simulator launch, native iOS compilation, VoiceOver, keyboard/safe-area validation, and native screenshots could not run.
- Android Studio/SDK/emulator and Java runtime are absent; `adb` is unavailable. Android launch/build, TalkBack, native keyboard/IME behavior, and native screenshots could not run.
- No physical-device testing, enlarged native font testing, or hardware keyboard testing was possible.
- Production bundle export is not a native binary build. Browser visual review is supplementary, not native acceptance evidence. No native screenshot files are claimed or fabricated.

## Remaining limitations

M0 preview actions are intentionally disconnected from gameplay. No auth, sockets, database, word/audio pipeline, cloud resources, or paid services were added. Results are explicit fixtures, never inferred from input. Original planning documents and PNG references are preserved. The dependency tree contains upstream deprecation notices for glob/inflight/whatwg-encoding; direct dependencies passed Expo compatibility checks. The next task is to provision native tooling and complete the checklist below, then review M0 before any M1 work.

## Native screenshot checklist (pending tooling)

- iOS and Android, compact and large phones: Home, Quick Setup, Friend Setup, Gameplay, Results.
- Classic levels 1–5; Challenge difficulty hidden; fixed General for public play.
- Gameplay keyboard closed/open, default/enlarged text, predictive bar; input and Submit remain visible. Verify timer readability with available vertical space.
- Listening, typing, pending, incorrect, exhausted, reconnecting, and audio-error presentation fixtures.
- Win, loss, draw, interrupted; interrupted never awards a phantom win.
- Safe areas, scrolling, VoiceOver/TalkBack labels, 44pt/48dp targets, hardware return key, system reduced motion.

Native screenshots cannot be replaced by browser screenshots. A native-tooling failure must remain explicitly recorded rather than passing this checklist.

## Files added by M0

Original source documents, tokens, and four PNG references are in the separate baseline commit. Implementation adds the following files:

- `.github/workflows/ci.yml`
- `.gitignore`
- `.node-version`
- `.prettierignore`
- `.prettierrc.json`
- `README.md`
- `apps/mobile/.env.example`
- `apps/mobile/app.config.ts`
- `apps/mobile/app/_layout.tsx`
- `apps/mobile/app/game.tsx`
- `apps/mobile/app/index.tsx`
- `apps/mobile/app/results.tsx`
- `apps/mobile/app/setup.tsx`
- `apps/mobile/jest.config.cjs`
- `apps/mobile/jest.setup.ts`
- `apps/mobile/package.json`
- `apps/mobile/src/api/client.test.ts`
- `apps/mobile/src/api/client.ts`
- `apps/mobile/src/components/ui/index.tsx`
- `apps/mobile/src/dev/fixtures.ts`
- `apps/mobile/src/dev/preview.test.tsx`
- `apps/mobile/src/dev/preview.tsx`
- `apps/mobile/src/theme/index.ts`
- `apps/mobile/src/theme/tokens.generated.ts`
- `apps/mobile/tsconfig.json`
- `apps/server/.env.example`
- `apps/server/package.json`
- `apps/server/src/app.ts`
- `apps/server/src/config/env.ts`
- `apps/server/src/http/health.ts`
- `apps/server/src/server.ts`
- `apps/server/tests/app.test.ts`
- `apps/server/tsconfig.build.json`
- `apps/server/tsconfig.json`
- `docs/ARCHITECTURE_DECISIONS.md`
- `docs/M0_VERIFICATION.md`
- `eslint.config.mjs`
- `package.json`
- `packages/config/eslint.mjs`
- `packages/config/package.json`
- `packages/config/tsconfig.base.json`
- `packages/config/tsconfig.node.json`
- `packages/contracts/package.json`
- `packages/contracts/src/index.ts`
- `packages/contracts/tests/contracts.test.ts`
- `packages/contracts/tsconfig.build.json`
- `packages/contracts/tsconfig.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `scripts/boundaries.mjs`
- `scripts/check-release.mjs`
- `scripts/tokens.mjs`
