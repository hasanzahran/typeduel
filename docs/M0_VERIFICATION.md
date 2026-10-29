# M0 verification

Updated: 2026-10-29 (America/Los_Angeles). Scope: M0 only. The owner has now confirmed physical-iPhone launch, approved visual direction and keyboard-open timer/composer visibility in Expo Go. Remaining iOS checks are unverified. The eligible SDK 58 patch updates now pass Expo compatibility and all 20 Doctor checks; the updated PR head still requires CI confirmation. M1 has not started. The owner intentionally merged PR #1; the merge is complete, but M0 acceptance remains pending. Android evidence below was captured on 2026-10-25.

## Eligible SDK 58 compatibility update — 2026-10-29

The scheduled retry ran after 09:00 PDT. Expo recommended the previous seven patches plus React Native `0.88.1`; the React Native Jest preset was aligned to that patch. Official npm registry publication timestamps were rechecked before updating. All nine direct updates are stable releases older than 24 hours; SDK 58, React 19.3 and the application architecture are unchanged.

| Package                     | Previous pin | Updated pin | Published (UTC)          |
| --------------------------- | ------------ | ----------- | ------------------------ |
| `expo`                      | 58.0.19      | 58.0.21     | 2026-10-28T15:36:05.811Z |
| `expo-router`               | 58.0.26      | 58.0.28     | 2026-10-28T15:36:42.455Z |
| `expo-linking`              | 58.0.14      | 58.0.15     | 2026-10-28T15:34:41.340Z |
| `expo-constants`            | 58.0.13      | 58.0.14     | 2026-10-28T15:35:30.588Z |
| `expo-font`                 | 58.0.10      | 58.0.11     | 2026-10-28T15:33:20.136Z |
| `@expo/ui`                  | 58.0.23      | 58.0.25     | 2026-10-28T15:33:03.917Z |
| `jest-expo`                 | 58.0.12      | 58.0.13     | 2026-10-28T15:31:28.680Z |
| `react-native`              | 0.88.0       | 0.88.1      | 2026-10-27T14:43:35.156Z |
| `@react-native/jest-preset` | 0.88.0       | 0.88.1      | 2026-10-27T12:12:19.703Z |

`pnpm --filter @typeduel/mobile update` applied these exact versions under the unchanged `minimumReleaseAge: 1440` policy. Resolution succeeded without exclusions, clock changes, forced installs or compatibility-check suppression. A separate registry audit of **all 53 newly introduced package versions** in the lockfile found none younger than 24 hours. The newest was `@expo/cli@58.1.17`, published **2026-10-28T15:39:30.715Z** (over 1,463 minutes old at the audit); `expo-file-system@58.0.13` was published at **15:39:27.892Z**. Publication metadata came from each package's `https://registry.npmjs.org/<package>` time map. Existing supply-chain and build-script policies are unchanged. pnpm reported four deprecated transitives (`glob@10.5.0`, `glob@7.2.3`, `inflight@1.0.6`, `whatwg-encoding@3.1.1`); these are upstream warnings, not failures of the compatibility or release-age checks.

**Local results on the updated graph:** frozen-lockfile installation passed; formatting, lint/import boundaries/token drift, strict types, all **17 tests** (5 contracts, 4 server, 8 mobile), contracts/server builds, web/iOS/Android production exports and production fixture isolation passed. `expo install --check` reports dependencies up to date. Expo Doctor passes **20/20**. Node 24.13.0 and pnpm 12.15.0 were used. The changed implementation files are only `apps/mobile/package.json` and `pnpm-lock.yaml`; this report records the results. CI for the pushed dependency commit will be verified before recommending the PR.

No native session or new screenshot was captured with these patches. `adb devices` found no attached/running Android environment during this pass. Earlier Android captures and the owner's iPhone approvals retain their original dates and tested dependency graph; they are not relabeled as post-update native evidence. Remaining manual iPhone checks below are still pending. M0 acceptance and M1 planning remain gated on that evidence; no M1 implementation or custom keyboard was added.

## Post-merge acceptance follow-up — 2026-10-28 (historical)

The owner intentionally merged [PR #1](https://github.com/hasanzahran/typeduel/pull/1) at 17:25:18 UTC. Local `main` was fast-forwarded to `origin/main` at merge commit `9a503d7`. The complete `codex/m0-foundation` history through `6793711` is an ancestor of main, and its file tree matches main exactly. No source-branch commits are missing from main at this audit; all implementation files, approved designs, verification documents and 15 Android screenshots are preserved. No revert, rebase or history rewrite was performed.

Remaining work is isolated on `codex/m0-acceptance-followup`, created from that main commit. A one-time continuation was scheduled for **October 29 at 09:00 America/Los_Angeles**, after the known direct/transitive package eligibility times. It must recheck current recommendations and publication times, preserve `minimumReleaseAge: 1440`, and let pnpm enforce eligibility for the full graph. Eligibility is not assumed in advance. Successful updates require a frozen-lockfile install, full quality/build/export suite, Expo compatibility, Expo Doctor and green GitHub CI on the follow-up PR's exact head. The manual iPhone checklist below remains pending; merging PR #1 did not satisfy those checks.

The last pre-merge [CI run for `6793711`](https://github.com/hasanzahran/typeduel/actions/runs/40735302320) is marked **cancelled** overall: locked installation and quality/build checks passed, and its Expo compatibility step failed. This is not green CI. No dependency, lockfile or security-policy changes were made during the post-merge sync; only this report was updated.

Post-merge [draft PR #2](https://github.com/hasanzahran/typeduel/pull/2) is open on `codex/m0-acceptance-followup`. Its [CI run for `f6a1f3b`](https://github.com/hasanzahran/typeduel/actions/runs/40736024863) passed frozen installation and the complete quality/build/export step, then failed Expo compatibility. The scheduled October 29 retry is documented above; PR #2 must not be merged automatically. After M0 is ready, prepare a detailed M1 plan from the approved PRD and System Design, covering Socket.IO rooms, matchmaking, server-authoritative scoring, spoken-word audio, timers, three attempts, two extra audio replays, difficulty progression and accessible custom-keyboard evaluation. M1 planning is requested in Plan Mode; implementation requires separate owner approval. No M1 work is included in this follow-up.

## Physical iPhone confirmation — 2026-10-28

**Owner approval reaffirmed on October 28:** the owner is happy with the mobile visual design and the iPhone testing results they reviewed, and explicitly approves the visual design and confirmed keyboard-open layout. This approval covers the previously reported visibility of the timer, spelling field and Submit button. It does not certify navigation, all-screen safe areas, keyboard Send/Submit interaction, larger accessibility text, VoiceOver or screenshot evidence; those checks remain pending unless individually confirmed. Existing Android evidence and the accepted M0 Gboard prediction limitation are unchanged.

**Evidence source: user report, not an agent-observed device session or screenshots.** The user confirmed that:

- TypeDuel opens successfully on a physical iPhone using Expo Go.
- The visual design matches the approved direction.
- The timer, spelling input and Submit button remain visible with the iOS keyboard open.

These results close the previous unknowns about physical-iPhone launch and the reported keyboard-overlap scenario. They do not establish navigation coverage, every screen's layout, VoiceOver behavior or compact/large-text support. iPhone model, iOS version, Expo Go version, keyboard/language, text-size setting and exact tested Git commit were not supplied; they were requested and remain unknown. Do not infer the installed Expo Go version from the earlier App Store research.

Computer Use inventory showed iPhone Mirroring running on this Mac. Selecting it was blocked by missing macOS Accessibility and Screen Recording permissions, including on retry. No iPhone UI could be inspected or captured remotely. No iOS screenshot files were created, and no browser or Android image is presented as iOS evidence. Manual capture steps are below.

## Executed checks — refreshed 2026-10-29

**Approval follow-up rerun (October 28, after 21:51 UTC):** frozen-lockfile installation, formatting, lint/boundaries/tokens, strict types, all 17 tests, contracts/server builds, web/iOS/Android production exports and fixture isolation passed again. Expo compatibility still reports the same seven recommended patches; Expo Doctor remains 19/20 with only the SDK-version check failing. No dependencies, lockfile or security settings changed. The required patches have not yet reached their documented October 29 eligibility times.

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
| Expo dependency compatibility                      | Passed on 2026-10-29 after eligible SDK 58 / RN patch updates                                                              |
| Expo Doctor                                        | 20/20 on 2026-10-29; no issues detected                                                                                    |
| Documented `pnpm dev`                              | Starts contracts watcher, Fastify, Metro                                                                                   |
| Live local API                                     | `/health/live` returned 200 with shared health contract                                                                    |
| Compiled server smoke                              | Started separately, health passed, SIGTERM exited with code 0                                                              |
| Browser supplemental review                        | All four screens at 390×844; compact 320×568 navigation/Results and 430×932 Setup reviewed; mode/category behavior checked |
| GitHub-hosted Actions execution                    | October 28 runs failed at Expo compatibility; October 29 updated-head CI verification pending                              |

### Previous dependency compatibility blocker — October 28 (resolved locally October 29)

**Resumed verification, 2026-10-28 17:22:08 UTC (10:22:08 PDT):** Expo still recommends the same seven versions in the registry table below. Fresh registry reads confirmed all seven direct packages and the previously identified `@expo/cli@58.1.17` transitive dependency remain younger than 24 hours. No install was forced, no packages were changed, and the dependency/security configuration and lockfile remain unchanged. The existing frozen-lockfile install and full `pnpm check` passed again (17 tests and all builds/production exports). `expo install --check` still failed on the seven mismatches; the separately rerun Expo Doctor again passed 19/20, failing only package-version compatibility. Previous successful iPhone/Android evidence is preserved; the six remaining manual iPhone checks are still unverified.

`pnpm check` passed on 2026-10-28 under Node 24.13.0 / pnpm 12.15.0: formatting, lint/import boundaries, token drift, strict types, **17 tests** (5 contracts, 4 server, 8 mobile), contracts/server compilation, iOS/Android Hermes and web exports, and release fixture isolation. `pnpm expo:check` failed at `expo install --check`; running Expo Doctor separately produced **19/20**, with only its SDK dependency-version check failing.

**Registry age audit:** 2026-10-28 16:56:51 UTC (09:56:51 PDT), against the unchanged 1,440-minute policy. None of the seven recommended patches is eligible yet; each was approximately 80–85 minutes old. Publication metadata came directly from the npm registry. No version is marked deprecated in that metadata.

| Package                                                     | Current pin | Recommended patch | Published UTC           | Eligible at 24 hours (UTC) |
| ----------------------------------------------------------- | ----------- | ----------------- | ----------------------- | -------------------------- |
| [expo](https://registry.npmjs.org/expo)                     | 58.0.19     | 58.0.21           | 2026-10-28 15:36:05.811 | 2026-10-29 15:36:05.811    |
| [expo-router](https://registry.npmjs.org/expo-router)       | 58.0.26     | 58.0.28           | 2026-10-28 15:36:42.455 | 2026-10-29 15:36:42.455    |
| [expo-linking](https://registry.npmjs.org/expo-linking)     | 58.0.14     | 58.0.15           | 2026-10-28 15:34:41.340 | 2026-10-29 15:34:41.34     |
| [expo-constants](https://registry.npmjs.org/expo-constants) | 58.0.13     | 58.0.14           | 2026-10-28 15:35:30.588 | 2026-10-29 15:35:30.588    |
| [expo-font](https://registry.npmjs.org/expo-font)           | 58.0.10     | 58.0.11           | 2026-10-28 15:33:20.136 | 2026-10-29 15:33:20.136    |
| [@expo/ui](https://registry.npmjs.org/%40expo%2Fui)         | 58.0.23     | 58.0.25           | 2026-10-28 15:33:03.917 | 2026-10-29 15:33:03.917    |
| [jest-expo](https://registry.npmjs.org/jest-expo)           | 58.0.12     | 58.0.13           | 2026-10-28 15:31:28.680 | 2026-10-29 15:31:28.68     |

**Earliest eligibility for all seven direct packages:** October 29, 2026, 15:36:43 UTC / **08:36:43 PDT**. This is not a guarantee that the entire dependency graph can install then: previously rejected transitive packages included `@expo/cli@58.1.17`, published October 28 at 15:39:30.715 UTC. Recheck the current recommendations and let the existing pnpm resolver enforce the age rule for every package on the retry. No age exclusion, clock override, offline compatibility bypass, SDK major change or manifest/lockfile update was made in this follow-up.

The preceding acceptance follow-up attempted a targeted patch update, but pnpm rejected the new versions and their dependencies with `ERR_PNPM_NO_MATURE_MATCHING_VERSION`. The repository's `pnpm-workspace.yaml` sets `minimumReleaseAge: 1440` (24 hours); the recommended Expo packages and dependencies were published on October 28 around 15:31–15:40 UTC. No dependency or lockfile changes were applied. The age policy and validation checks were not disabled or excluded. This follow-up rechecked the registry ages and did not repeat an ineligible update. The existing frozen-lockfile installation and full quality suite were rerun successfully without changing dependencies. Once the versions satisfy the policy, apply the eligible compatible patches, update the lockfile, and repeat frozen installation, all checks and affected native smoke tests. This is dependency recommendation drift, not an observed iPhone crash or layout defect.

Historical CI follow-up: [run 40731332144](https://github.com/hasanzahran/typeduel/actions/runs/40731332144) on October 28 **failed** at Expo dependency compatibility for `888fe0d14f0f2cc131a914070f776a03df4f8c73`. Locked installation and all formatting/lint/types/tests/build/fixture checks passed; the failing step reported the same seven patch mismatches as local validation. Expo Doctor did not execute in CI because the preceding install check failed; its 19/20 result above is the separate local run. This report is a subsequent documentation-only change; the latest head's checks are linked from [PR #1](https://github.com/hasanzahran/typeduel/pull/1). Older green runs below are historical evidence, not current acceptance.

## GitHub publication follow-up (historical)

Remote verified as `https://github.com/hasanzahran/typeduel.git`. The approved document baseline (`82d3d23`) was pushed to `main`, establishing the PR base without rewriting history. `codex/m0-foundation` adds the implementation (`fcfe1dd`) and verification follow-up.

After browser authorization, both branches were pushed successfully. [Pull request #1](https://github.com/hasanzahran/typeduel/pull/1) was opened against `main` and subsequently merged by the owner on October 28, as recorded above. [GitHub Actions run 40255465855](https://github.com/hasanzahran/typeduel/actions/runs/40255465855) completed successfully for `b9ff6ebeae1577bcfecd86e96a308cf0c23cb693`, including every quality and Expo compatibility step. The subsequent report commit `5b2710d` also passed [run 40255638879](https://github.com/hasanzahran/typeduel/actions/runs/40255638879). Android acceptance commit `a6c87718e8fab7fe259bdf56d13e8b039ecaa0a9` passed [run 40261309284](https://github.com/hasanzahran/typeduel/actions/runs/40261309284). This result is recorded by a subsequent documentation-only commit; its own current check is linked from the PR. No force push, rebase, merge, or history replacement was performed.

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

### iOS environment investigation (2026-10-25) and current access

The earlier USB/tooling investigation found Command Line Tools without full Xcode, `simctl` or `devicectl`. That did not prevent the owner's now-confirmed physical-iPhone Expo Go run. Remaining remote capture is blocked by Computer Use permissions; installing Xcode is not required to finish the manual acceptance checklist. The following availability/cost research is retained with its original date, not rechecked on October 28.

**Verified availability, 2026-10-25:** the US [App Store listing](https://apps.apple.com/us/app/expo-go/id982107779) offers Expo Go **58.0.5**, released October 22, with release notes explicitly adding SDK 58 support; it is free and requires iOS **16.4+**. Apple's [lookup metadata](https://itunes.apple.com/lookup?id=982107779&country=us) independently returned the same version, date, OS minimum and SDK support. The listing's generic description still mentions an older React Native version; the version-specific notes and metadata were used for compatibility. [Expo's download page](https://expo.dev/go) also lists SDK 58 as latest. Availability is verified for the US storefront, not every region or a particular phone's installed version.

**Recommendation:** use a physical iPhone with that compatible App Store Expo Go on the same Wi-Fi as this Mac. Install/update Expo Go using the phone's Apple Account, allow Local Network access, start `pnpm dev` with the pinned toolchain, and scan Metro's QR code with the iPhone camera. No paid Apple Developer membership, Expo cloud account/build, Xcode, TypeDuel signing, TestFlight or project change is required for this LAN preview. The existing Metro server responded to an iOS manifest request over this Mac's LAN address with `runtimeVersion=exposdk:58.0.0` and a launch asset. This verifies local serving only, not connectivity or execution on an iPhone. Confirm the installed app/version and actual launch before marking native compatibility passed. Local API localhost URLs are device-relative; Android ADB reverse does not establish iPhone API connectivity.

| Option                                          | Requirements and costs                                                                                                                                                         | Suitability for M0                                                                                                                                                                          |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Physical iPhone + App Store Expo Go 58.0.5      | iOS 16.4+, Apple Account for App Store download, free Expo Go, same LAN and Metro; no paid developer enrollment or local native tools                                          | Preferred; physical-iPhone launch now owner-confirmed. Exact installed version remains unreported                                                                                           |
| Expo Go beta via TestFlight                     | Expo-provided invitation and compatible beta, free TestFlight app; availability/slots must be checked if needed                                                                | Not required: compatible stable App Store Expo Go is available. No beta invitation was needed or verified                                                                                   |
| TypeDuel iOS development build, built locally   | Compatible Mac/Xcode and native build tools, signing and Developer Mode on iPhone; free Apple Account can use Personal Team with 7-day provisioning; Expo account not required | More disruptive here: SDK 58 source builds require a newer Xcode/macOS toolchain; project native-build configuration would need review                                                      |
| TypeDuel development build via EAS              | Expo account/project and EAS configuration; physical-device ad hoc signing needs paid Apple Developer membership and device registration, plus Developer Mode                  | Avoids local Xcode but adds account/signing/configuration work. Free EAS quota may cover a build; no build or account setup initiated                                                       |
| TypeDuel release distributed through TestFlight | Signed build, paid Apple Developer membership, App Store Connect record/upload and TestFlight app; external testing requires beta review                                       | Not appropriate for the current four-screen preview: all four routes use `__DEV__`; a normal release build shows the unavailable shell. Changing fixture isolation requires separate review |
| Xcode Simulator + prebuilt Expo Go              | Full Xcode, compatible iOS Simulator runtime and SDK 58 Expo Go simulator binary; software is free, no paid Apple membership for simulation                                    | Fallback if no iPhone; large downloads/storage required and runtime combination remains untested                                                                                            |

[Expo's development-build guide](https://docs.expo.dev/develop/development-builds/introduction/) distinguishes local builds from EAS; [internal distribution](https://docs.expo.dev/build/internal-distribution/) explains iOS ad hoc device registration. [Apple Personal Team limits](https://developer.apple.com/help/account/basics/about-your-developer-account) include 7-day provisioning. [Apple Developer membership](https://developer.apple.com/programs/enroll/) is USD 99/year (regional prices and eligible waivers vary); [EAS Free pricing](https://expo.dev/pricing) currently includes up to 15 iOS builds with a low-priority queue, subject to the account's remaining quota. Paid EAS service is therefore not inherently required, but no cloud build is authorized by this investigation. [TestFlight](https://developer.apple.com/testflight/) adds distribution setup and external beta review, with no benefit for this already-supported Expo Go preview.

For Simulator preview, full Xcode, an installed iOS Simulator runtime and a compatible prebuilt Expo Go simulator app are needed. [Apple lists Xcode 26.3 as compatible with macOS 15.6](https://developer.apple.com/xcode/system-requirements), so this is a possible preview path on the current macOS 15.6.1, subject to verifying the prebuilt app/runtime combination. It has not been installed or proven. Building SDK 58 from source instead requires [Xcode 26.4+](https://docs.expo.dev/versions/latest/); Xcode 26.4.1 requires macOS 26.2+. Only about 9.9 GiB is free on the internal volume. Do not start a large Xcode/runtime installation or macOS upgrade without approval and a storage plan.

### Current iOS acceptance matrix

| Item                                                        | Evidence and result                                                                                                                       |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Physical-iPhone launch in Expo Go                           | **Confirmed by user**, 2026-10-28                                                                                                         |
| Overall approved dark/teal visual direction                 | **Confirmed by user**; individual screen captures/comparison not supplied                                                                 |
| Timer, input and Submit visible with keyboard open          | **Confirmed by user** on their tested configuration                                                                                       |
| Android keyboard-fix regression on iOS                      | Reported overlap scenario passes on that iPhone; animation, repeated open/close, compact/large text and other keyboards remain unverified |
| Home → Quick/Friend Setup → Gameplay → Results → Home; Back | Source and automated route tests reviewed; **native iOS traversal unverified**                                                            |
| All four screen layouts and scrolling                       | Shared responsive components reviewed; no per-screen iOS capture, short-screen or large-text confirmation                                 |
| Safe areas at notch/status bar and home indicator           | SafeAreaProvider/SafeAreaView present in source; **native edge clearance across all routes unverified**                                   |
| Submit tap and iOS Send; pending/listening input lock       | Portable tests pass; user confirmed visibility only, so **native behavior unverified**                                                    |
| VoiceOver labels, selected/disabled states and focus order  | Source labels/roles/states reviewed; **native VoiceOver smoke unverified**                                                                |
| Text scaling, target sizes and visual readability           | Scaling is not disabled; source controls use minimum heights 48–56, Back 48×48; **native scaled layout and hit areas unverified**         |
| Keyboard assistance                                         | Disabling configuration retained; iOS behavior not reported. Gboard issue is accepted for M0 and assigned to M1                           |
| iOS screenshots                                             | **Not captured**: remote permission barrier; manual procedure below                                                                       |
| Device / runtime / keyboard / build provenance              | Requested; not yet supplied                                                                                                               |

Source review found the shared safe-area wrapper and iOS `KeyboardAvoidingView` padding branch intact. Home, Setup and Results scroll; Gameplay scrolls metadata above the pinned timer/composer when the keyboard is open. Setup chips wrap, primary actions expose button labels/disabled states, mode/category choices expose radio states, and decorative icons are excluded from accessibility. Stack animation is disabled. These are implementation observations, not native accessibility or layout passes. VoiceOver announcement of changing status/results must be tested; portable property tests do not establish announcement or focus behavior.

Calculated full-opacity token contrast ratios: primary text/background **17.89:1**, primary text/surface **15.24:1**, secondary text/background **11.03:1**, secondary text/surface **9.39:1**, and accent text/accent **7.77:1**. This source-level calculation does not cover every rendered state, keyboard, disabled opacity or display accessibility setting.

### Remaining manual iPhone checks and screenshot procedure

Record the iPhone model, iOS/Expo Go versions, keyboard/language, text-size setting and tested Git commit. Your existing launch, design and keyboard-visibility confirmations remain accepted. The following items are **unverified** until you report actual results:

- [ ] **Navigation:** Home → Quick Match → Setup → Preview game → Preview results → Back Home; repeat through Play with Friend and test Setup Back. Check Classic/Challenge and category selection, and scroll to bottom controls.
- [ ] **Safe areas:** on all four screens, check the notch/status bar and home indicator; no clipped text, covered buttons or unreachable content, with the keyboard open and closed.
- [ ] **Submit/Send:** type arbitrary text and try both Submit and the keyboard's Send key. Each must show the mock-only submission notice without changing scores. Repeat after closing/reopening the keyboard; check listening/pending input lock.
- [ ] **Larger text:** increase iOS accessibility text size, revisit all four screens and keyboard-open Gameplay, and check readable labels/scrolling and visible timer/input/Submit. Restore the original setting; mark compact-iPhone coverage untested if no compact device is available.
- [ ] **VoiceOver:** traverse the primary controls and Back; verify labels, selected/disabled states, logical reachable focus, spelling-field editing and readable status/results. Record failures; this is a basic smoke test, not a full accessibility audit.
- [ ] **Screenshots:** capture Home, Setup, Gameplay with keyboard closed, Gameplay with keyboard open, and Results. Add a larger-text Gameplay capture if tested. Compare with `docs/design/mockups/`; keep mock labels visible and avoid personal notifications.

Use the iPhone's screenshot buttons (Side + Volume Up on Face ID models; Home + Side/Top on Home-button models). Attach unedited captures to this task or transfer them to the Mac. Planned filenames under `docs/verification/ios/` are `home.png`, `setup.png`, `gameplay.png`, `gameplay-keyboard.png`, `results.png`, and optionally `gameplay-large-text.png`; none has been supplied yet. Include pass/fail notes for interactions and VoiceOver, since screenshots alone do not verify them.

### M1 evaluation requirement: accessible controlled keyboard

The owner has assigned complete resolution of keyboard assistance to **M1 gameplay**, accepting the documented Gboard limitation for M0. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) now requires an accessible custom in-game keyboard evaluation, cross-platform consistency, spelling fairness, hardware-keyboard handling and accessibility testing. Evaluate an in-app keyboard with no OS IME connection for the competitive answer buffer against native alternatives. Evaluation is planned; a custom keyboard is **not implemented or approved** and would amend the explicit native-keyboard policy in `UI_UX_DESIGN.md`. M1 has not started.

The proposal should include individually labeled semantic key buttons, Backspace and Submit, a readable answer buffer, stable focus order, VoiceOver/TalkBack and switch-control support, high contrast, scalable labels and layouts, and minimum 44 pt iOS / 48 dp Android touch targets. A full QWERTY row cannot fit 48 dp keys on a compact 360 dp display, so review a compact alternative (for example paged/fewer-column layouts) with accessibility users before choosing a design. Do not shrink targets or disable assistive technology to fit. Define supported languages/diacritics and hardware-keyboard handling explicitly; hiding the soft keyboard alone leaves native text injection paths open. Review fairness and accessible input accommodations together. Test compact screens, large text, screen readers and real devices before adopting it. Even a controlled keyboard cannot prevent another device or other external help.

### Final acceptance checklist and recommendation — 2026-10-29

- [x] M0 foundation, approved architecture/tokens, four labeled mock screens and local health API implemented; no M1 functionality.
- [x] Android four-screen/navigation and keyboard evidence retained from October 25.
- [x] Physical-iPhone Expo Go launch, visual direction and keyboard-open timer/input/Submit visibility confirmed by the owner.
- [x] October 29 formatting, lint, strict types, 17 tests, server/contracts builds, all production exports and fixture isolation pass on the updated dependency graph.
- [x] Current Expo compatibility and all 20 Doctor checks pass; patch updates and their transitive dependencies satisfy the unchanged release-age policy.
- [ ] Current GitHub CI green: verify the October 29 dependency-update head after pushing PR #2.
- [ ] Native iOS route traversal, all-screen safe areas, Submit/Send, basic VoiceOver and large-text checks confirmed.
- [ ] iOS screenshot evidence and device/runtime/build details supplied; remote access unavailable, manual steps documented.
- [x] Gboard predictions remain documented as an **accepted M0 limitation**, with resolution and accessible custom-keyboard evaluation required in M1.
- [x] Owner-approved PR #1 merge preserved; remaining work isolated on a new M0 branch. No custom keyboard, M1 work, large installation, paid build or architecture/design change.

**Recommendation: keep final M0 acceptance pending; the original merge is complete.** The owner's successful iPhone run removes the previous environment/launch blocker and confirms the key keyboard-overlap scenario. It does not establish the remaining native checks. Expo compatibility is restored. Confirm green CI on PR #2 and close the manual iOS checklist before approving M0. The compatibility changes may be reviewed separately from the still-pending native acceptance evidence; PR #2 must not be merged automatically. Do not start M1. No new application defect was established by this review; the dependency gate and unverified acceptance evidence are distinct issues.

## Remaining limitations

- Native compilation of standalone Android/iOS binaries was not performed. Hermes/web exports validate bundling, not native binary builds. A standalone binary is not needed to finish this M0 Expo Go checklist.
- Physical-iPhone evidence is limited to the three owner confirmations above. Full VoiceOver/TalkBack, hardware-keyboard, alternate IME and reduced-motion system-toggle testing remain unverified. Basic iOS accessibility/large-text smoke is still part of M0 acceptance; exhaustive device/input coverage remains later work.
- Xcode installation or macOS changes are unnecessary for the chosen physical Expo Go route and were not initiated. Remote capture failed on Computer Use permissions, not on Expo Go availability.
- M0 preview actions remain disconnected from gameplay. No auth, sockets, database, word/audio pipeline, cloud resources or paid services were added. Approved architecture, design and PNG references are unchanged. The dependency policy is unchanged; the eligible patch updates are listed above. Post-update native smoke evidence remains pending.

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
