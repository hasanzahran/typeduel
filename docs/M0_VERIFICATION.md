# M0 verification

Date: 2026-10-25 (America/Los_Angeles). Scope: M0 only. Implementation, publication, and portable checks complete; native acceptance remains pending. M1 has not started.

## Executed checks

| Check                                              | Result                                                                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Write access to requested workspace                | Confirmed with a temporary create/remove probe                                                                             |
| GitHub repository                                  | Verified `hasanzahran/typeduel`; baseline and M0 branches pushed without rewriting existing history                        |
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
| GitHub-hosted Actions execution                    | Passed on Ubuntu for `b9ff6eb`: locked install, full quality checks, production exports, and Expo compatibility            |

## GitHub publication follow-up

Remote verified as `https://github.com/hasanzahran/typeduel.git`. The approved document baseline (`82d3d23`) was pushed to `main`, establishing the PR base without rewriting history. `codex/m0-foundation` adds the implementation (`fcfe1dd`) and verification follow-up.

After browser authorization, both branches were pushed successfully. [Pull request #1](https://github.com/hasanzahran/typeduel/pull/1) is open against `main`. [GitHub Actions run 40255465855](https://github.com/hasanzahran/typeduel/actions/runs/40255465855) completed successfully for `b9ff6ebeae1577bcfecd86e96a308cf0c23cb693`, including every quality and Expo compatibility step. The report update is a subsequent documentation-only commit and triggers another PR check; its status is available on the PR. No force push, rebase, merge, or history replacement was performed.

The local full `pnpm check` and `pnpm expo:check` were also rerun successfully during this acceptance follow-up under Node 24.13.0 / pnpm 12.15.0. A formatting failure in the edited verification table was fixed with Prettier before the successful rerun. No application or architecture changes were needed.

## Native checks not available

- Acceptance follow-up on 2026-10-25: macOS 15.6.1; approximately 23 GiB free on the data volume. Workspace remains writable. No large dependencies were installed and no system-wide configuration was changed.
- Xcode is not installed; the active developer directory is Command Line Tools. iOS simulator launch, native iOS compilation, VoiceOver, keyboard/safe-area validation, and native screenshots could not run.
- Android Studio/SDK/emulator and Java runtime are absent; `adb` is unavailable. Android launch/build, TalkBack, native keyboard/IME behavior, and native screenshots could not run.
- `xcodebuild -version` reports that full Xcode is required; `xcrun simctl list devices available` cannot find `simctl`; `/usr/libexec/java_home -V` reports no Java runtime. No usable Android SDK, emulator, or bundled JDK was found in the standard installation locations.
- Expo 58 requires Xcode 26.4 or newer for native compilation ([Expo SDK reference](https://docs.expo.dev/versions/latest/)). Apple's Xcode 26.4.1 requires macOS 26.2 or newer ([Xcode system requirements](https://developer.apple.com/xcode/system-requirements)). This Mac therefore needs a compatible macOS/Xcode installation or another build host for the supported native compilation path. Prebuilt Expo Go on a physical device or a compatible simulator is a separate potential preview path, not a completed check.
- Large Android SDK, emulator image, and JDK installation requires the user's approval. No approval has been received for those downloads. No native launch or screenshot is claimed while tooling is absent.
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
