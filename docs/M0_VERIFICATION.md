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
| Jest mobile UI/API configuration                   | 8 tests passed; process exits normally                                                                                     |
| Production builds                                  | Contracts + server compiled; iOS/Android Hermes and web bundles exported                                                   |
| Release fixture scan                               | Passed; fixture sentinel/banner absent from production bundles                                                             |
| Expo dependency compatibility                      | Passed                                                                                                                     |
| Expo Doctor                                        | 20/20 checks passed                                                                                                        |
| Documented `pnpm dev`                              | Starts contracts watcher, Fastify, Metro                                                                                   |
| Live local API                                     | `/health/live` returned 200 with shared health contract                                                                    |
| Compiled server smoke                              | Started separately, health passed, SIGTERM exited with code 0                                                              |
| Browser supplemental review                        | All four screens at 390×844; compact 320×568 navigation/Results and 430×932 Setup reviewed; mode/category behavior checked |
| GitHub-hosted Actions execution                    | Passed on Ubuntu for Android acceptance commit `a6c8771`: locked install, quality checks, exports and Expo compatibility   |

## GitHub publication follow-up

Remote verified as `https://github.com/hasanzahran/typeduel.git`. The approved document baseline (`82d3d23`) was pushed to `main`, establishing the PR base without rewriting history. `codex/m0-foundation` adds the implementation (`fcfe1dd`) and verification follow-up.

After browser authorization, both branches were pushed successfully. [Pull request #1](https://github.com/hasanzahran/typeduel/pull/1) is open against `main`. [GitHub Actions run 40255465855](https://github.com/hasanzahran/typeduel/actions/runs/40255465855) completed successfully for `b9ff6ebeae1577bcfecd86e96a308cf0c23cb693`, including every quality and Expo compatibility step. The subsequent report commit `5b2710d` also passed [run 40255638879](https://github.com/hasanzahran/typeduel/actions/runs/40255638879). Android acceptance commit `a6c87718e8fab7fe259bdf56d13e8b039ecaa0a9` passed [run 40261309284](https://github.com/hasanzahran/typeduel/actions/runs/40261309284). This result is recorded by a subsequent documentation-only commit; its own current check is linked from the PR. No force push, rebase, merge, or history replacement was performed.

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

## Final keyboard and iOS acceptance follow-up

### Minimal M0 input changes

The only app change in this follow-up adds `autoComplete="off"`, `importantForAutofill="no"`, and `smartInsertDelete={false}` to the spelling field. Existing `autoCorrect={false}`, `spellCheck={false}`, `autoCapitalize="none"` and `contextMenuHidden` remain. The regression test asserts this assistance policy; it does not simulate or certify an OS keyboard.

The installed RN 0.88 implementation maps `autoComplete="off"` to iOS `textContentType="none"` and Android's autofill exclusion. We deliberately do not also set `textContentType`: [React Native's TextInput reference](https://reactnative.dev/docs/textinput) advises against setting both. `spellCheck` and `smartInsertDelete` are iOS-specific; Android receives the no-suggestions flag through `autoCorrect={false}`. There is no exposed `inlinePredictionType` prop in the installed TextInput API. No dependencies, keyboard type, layout, gameplay, or OS keyboard preferences changed.

### Actual keyboard findings

Retested on the existing API 37 emulator with Gboard `17.2.2.895242737-preload-arm64-v8a`, English (US), at the standard size. Gboard is the only installed full text keyboard; the other listed input service is Google's voice input. No alternate keyboards were installed.

- Actual taps on native letter keys entered `preview`. Gboard still offered `preview` / `previews` despite current `inputType=0x280001` (including no-suggestions), `imeOptions=0x4` (Send), and the explicit autofill settings. See [post-change keyboard capture](verification/android/keyboard-fairness.png). Tapping the `previews` suggestion changed the field to `previews `, confirming it is functional assistance, not decorative UI; see [accepted suggestion](verification/android/keyboard-suggestion-accepted.png). Gboard Send still produced the explicit preview-only/no-score notice, verified after dismissing the keyboard.
- The timer, field, Submit button and attempts counter remain above the keyboard with the predictive strip visible. This corroborates the earlier compact/large-text Android evidence; those earlier captures are retained with their original provenance.
- No automatic replacement occurred in the observed `preview` entry. This limited sample does not certify autocorrection across words, languages or keyboards. The flags are requests to the platform, not enforcement against an IME.
- Gboard still exposes microphone/clipboard tools. `contextMenuHidden` cannot remove an IME's own clipboard, dictation, text replacement or external assistance. Autofill suppression is configured and covered by the component test; a populated password manager/autofill service was not tested.
- iOS keyboard behavior, other Android IMEs, physical hardware keyboards and full screen-reader typing remain untested. Do not claim assistance-free competitive input.

### iOS availability and prerequisites

No iPhone was detected in the USB inventory. Physical iPhone availability over Wi-Fi was requested from the user and is not yet confirmed. `xcode-select -p` points to `/Library/Developer/CommandLineTools`; `xcodebuild -version` requires full Xcode, and `xcrun simctl` / `xcrun devicectl` are unavailable. Consequently, no iOS screenshots or native iOS pass results can be supplied.

**Verified availability, 2026-10-25:** the US [App Store listing](https://apps.apple.com/us/app/expo-go/id982107779) offers Expo Go **58.0.5**, released October 22, with release notes explicitly adding SDK 58 support; it is free and requires iOS **16.4+**. Apple's [lookup metadata](https://itunes.apple.com/lookup?id=982107779&country=us) independently returned the same version, date, OS minimum and SDK support. The listing's generic description still mentions an older React Native version; the version-specific notes and metadata were used for compatibility. [Expo's download page](https://expo.dev/go) also lists SDK 58 as latest. Availability is verified for the US storefront, not every region or a particular phone's installed version.

**Recommendation:** use a physical iPhone with that compatible App Store Expo Go on the same Wi-Fi as this Mac. Install/update Expo Go using the phone's Apple Account, allow Local Network access, start `pnpm dev` with the pinned toolchain, and scan Metro's QR code with the iPhone camera. No paid Apple Developer membership, Expo cloud account/build, Xcode, TypeDuel signing, TestFlight or project change is required for this LAN preview. The existing Metro server responded to an iOS manifest request over this Mac's LAN address with `runtimeVersion=exposdk:58.0.0` and a launch asset. This verifies local serving only, not connectivity or execution on an iPhone. Confirm the installed app/version and actual launch before marking native compatibility passed. Local API localhost URLs are device-relative; Android ADB reverse does not establish iPhone API connectivity.

| Option                                          | Requirements and costs                                                                                                                                                         | Suitability for M0                                                                                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Physical iPhone + App Store Expo Go 58.0.5      | iOS 16.4+, Apple Account for App Store download, free Expo Go, same LAN and Metro; no paid developer enrollment or local native tools                                          | Preferred. SDK 58 availability confirmed; actual device run pending                                                                                                                         |
| Expo Go beta via TestFlight                     | Expo-provided invitation and compatible beta, free TestFlight app; availability/slots must be checked if needed                                                                | Not required: compatible stable App Store Expo Go is available. No beta invitation was needed or verified                                                                                   |
| TypeDuel iOS development build, built locally   | Compatible Mac/Xcode and native build tools, signing and Developer Mode on iPhone; free Apple Account can use Personal Team with 7-day provisioning; Expo account not required | More disruptive here: SDK 58 source builds require a newer Xcode/macOS toolchain; project native-build configuration would need review                                                      |
| TypeDuel development build via EAS              | Expo account/project and EAS configuration; physical-device ad hoc signing needs paid Apple Developer membership and device registration, plus Developer Mode                  | Avoids local Xcode but adds account/signing/configuration work. Free EAS quota may cover a build; no build or account setup initiated                                                       |
| TypeDuel release distributed through TestFlight | Signed build, paid Apple Developer membership, App Store Connect record/upload and TestFlight app; external testing requires beta review                                       | Not appropriate for the current four-screen preview: all four routes use `__DEV__`; a normal release build shows the unavailable shell. Changing fixture isolation requires separate review |
| Xcode Simulator + prebuilt Expo Go              | Full Xcode, compatible iOS Simulator runtime and SDK 58 Expo Go simulator binary; software is free, no paid Apple membership for simulation                                    | Fallback if no iPhone; large downloads/storage required and runtime combination remains untested                                                                                            |

[Expo's development-build guide](https://docs.expo.dev/develop/development-builds/introduction/) distinguishes local builds from EAS; [internal distribution](https://docs.expo.dev/build/internal-distribution/) explains iOS ad hoc device registration. [Apple Personal Team limits](https://developer.apple.com/help/account/basics/about-your-developer-account) include 7-day provisioning. [Apple Developer membership](https://developer.apple.com/programs/enroll/) is USD 99/year (regional prices and eligible waivers vary); [EAS Free pricing](https://expo.dev/pricing) currently includes up to 15 iOS builds with a low-priority queue, subject to the account's remaining quota. Paid EAS service is therefore not inherently required, but no cloud build is authorized by this investigation. [TestFlight](https://developer.apple.com/testflight/) adds distribution setup and external beta review, with no benefit for this already-supported Expo Go preview.

For Simulator preview, full Xcode, an installed iOS Simulator runtime and a compatible prebuilt Expo Go simulator app are needed. [Apple lists Xcode 26.3 as compatible with macOS 15.6](https://developer.apple.com/xcode/system-requirements), so this is a possible preview path on the current macOS 15.6.1, subject to verifying the prebuilt app/runtime combination. It has not been installed or proven. Building SDK 58 from source instead requires [Xcode 26.4+](https://docs.expo.dev/versions/latest/); Xcode 26.4.1 requires macOS 26.2+. Only about 9.9 GiB is free on the internal volume. Do not start a large Xcode/runtime installation or macOS upgrade without approval and a storage plan.

| iOS acceptance item                                                     | Result                                                                                                       |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Home, Setup, Gameplay, Results vs approved PNGs                         | Blocked: no available iOS runtime/device; no screenshots                                                     |
| Navigation and safe areas, including notch/home indicator               | Not run                                                                                                      |
| Keyboard closed/open, timer/composer visibility, compact and large text | Not run; Android success does not prove iOS success                                                          |
| Autocorrect, prediction, spellcheck, autofill, Send and paste behavior  | Not run; only source configuration and portable tests checked                                                |
| VoiceOver labels/focus, Dynamic Type, minimum 44 pt targets             | Not run on iOS                                                                                               |
| Regression from Android keyboard fix                                    | Unverified natively; iOS still uses KAV `padding`, but shared timer/composer changes need actual iOS testing |

On the available iPhone, test each route and return navigation; capture all four screens plus keyboard-open Gameplay at normal and large text; inspect safe areas, scrolling, mock labels, approved charcoal/teal hierarchy and touch targets. With prediction/autocorrect enabled in OS settings, type intentional misspellings and test suggestions, Send, selection/paste and any autofill UI. Traverse controls using VoiceOver, checking labels, selected/disabled states and focus order. Record device/iOS/Expo Go/keyboard versions and compare screenshots with `docs/design/mockups/`. This is a pending checklist, not executed evidence.

### M1 evaluation requirement: accessible controlled keyboard

The owner has assigned complete resolution of keyboard assistance to **M1 gameplay**, accepting the documented Gboard limitation for M0. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) now requires an accessible custom in-game keyboard evaluation, cross-platform consistency, spelling fairness, hardware-keyboard handling and accessibility testing. Evaluate an in-app keyboard with no OS IME connection for the competitive answer buffer against native alternatives. Evaluation is planned; a custom keyboard is **not implemented or approved** and would amend the explicit native-keyboard policy in `UI_UX_DESIGN.md`. M1 has not started.

The proposal should include individually labeled semantic key buttons, Backspace and Submit, a readable answer buffer, stable focus order, VoiceOver/TalkBack and switch-control support, high contrast, scalable labels and layouts, and minimum 44 pt iOS / 48 dp Android touch targets. A full QWERTY row cannot fit 48 dp keys on a compact 360 dp display, so review a compact alternative (for example paged/fewer-column layouts) with accessibility users before choosing a design. Do not shrink targets or disable assistive technology to fit. Define supported languages/diacritics and hardware-keyboard handling explicitly; hiding the soft keyboard alone leaves native text injection paths open. Review fairness and accessible input accommodations together. Test compact screens, large text, screen readers and real devices before adopting it. Even a controlled keyboard cannot prevent another device or other external help.

### Final acceptance decision

The owner-approved acceptance-plan follow-up changes documentation only: Gboard resolution moves to M1; iOS native validation remains the M0 gate. Formatting and diff checks were rerun for the documentation changes. Existing automated/native results below retain their original provenance; no new iOS run or screenshots are claimed.

`pnpm check` passed after the input changes: formatting, ESLint, import boundaries, token drift, strict types, **17 tests** (contracts 5, server 4, mobile 8), contracts/server builds, all three production exports and fixture exclusion. `pnpm expo:check` passed dependency compatibility and Expo Doctor **20/20**. No standalone native binary was built. GitHub Actions [run 40264544293](https://github.com/hasanzahran/typeduel/actions/runs/40264544293) passed every quality and compatibility step for code/evidence commit `9c329561a24306f324dbac6e19999273f9ca0cfc`. This report is published in a subsequent documentation-only commit; its current checks are available on [PR #1](https://github.com/hasanzahran/typeduel/pull/1), which remains open and unmerged. History was preserved.

- **Pass:** M0 foundation, portable checks, Android four-screen preview/navigation, and recorded Android keyboard/safe-area evidence.
- **Block complete cross-platform M0 acceptance:** native iOS validation, design comparison, accessibility smoke and screenshots are missing.
- **Accepted M0 limitation; M1 gameplay requirement:** Gboard predictions persist. The owner explicitly deferred complete resolution to M1, so this is not an M0 UI-foundation blocker. Retain the evidence and supported disabling flags; do not claim assistance-free input. M1 includes input-policy review, accessible custom-keyboard evaluation and fairness verification.
- **Not done / not authorized:** merge, M1 implementation, custom keyboard, new large system installations or paid builds.

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
