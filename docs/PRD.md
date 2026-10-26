# TypeDuel — Product Requirements Document v0.4

**Date:** October 25, 2026  
**Status:** Approved product scope for V1; difficulty-specific typing windows subject to playtesting  
**Platforms:** iOS and Android  
**Companion document:** `TypeDuel_SYSTEM_DESIGN_v1.2.md`

## 1. Product vision

TypeDuel is a fast two-player mobile game in which both players hear the same spoken English word and race to type its spelling. The app rewards speed and accuracy. Players can compete against a random opponent or invite a friend, choose between Classic and Challenge, and—in friend matches—select a themed category.

The MVP should feel welcoming to a new player within one minute, with short rounds, visible progress, fair authoritative scoring, reliable audio, and a natural path to a rematch.

## 2. Target users and supported devices

- Friends who enjoy friendly competitive games.
- Casual mobile players seeking short multiplayer sessions.
- Players who enjoy spelling, reaction, and typing challenges.
- Two authenticated users on **separate physical Android and/or iOS phones**. Split-screen local multiplayer is out of scope.

## 3. Version 1 scope

### Required (P0)

- Apple, Google, and Facebook sign-in (subject to platform policies); username/avatar, logout, in-app account deletion.
- Home with **Quick Match** and **Play with Friend**.
- **Classic** and **Challenge** game modes.
- Five difficulties: 1 Beginner, 2 Easy, 3 Medium, 4 Hard, 5 Expert.
- **Five category choices:** General (all approved words), Animals, Food, Sports, Technology.
- General-only public Quick Match; any category for private friend matches.
- Private room links/codes, visible invitation settings, both-player readiness.
- Automatic match word selection, identical reviewed prerecorded voice audio for both players, and audio preloading before the countdown.
- Server-authoritative rounds, timers, spelling verification, scores, tie handling and recovery after a short connection loss.
- Three submissions per player per round, two additional word-audio replays per round, at most three sudden-death rounds.
- Round results, final results, rematch, profile stats and recent match history.
- Offline/admin tool to produce approved word audio using Amazon Polly. No founder-recorded audio and no live per-match TTS generation.

### Later (P1/P2, out of V1)

- Public category-specific matchmaking queues; ranked/skill matchmaking; XP, seasons, trophies and global leaderboards.
- More languages (including Arabic), more word categories, daily challenges, tournaments and solo practice.
- Chat, user-generated word packs, monetization, cosmetics and advanced anti-cheat.

## 4. Modes, categories, and difficulties

| Setup | Quick Match | Play with Friend |
|---|---|---|
| Mode | Classic or Challenge | Classic or Challenge |
| Category | **General only** (shown as fixed) | General / Animals / Food / Sports / Technology |
| Difficulty | Pick 1–5 in Classic; automatic in Challenge | Host picks 1–5 in Classic; automatic in Challenge |
| Opponent | Automatic same-mode/same-Classic-level matching | Invited authenticated friend |
| Who accepts settings | User selects own settings | Invited player sees and accepts frozen host settings |

**Category definition:** Category is a word-pool filter, not the player's skill level. General includes all playable English words regardless of topic. Animals, Food, Sports and Technology are curated topical word pools. Some words may belong to multiple named categories. Every named category must provide meaningful playable coverage at **each** difficulty; the app must not silently substitute unrelated General words when a category pool is missing.

**Classic:** Both players face the same randomly selected spoken word at the chosen fixed difficulty and category every round, including sudden death.

**Challenge:** Both start at Level 1 in the chosen category; after any round that produces a valid winner, both move up one level (max Level 5). After a scoreless round, both remain at the current level. The category remains unchanged throughout the match, including sudden death.

**Example:** A friend match can be `Challenge + Animals`. It starts with Beginner animal words; every successful round advances the shared difficulty, while Animals stays selected.

## 5. Finalized match rules

| Rule | V1 requirement |
|---|---|
| Players | Exactly two, each on a separate device |
| Standard match | Five rounds |
| Initial countdown | Three seconds before the first initial word playback; later preparation/countdown as the server schedules |
| Word announcement | One prerecorded approved audio clip; same version for both devices; text hidden until round result |
| Typing timer | Begins **after the initial clip finishes**; server-controlled duration depends on difficulty |
| Provisional durations | Beginner 8s, Easy 8s, Medium 10s, Hard 12s, Expert 15s — must be playtested |
| Spelling attempts | **Maximum three counted submissions per player per round** |
| Wrong submission | Costs one attempt; player may try again if attempts and time remain |
| Audio replays | **Two additional replays per player per round**, during typing only; do not stop/reset timer |
| Round winner | First correct server-received and validated submission receives one point; round closes |
| Scoreless round | No point; Challenge difficulty does not advance |
| Normal match winner | Higher score after five rounds |
| Tied match | Up to **three sudden-death rounds**; stop when scores become unequal |
| Still tied | **Draw after sudden-death round 3**; maximum eight total rounds |
| Word repetition | No repeated words within any match, even across sudden death |
| Reconnect | Short proposed 10s grace; timer continues; authoritative server snapshot on reconnect |

An acknowledged retransmission with the same attempt ID does **not** cost another spelling attempt. A new submission—even of the same text—counts as a new attempt. The game should show attempts remaining (3→2→1→0) and replays remaining (2→1→0) clearly.

**Fairness limit:** We use first valid server arrival for V1. Different network latency may affect near-simultaneous races; collect measurement data and assess a near-tie policy only after testing. Client timestamps cannot award points or override the server.

## 6. User journeys

### Quick Match

1. Sign in → Home → Quick Match.
2. Choose Classic or Challenge; show `General · All Words` as noneditable.
3. Choose difficulty if Classic; see how Challenge progression works if Challenge.
4. Join matchmaking queue; find one compatible opponent; wait until both ready.
5. Preload the word, countdown, play it, unlock typing after audio ends.
6. Complete five rounds plus at most three sudden-death rounds if necessary.
7. Show final winner/draw, category, scores and rematch/exit options.

### Friend match

1. Home → Play with Friend → choose mode and **any of five categories**.
2. Host selects difficulty if Classic; creates an expiring room link/code.
3. Friend opens invite, reviews mode/category/difficulty and joins.
4. Both confirm ready; settings remain fixed through the match.
5. Complete the same synchronized gameplay and results flow as Quick Match.

### Match interruption

- Lost connection: show reconnecting state; do not freeze server deadlines or falsely show a victory.
- Audio preload fails: reschedule both players or cancel without awarding points.
- Backend crash: match may be canceled as interrupted and must not be recorded as a player win.
- App maintenance: stop accepting new matches, allow running ones to complete if possible.
- Category has insufficient approved words: do not start a match with an unplayable category; communicate availability rather than switching it silently.

## 7. Word and voice content

- Start in English using **one consistent approved US-English voice**.
- An offline Amazon Polly batch job generates versioned MP3s; admin tooling handles listening, approval, regeneration, and disabling bad clips. Audio files are reused across matches.
- Each word has one canonical spelling, one difficulty, an approved audio asset, optional accepted spelling variants, and zero or more approved named-category tags.
- Exclude ambiguous homophones and uncertain pronunciations; review Expert words and flagged pronunciations manually.
- Editorial launch readiness: at least **30 approved playable words per level per named category** as an initial coverage gate, configurable after observing word diversity. More inventory is encouraged. Never repeat words in a single match.
- Avoid slang/unsafe/offensive vocabulary in the initial family-friendly word bank; be mindful of age ratings and content rights.

## 8. Screens required for V1

1. Welcome / social sign-in.
2. Home (Quick Match, Play with Friend, Profile).
3. Match setup (Classic/Challenge; General fixed for public or category cards for friends; Classic difficulty chooser).
4. Friend create/invite / friend join preview.
5. Matchmaking lobby, ready status and audio preflight.
6. Main game screen (scores, round, category, level, synchronized timer, audio, text input, attempts remaining, replays remaining).
7. Round result and Challenge level-up transition.
8. Final results (winner/draw, statistics, rematch).
9. Profile and recent history.
10. Settings, accessibility audio controls, privacy and account deletion.
11. Reconnect, server maintenance, unavailable-category and match-aborted states.

See `TypeDuel_UI_UX_DESIGN_v0.1.md` for the initial design specification and text wireframes.

## 9. Performance, security and accessibility

- Real-time server authority with idempotent submissions and a canonical snapshot after reconnect.
- Audio preloading, unguessable object keys, short-lived authorized access to audio; **do not** show secret words before round result.
- Do not claim the audio is impossible to capture or transcribe on a modified phone.
- Compatible with iOS and Android hardware keyboards and common IMEs as feasible; disable autocorrect/paste where technically available without treating that as security.
- Use clear typography and contrast, large touch targets, haptics with an off switch, reduced-motion support and speech/audio accessibility guidance.
- Account deletion, age-appropriate content, minimal personal data collection and store-policy compliance.
- Production deployments require safe match draining; unexpected process failure can abort an active V1 match.

## 10. Launch success metrics (initial goals, not observed data)

- Healthy-network match completion rate ≥90%.
- No inconsistent server/database/player scores in a completed match.
- Track matchmaking latency and cancellation rates; rematch rate; Day 1 and Day 7 retention.
- Track accuracy, response time, attempts, audio replays and voice-preload failures **by category × difficulty × game mode**.
- Track category inventory/approval coverage, words repeated per match (target **zero**), close race RTT/jitter and draw rates.
- Confirm real-device performance for Android↔iOS, iOS↔iOS, Android↔Android, Bluetooth and interrupted audio.

## 11. Acceptance criteria

The V1 product is ready for beta when:

1. Two authenticated players on Android/iOS can finish consistent five-round matches.
2. Quick Match uses General exclusively and does not fragment queues by category.
3. Friend hosts can choose one of five categories and an invitee clearly sees locked setup values.
4. Classic holds category and difficulty fixed; Challenge holds category fixed while difficulty rises after a successful round.
5. Only category-eligible approved words/audio are used, with no repeats within a match.
6. Typing stays locked until the original audio clip finishes; proposed timing values are validated on devices.
7. Each player has at most three counted attempts and two additional replays per round.
8. A tie leads to at most three sudden-death rounds; an unresolved tie becomes a draw.
9. Authoritative scores never diverge; no client payload contains secret spelling before the result.
10. Preload failures, connection loss, aborted matches and controlled deploys do not cause phantom wins.
11. Account creation, sign-out/deletion and store review requirements work on both platforms.
12. All four themed categories have approved sufficient stock across all five difficulties.

## 12. Open tuning and design decisions

These do not require architectural redesign:

- Validate the proposed 8/8/10/12/15-second typing windows after initial audio completion.
- Tune fonts, colors, animations, haptic behavior and the number of seconds used for transition cards.
- Assess audio accessibility and clipping on common phone speakers/headsets.
- Calibrate category/level word distributions after usage data; initial coverage gate is not a permanent number.

## 13. Implementation direction

Build with React Native + Expo; Node.js + Fastify + Socket.IO; Supabase Auth + PostgreSQL; offline Amazon Polly batch TTS; a managed always-on single authoritative backend to start. See `TypeDuel_SYSTEM_DESIGN_v1.2.md` for exact APIs, schema and transition semantics. Codex implements in independently tested milestones and cannot silently change product rules.

## 14. Official technical references

- [Expo Audio](https://docs.expo.dev/versions/latest/sdk/audio/)
- [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/)
- [Supabase Auth](https://supabase.com/docs/guides/auth)
- [Amazon Polly SynthesizeSpeech](https://docs.aws.amazon.com/polly/latest/APIReference/API_SynthesizeSpeech.html)
- [Render deployments](https://render.com/docs/deploys)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
