# M0 verification

Date: 2026-10-25 (America/Los_Angeles). Scope: M0 only. Implementation, publication, portable checks, and Android Expo Go preview validation complete; iOS acceptance remains pending. M1 has not started.

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

After browser authorization, both branches were pushed successfully. [Pull request #1](https://github.com/hasanzahran/typeduel/pull/1) is open against `main`. [GitHub Actions run 40255465855](https://github.com/hasanzahran/typeduel/actions/runs/40255465855) completed successfully for `b9ff6ebeae1577bcfecd86e96a308cf0c23cb693`, including every quality and Expo compatibility step. The subsequent report commit `5b2710d` also passed [run 40255638879](https://github.com/hasanzahran/typeduel/actions/runs/40255638879). Android acceptance fixes and screenshots are a follow-up on the same PR; the current check is linked from the PR. No force push, rebase, merge, or history replacement was performed.

The local full `pnpm check` and `pnpm expo:check` were also rerun successfully during this acceptance follow-up under Node 24.13.0 / pnpm 12.15.0. A formatting failure in the edited verification table was fixed with Prettier before the successful rerun. The later Android run required the UI fixes documented below; no architecture or gameplay rules changed.

## Android installation and native preview

The user approved installing the Android SDK, emulator and JDK. Installed under the user's home directory on macOS 15.6.1 (Apple Silicon), without changing shell profiles, system Java, Xcode selection, or system-wide configuration:

| Component                    | Installed version / location                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| Eclipse Temurin JDK          | 17.0.21+9, `~/Library/Java/JavaVirtualMachines/jdk-17.0.21+9/Contents/Home`               |
| Android command-line tools   | 23.0, with Android CLI 1.1.16717390                                                       |
| SDK root                     | `~/Library/Android/sdk`                                                                   |
| Platform tools / build tools | 37.0.1 / 37.0.0                                                                           |
| SDK platform / system image  | API 37.0 revision 2; Google APIs ARM64 revision 8                                         |
| Emulator                     | 37.2.12, Apple Hypervisor.Framework acceleration verified                                 |
| AVD                          | `TypeDuel_M0_API37`, Pixel 6 profile, 2 GiB RAM, 3 GiB data partition, snapshots disabled |
| Native host app              | Official Expo Go 58.0.5, compatible with SDK 58 / RN 0.88                                 |
| Shell environment            | `~/Library/Android/typeduel-env.sh` (opt-in via `source`)                                 |

JDK SHA-256 and command-line tools repository checksum were verified before extraction. Downloads came from Adoptium, Google's SDK repository, and Expo's official release. SDK + emulator image occupy about 7.1 GiB; the AVD about 1.5 GiB; the JDK about 310 MiB. Free disk space after installation was about 9.8 GiB. No Android Studio, NDK, paid service, or cloud build was installed or provisioned.

This is an actual native Android run in Expo Go, not a browser screenshot or a standalone TypeDuel APK build. Tested at 1080×2400 pixels / 420 dpi (about 411×914 dp) and 720×1280 / 320 dpi (360×640 dp), with Gboard English (US), font scale 1.0 and 1.3. Temporary display/font overrides were reset after testing.

### Results and fixes

| Check                   | Actual result                                                                                                                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launch and theme        | Home opens in Expo Go; approved dark/teal hierarchy and mock-data labels visible                                                                                                                                                                                                       |
| Navigation              | Home → Quick/Friend Setup → Preview game → Preview results → Back Home exercised; Android Back and scrolling exercised                                                                                                                                                                 |
| Setup                   | Quick Match fixes General; Friend shows all five categories and Animals selection carries to Gameplay; Classic shows five levels and Expert is selectable; Challenge hides difficulty                                                                                                  |
| Gameplay metadata       | Challenge example remains Round 2 of 5 / Level 2; timer is explicitly static/mock                                                                                                                                                                                                      |
| Keyboard and safe areas | Initial Android keyboard obscured the composer. Added Android `KeyboardAvoidingView` height behavior; timer now moves to a compact fixed row above the composer while keyboard is open. Input, Submit and timer remain visible at standard and compact sizes, including 1.3 font scale |
| Submission              | Enter key and Gboard Send trigger the preview-only notice; Submit works; input never awards points or changes the fixture score                                                                                                                                                        |
| Presentation states     | Typing, listening, pending, incorrect, exhausted, reconnecting and audio-error states inspected; tapping pending input did not open the keyboard                                                                                                                                       |
| Results                 | Win, loss, draw and interrupted inspected; interrupted explicitly awards no win and removes Rematch                                                                                                                                                                                    |
| Local backend           | Home's Check local API reports Local API connected via ADB reverse to port 3000                                                                                                                                                                                                        |
| Accessibility structure | Native control labels and radio roles inspected. Added explicit Home secondary-action labels to avoid icon glyphs in their accessible names. Primary controls meet the 48 dp target in inspected layouts                                                                               |
| Runtime diagnostics     | No ReactNativeJS warnings/errors or AndroidRuntime fatal errors in the inspected logcat sample                                                                                                                                                                                         |
| Portable regression     | Full `pnpm check` and `pnpm expo:check` passed after the UI fixes: 16 tests, all builds/exports, fixture isolation, Expo Doctor 20/20                                                                                                                                                  |

The keyboard-open layout prioritizes the timer and composer. Metadata, score, replay, status and preview controls remain scrollable above them on short screens. This is a responsive correction to the approved keyboard policy, not a gameplay change.

Gboard can still display suggestion/clipboard UI despite the native no-suggestions input flag (observed `inputType=0x280001`) and disabled autocorrect/spellcheck. The app does not claim reliable IME anti-cheat. A transient Gboard “Keyboard font size updated” banner consumed additional height during testing; the final large-text screenshot was captured once that notice was absent. Physical keyboards, alternative IMEs/languages, full TalkBack traversal, larger font scales and real devices remain untested.

### Android screenshots

All PNGs below are unedited emulator captures. The floating gear is Expo Go's developer control, not a TypeDuel feature. Some screens scroll to reveal development-only controls.

| Screen / state    | Evidence                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home              | [Home](verification/android/home.png)                                                                                                                         |
| Quick Setup       | [Classic / General](verification/android/setup-quick.png), [Challenge](verification/android/setup-challenge.png)                                              |
| Friend Setup      | [Challenge / Animals](verification/android/setup-friend.png)                                                                                                  |
| Gameplay          | [Keyboard closed](verification/android/gameplay.png), [keyboard open](verification/android/gameplay-keyboard.png)                                             |
| Compact gameplay  | [360×640, keyboard open](verification/android/gameplay-compact-keyboard.png), [font scale 1.3](verification/android/gameplay-compact-large-text.png)          |
| Other game states | [Listening](verification/android/gameplay-listening.png), [audio error](verification/android/gameplay-audio-error.png)                                        |
| Results           | [Win](verification/android/results.png), [compact win](verification/android/results-compact.png), [interrupted](verification/android/results-interrupted.png) |

### Reproduce on this Mac

With the repository's pinned Node 24.13.0 and pnpm 12.15.0 active:

```sh
source ~/Library/Android/typeduel-env.sh
emulator -avd TypeDuel_M0_API37 -no-snapshot -no-boot-anim
# In another terminal, from the repository:
pnpm dev
# Once the emulator has booted, in another terminal with the Android environment:
adb -s emulator-5554 reverse tcp:8081 tcp:8081
adb -s emulator-5554 reverse tcp:3000 tcp:3000
adb -s emulator-5554 shell am start -a android.intent.action.VIEW -d exp://127.0.0.1:8081 host.exp.exponent
```

The `emulator-5554` serial assumes this is the first running emulator; use `adb devices` to confirm. Expo Go is already installed in this AVD. No account or production service is required.

## Remaining acceptance gaps

- Xcode is not installed; the active developer directory is Command Line Tools. `xcodebuild -version` requires full Xcode and `xcrun simctl list devices available` cannot find `simctl`. iOS launch, native compilation, VoiceOver, keyboard/safe-area checks and screenshots could not run.
- Expo 58 requires Xcode 26.4 or newer for native compilation ([Expo SDK reference](https://docs.expo.dev/versions/latest/)). Apple's Xcode 26.4.1 requires macOS 26.2 or newer ([Xcode system requirements](https://developer.apple.com/xcode/system-requirements)). A compatible macOS/Xcode installation or another build host is needed for that path. A prebuilt Expo Go preview on a physical device or compatible simulator is a separate, untested option. The Android installation approval did not authorize a macOS upgrade.
- No standalone Android APK or iOS binary was compiled. Production Hermes/web export remains a bundling check, not a native binary build.
- No physical-device, full VoiceOver/TalkBack, physical hardware-keyboard, alternate IME, or reduced-motion system-toggle testing is claimed. The UI uses no added animation; the native keyboard's theme follows OS/IME preferences.
- M0 preview actions remain disconnected from gameplay. No auth, sockets, database, word/audio pipeline, cloud resources or paid services were added. Original planning documents and PNG references are preserved. Upstream dependency deprecations remain; direct dependencies passed Expo compatibility checks.

M0 is ready for review of the Android evidence and portable checks, but complete cross-platform acceptance requires the outstanding iOS run. Do not start M1 until M0 is reviewed and approved.

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
- `docs/verification/android/*.png` (native acceptance captures linked above)
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
