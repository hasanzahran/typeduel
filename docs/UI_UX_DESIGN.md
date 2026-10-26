# TypeDuel — UI/UX Design v1.0

**Date:** October 25, 2026  
**Status:** Approved design baseline for implementation; subject to validation on physical iOS and Android devices  
**Owner of product rules:** `docs/PRD.md` (PRD v0.4)  
**Owner of technical rules:** `docs/SYSTEM_DESIGN.md` (System Design v1.2)  
**Design source:** The founder-approved TypeDuel dark charcoal/teal mockups; simplified UI/UX blueprint v0.2.

> This document freezes the intended visual direction, screen hierarchy, interaction behavior and acceptance criteria for the first implementation. It does **not** certify that static mockups are pixel-perfect or usability-tested. Where sample data in a picture disagrees with the PRD, the PRD and system design control.

## 1. Approved visual direction

**Minimal Competitive**: modern, clean and quick to scan, with near-black charcoal backgrounds, crisp white text, muted gray secondary labels and one bright teal accent. Prefer confidence and immediacy over arcade/neon decoration.

- Keep **one visually dominant action per screen**.
- Favor whitespace, a simple hierarchy and a small number of rounded surfaces.
- Avoid multi-color gradients, excessive glowing borders, large animated avatars, background particles, fake 3D keys and decorative dashboard widgets.
- Use native iOS/Android keyboards — **not** a custom drawn or recreated keyboard.
- Do not hide features: make complex states contextual rather than putting every option on screen all the time.
- Portrait-first phone experience on iOS and Android. Screen orientation policy: portrait for V1, pending device build verification.

### 1.1 Design tokens — V1 baseline

| Token | Value | Usage |
|---|---|---|
| `bg` | `#0B1220` | Primary full-screen background |
| `surface` | `#172235` | Input backgrounds, muted cards |
| `surfaceRaised` | `#1D2B3F` | Optional dialog/waiting surfaces |
| `text` | `#F8FAFC` | Main headings, scores, timer |
| `textMuted` | `#BBC8D8` | Metadata, labels, hints |
| `teal` | `#2DD4BF` | Selected states, primary CTA, wins |
| `onTeal` | `#042F2E` | Text/icons on teal |
| `border` | `#334155` | Subtle outlines and separators |
| `error` | `#FCA5A5` | Error state, paired with explicit copy |
| `success` | `#2DD4BF` | Success, paired with explicit copy |

Use platform system fonts first; use a consistent typographic scale, not fixed pixel-perfect text. Suggested sizes: display title 32–36sp/pt; title 24–28; body 16–17; labels 14–15; timer 48–64 (responsive); secondary microcopy not smaller than accessible platform guidance unless purely decorative. Maintain adequate contrast in all themes and states. Use regular/bold weight rather than additional colors for hierarchy.

**Spacing:** 8pt base grid; primary horizontal screen margins 20–24pt; 16–24pt section gaps; 12–16pt button/input corner radii; 48–56pt tall main buttons; minimum tap targets 44×44pt on iOS and 48×48dp on Android. Use accessible text scaling where possible; protect the gameplay composer when large fonts are enabled.

**Motion:** gentle transitions ~150–250ms for button/overlay feedback; optional brief final celebration ~500–700ms; observe reduced-motion settings. Gameplay time is server-owned, never affected by animation.

### 1.2 Approved visual references

The four PNG files are **style and layout references** (not final pixel measurements). Include them under `docs/design/mockups/`:

1. `home.png` — TypeDuel title, quick match, friend match, compact stats and secondary actions.
2. `setup.png` — Classic/Challenge toggle, themed category chips, difficulty selector and CTA.
3. `gameplay.png` — compact status, score, large timer, replay, input, Submit and native keyboard.
4. `results.png` — clear result, score, a few stats, Rematch and Home.

**Mockup corrections required in implementation:**
- `gameplay.png` illustrates `Challenge / Round 2 of 5 / Level 3`, which cannot occur in the finalized progression rule. The highest possible starting level for Round 2 is **Level 2**. Use live server-provided level/round values.
- `setup.png` shows category chips without distinguishing a public match from a friend match. The **category is selectable only for friend matches**; public Quick Match always uses **General** and should show it as read-only.
- The mockup's `Start Match` button means **Find Match** for public play or **Create Invite** for a friend-host flow; a friend lobby requires both players ready before the match starts.
- Results data and score examples are illustrative, never hard-coded.

## 2. App information architecture

```text
Welcome / Sign in (new or expired account)
    ↓
Home
 ├─ Quick Match → Match Setup [General fixed] → Finding Opponent / Ready → Game → Results
 ├─ Play with Friend → Match Setup [category selectable] → Invite / Ready → Game → Results
 ├─ Join Friend Link → Invite Preview / Ready → Game → Results
 ├─ Profile → Recent Matches
 └─ Settings → Audio/Haptics/Account/Privacy/Deletion

Game phases (same screen): preflight → countdown → initial audio → typing → round result
                      → next round or tiebreaker → match result
```

Only **Home, Setup, Game and Results** are the prominent navigation screens after sign-in. Waiting, invites, round feedback and reconnecting are contextual sheets, overlays or slim intermediate views. Avoid a complex tab bar in V1.

## 3. Screen specifications

### S00 — Welcome / Social sign-in

- Large TypeDuel logo/text and single-line promise: `Hear it. Type it. Win.`
- Three plainly labeled social sign-in actions: `Continue with Apple`, `Continue with Google`, `Continue with Facebook` (show provider-appropriate controls and adhere to platform policies).
- Concise `Terms` and `Privacy Policy` links; loading/error states; accessible labels.
- Returning users go directly to Home after valid session. No long slideshow. A one-round optional practice/tutorial can be offered after first login but is not required to enter play.
- Do not claim support for guest mode unless implemented. No unnecessary permissions before they're needed.

### S01 — Home

- Primary heading `TypeDuel`, supporting line `Fast word battles`.
- One compact stat summary, if known: `Wins`, `Matches`, `Win rate` (new player: `0`, `0`, `—` rather than fabricated data).
- Prominent teal **Quick Match** CTA. Outlined/quiet **Play with Friend** CTA.
- Secondary items: `Profile`, `How to Play`, `Settings`; one simple row or icon access for each.
- Avoid feed, carousel, giant rankings or nested game menus.

### S02 — Match setup (adaptive single screen)

- Header with Back and `Match Setup`.
- Mode control: `Classic` and `Challenge`; default to last used mode if visible and changeable, otherwise choose an explicit default (initial proposal: Classic).
- **Quick Match**: show `Category: General` as read-only. **Friend host**: chips/dropdown for General, Animals, Food, Sports, Technology; include only playable choices and explain temporarily unavailable categories.
- **Classic**: show all five selectable difficulty levels, `1 Beginner`, `2 Easy`, `3 Medium`, `4 Hard`, `5 Expert`. Show a one-line explanatory hint if useful.
- **Challenge**: hide the inactive difficulty control (instead of displaying a confusing disabled row); display `Starts at Level 1. Difficulty increases after a correct round.`
- CTA label: **Find Match** for Quick or **Create Invite** for friend host; disabled with explanatory reason if invalid.
- Do not silently change category/mode when transitioning to queue or lobby.

### S03 — Matchmaking / Invite / Ready

- **Quick queue:** simple spinner/animation and `Finding an opponent…`, selected mode and `General`; clear `Cancel` action. If timeout occurs, offer `Keep searching` and `Cancel`; don't fabricate estimated wait time.
- **Friend host:** invite code and native Share sheet, `Copy code`, locked mode, category and Classic level; status for invited player. Host can cancel waiting.
- **Friend guest:** deep-link/invite preview with opponent display name and locked settings, plus `Join` or `Decline`; if expired/full/unavailable show friendly reason.
- **Both ready:** compact two-person ready indicators; sound check/preload progress. Do not start countdown until the server confirms the required readiness and approved word audio is available to both devices.
- Handle opponent cancellation and audio-device problems without awarding phantom wins.

### S04 — Gameplay (critical screen)

Visual hierarchy, top to bottom:
1. **Compact metadata:** e.g., `Challenge · Animals`, `Round 2/5 · Level 2`; for tiebreaker `Tiebreaker 1/3`. This data comes only from the server.
2. **Compact scoreline:** `You 1 — 0 Sam`, not oversized avatars.
3. **Large countdown/timer:** central, monospace/tabular numerals `00:10`; label changes with phases (`Get ready`, `Listen carefully`, `Time remaining`). Never display a fabricated local timer as authoritative.
4. **Replay button:** speaker icon and `Replay`, with explicit `2 replays left` → `1` → `0`. Disabled/hidden before the first playback and after credits exhausted. No timer pause.
5. **Typing composer pinned above native keyboard:** one single-line text field `Type the word…`, prominent teal `Submit` button, `3 attempts left` counter.

**Keyboard policy:** Use platform native keyboard. Keep text field and Submit fully visible above keyboard when it opens, even on compact Android/iOS devices and with larger text. Prefer preparing/showing keyboard during pre-round countdown so keyboard animation does not consume the competitive typing window; **do not accept a submission before the server-authorized typing phase**. Validate early-focus/IME behavior on real devices before committing the exact focus strategy. Use return/done as an alternative Submit. Respect safe areas and predictive bars; never position critical controls in an inaccessible area. Support hardware keyboard where practical.

**Input policies:** Do not expose expected spelling in the input, client event, asset filename or error. Disable OS spelling suggestions/autocorrect/paste when supported; do not present these as reliable anti-cheat. Trim surrounding whitespace and use server-approved normalization; no partial-answer hints. After a send, briefly disable duplicate Submit and show pending ACK; same `attemptId` retries must not consume another attempt. A wrong accepted attempt shows `Not quite · 2 attempts left` and allows refocus. At 0 attempts show `No attempts left` and wait for round result/deadline.

**Audio:** Initial clip auto-plays after both devices preload and server schedules playback. Typing period begins after that clip's scheduled end, as controlled by the server. Replay is available up to twice **during** typing, and does not pause or extend the clock. Surface muted-volume/headphone/Bluetooth problems through sound check; never give a player an extra private unsynchronized countdown to compensate.

### S05 — Round feedback overlay / level-up

Keep on top of existing gameplay context for a short configurable duration. Display:
- Winner label `You scored!`, `Sam scored`, or `No point this round`.
- Correct spelling only **after the server closes the round**.
- Updated scores.
- In Challenge, `Level up → Level 3` if a valid winner advances the shared difficulty. A scoreless round does not advance.
- Avoid long disruptive transitions; release the next round only when the server schedules it.

### S06 — Match results

- Strong primary outcome: `You win!`, `You lost`, or `Draw` (draw after maximum three unresolved sudden-death rounds).
- Large final score and opponent name.
- Optional **accurately measured** stats: average correct submission time, accuracy, streak; if unavailable, hide rather than simulate numbers.
- Compact mode/category line (`Challenge · Animals`).
- Primary `Rematch`; secondary `Back Home`.
- Waiting-for-rematch state: `Waiting for Sam…` with Cancel; a new match only starts after both players agree.
- Any aborted match clearly says `Match interrupted` and does not use a winning celebratory treatment.

### S07 — Profile & history

- Display name/avatar, wins/losses/draws, matches played, win percentage when denominator >0.
- Recent matches with date, opponent display name, outcome, mode/category, result. No invented rank or XP in V1.
- Empty state `No matches yet. Start your first duel.` with Play CTA.

### S08 — Settings & account

- Audio playback volume guidance, sound effects and haptics switch, motion preference (system reduced motion respected).
- Privacy and terms links, sign-out, in-app delete account with confirmation and explanation of consequences.
- Account deletion must be a real functional flow backed by service APIs; not a placeholder UI.

### S09 — Tutorial / How to Play

One small instructional view: `Hear the word → Type it → Submit before time runs out.` Explain `3 attempts`, `2 replays` and the two modes. Optional sample round; don't force an unskippable tutorial on returning players.

## 4. Phase/state presentation contract

| Server phase or app condition | Visible status | Input & primary action | Audio / timer |
|---|---|---|---|
| `PRELOADING` | `Preparing next word…` | Not submittable | Audio fetched; no live timer |
| `COUNTDOWN` | `3`, `2`, `1` / `Get ready` | Keyboard may pre-open, but submissions rejected | Countdown schedules playback |
| `LISTENING` | `Listen carefully` | Submissions rejected | Initial audio; typing time not begun |
| `TYPING` | `Time remaining` | Input + Submit enabled; max 3 | 2 optional replays, no time extension |
| `VALIDATING` | `Checking…` | Prevent duplicate distinct submissions until ACK | Clock remains authoritative |
| `ROUND_RESULT` | Scored / missed; correct word | Read-only | Brief overlay; next server event controls transition |
| `MATCH_COMPLETE` | Win/loss/draw | Rematch / Home | No gameplay timer |
| `RECONNECTING` | `Connection lost. Reconnecting…` | Temporarily disabled | Server clock continues; snapshot on return |
| `MATCH_INTERRUPTED` | `Match interrupted` + explanation | Back Home | No awarded phantom win |
| `AUDIO_FAILURE` | `Couldn't play the word` | Retry preflight / leave | Don't start an unfair round |
| `SERVICE_MAINTENANCE` | `Matches temporarily unavailable` | Retry later / Home | New queues stopped |

## 5. Copy style and feedback

Short, consistent action copy. Favor plain language over jargon: `Find Match`, `Create Invite`, `Ready`, `Replay`, `Submit`, `Rematch`, `Back Home`.

For wrong words, use `Not quite` rather than shaming language. For connection loss, use informative neutral copy rather than showing a forfeited point. Error messages should describe what players can do next. Changes in attempt count, replay count and results must be paired with visible words or icons, not color alone.

## 6. Responsive behavior, accessibility, and internationalization

- Target phones first; support common short iPhone and small Android heights as well as tall phones. Use safe-area insets and layout measurement, not hard-coded absolute Y coordinates.
- Native keyboard layout differs by platform and may vary with IME, language, predictive bar, accessibility settings and device size. Test compact and large-text modes with keyboard **open**.
- Minimum targets: 44×44pt on iOS; aim for 48×48dp on Android. Preserve screen-reader access to all non-timed navigation/actions and announce round outcome clearly without auto-reading secret word prematurely.
- Respect Reduce Motion, provide tactile + textual feedback and visual indication for replay. Do not promise that an **audio-only spelling game** is equally playable by users who cannot hear; consider a separate accessible mode as a future product requirement, while keeping navigation and settings accessible in V1.
- Initial words and voice are English; do not introduce UI translation/different-accent assumptions into V1 game rules. Text layouts should avoid fragile truncation as a foundation for later localization.
- Do not support chat, rank progression, fake social activity or promotional upsells in V1.

## 7. Final UX acceptance checklist

- [ ] Visuals consistently use the approved dark/teal design tokens, with one dominant CTA.
- [ ] Every required PRD screen/state has a coherent layout and error behavior.
- [ ] Quick Match cannot select named category; Friend Match can choose all five active categories.
- [ ] Classic shows 1–5 level choices; Challenge clearly explains automatic level increases.
- [ ] Friend invite preview displays mode, category and Classic level, all locked.
- [ ] Gameplay score, level and round match server snapshot, without invalid examples (e.g. Challenge Round 2 Level 3).
- [ ] Secret spelling never appears before server result; no input suggestions expose it.
- [ ] Keyboard field, timer and Submit remain usable on iOS and Android with keyboard up.
- [ ] Initial spoken clip completes before timer starts; replay does not pause clock.
- [ ] Three counted attempts/two replays accurately decrease and ignore duplicate transmissions.
- [ ] Round overlay displays correct word only at the right phase; score and progression come from backend.
- [ ] Up to three sudden-death rounds; draw and aborted states look distinct from wins.
- [ ] Reconnection and audio errors never falsely award points.
- [ ] A returning user can enter Quick Match in a small number of straightforward steps.
- [ ] Screen-reader labels, touch targets, focus behavior, high contrast and reduced motion are reviewed.
- [ ] Physical iOS ↔ Android gameplay with native keyboards, Bluetooth/headphones and slower networks is tested before beta.

## 8. Implementation handoff and change control

1. Check in the three canonical planning docs: `docs/PRD.md`, `docs/SYSTEM_DESIGN.md`, `docs/UI_UX_DESIGN.md`.
2. Store the four approved visual references in `docs/design/mockups/` and the JSON token file in `docs/design/tokens.json`.
3. Build reusable design primitives (`Screen`, `Button`, `SelectableChip`, `Scoreline`, `Timer`, `AudioReplayButton`, `TypingComposer`, `MatchStatus`) with variants instead of screen-specific bespoke CSS.
4. Build a UI/component preview using deterministic fake data **in development only**, followed by real WebSocket-backed scenarios. The production client must never substitute fake scores or predicted round outcomes.
5. Implement in milestones from `docs/IMPLEMENTATION_PLAN.md`, with screenshots for iOS and Android (keyboard-open, listening, typing, result, error) as review artifacts.
6. If UX tests reveal issues, change the smallest affected spec and record the reason. Do not casually change the core gameplay rules or architecture.

**Design sign-off:** Approved visual direction and interaction contract for starting the Codex implementation plan. **Still to validate:** exact responsive behavior on real devices, font-scale edge cases, final timing values and playable experience.

## 9. Reputable design/implementation references

- [Apple: Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles/)
- [Apple: Designing for games](https://developer.apple.com/design/human-interface-guidelines/designing-for-games/)
- [Apple: Game controls](https://developer.apple.com/design/human-interface-guidelines/game-controls)
- [Expo: Keyboard handling](https://docs.expo.dev/guides/keyboard-handling/)
- [Expo: Audio](https://docs.expo.dev/versions/latest/sdk/audio/)
- [Socket.IO: Delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/)
