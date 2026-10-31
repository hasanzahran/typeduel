# Increment 04 physical-pair evidence and setup

**Status: pending.** No Increment 04 physical iPhone/Android match, acoustic timing measurement, listening approval or native accessibility pass has been recorded. M0 owner-confirmed iPhone evidence remains valid for M0, not evidence for these new gameplay paths. Do not invent device models, OS versions or screenshots.

## Owner prerequisites (separate from implementation approval)

- Two confirmed users in an existing authorized Supabase project using asymmetric JWT signing. Use one distinct user per phone. Only the URL and public publishable key go into mobile configuration; enter passwords interactively. No service-role key or token belongs in Git, screenshots or Expo public variables.
- Existing authorized PostgreSQL with a dedicated/session connection (not transaction pooling), a private connection string and permission to apply the checked-in migrations to the intended development schema. CI's disposable database is not the phone backend. No database has been provisioned by this increment.
- A reachable HTTPS backend origin with WebSocket support and a valid certificate, routing Socket.IO and `/v1` audio/API requests to the same server. Both phones must reach it independently of Metro. A QR code only loads the app. Choose an existing authorized host or separately approve a tunnel/hosting installation and any costs; no provider or plan is assumed here.
- Eight real reviewed MP3s and a private manifest. Candidate words remain cat, dog, cup, milk, desk, hand, drum and frog. Named editorial and listening decisions, exact final hashes and measured durations are required before startup. Synthetic test fixtures are never suitable for physical play.
- Physical iPhone and Android with compatible Expo Go, speaker output and an independent recording arrangement capable of distinguishing both audio onsets. No Xcode, EAS build, new Android tooling or paid build is required by these instructions; native behavior must still be tested.

## Separate bounded audio request — not yet authorized

Approve one offline Amazon Polly batch in an existing verified AWS account: Joanna Neural, en-US, us-east-1, MP3 at 24 kHz, plain-text inputs above, eight calls and 29 billable characters. At the checked [Neural price of US$16 per million characters](https://aws.amazon.com/polly/pricing/), synthesis is estimated at **US$0.000464**, excluding taxes/account-specific charges. Proposed synthesis-only authorization ceiling: **US$0.01**. No hosting/storage resources, retry batch or other AWS service is included. Price checked October 30, 2026; recheck before execution.

The tool defaults to dry-run and requires a named private approval record, verified account, exact request hash and unique private output directory for execution. See `tools/word-audio/README.md`. Each uncertain call consumes its attempt reservation and stops the batch; no automatic retry. Editorial approval of candidates and generation approval are not substitutes for listening to the final bytes. Generation is still prohibited until explicitly authorized.

## Reproducible startup after prerequisites are provided

Use Node 24.13.0 and pnpm 12.15.0. Keep credentials and assets outside the repository or in ignored local `.env` files. Do not paste credentials into commands recorded in documentation.

```sh
pnpm install --frozen-lockfile
pnpm build:contracts
pnpm --filter @typeduel/word-audio build
node tools/word-audio/dist/validate-eight.js /absolute/private/manifest.json /absolute/private/audio
```

Configure `apps/server/.env` from its example: `DATABASE_URL`, `SUPABASE_URL`, `GAME_SCHEMA`, `GAME_AUDIO_PROFILE=m1-first-pair`, `GAME_AUDIO_MANIFEST_PATH`, canonical `GAME_AUDIO_ROOT`, `GAME_AUDIO_SIGNING_KEY` (private base64 of at least 32 random bytes), `GAME_PUBLIC_ORIGIN` (reachable HTTPS origin). Configure `HOST` for the approved proxy/host. Keep `NODE_ENV=development`: the explicit eight-word profile intentionally cannot launch under `NODE_ENV=production` or stand in for full launch inventory.

After confirming the intended development database/schema, apply the migration and start the backend:

```sh
pnpm --filter @typeduel/server db:migrate
pnpm dev:server
```

Verify `/health/ready` at the configured backend origin returns success. Configure `apps/mobile/.env` with `EXPO_PUBLIC_API_URL` equal to that origin, `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Restart Metro after changing public configuration.

```sh
pnpm dev:mobile
```

Open the development `/playtest` route on both phones using the Expo Router development navigation/deep link. Sign in separately, choose **Sign in and find match**, then **Ready** on each. The development entry uses the existing authenticated queue; Game and Results use real committed state. Broader Home/Setup navigation remains outside this increment. No production mock fallback exists.

## Record before each run

| Field                                    | Actual value |
| ---------------------------------------- | ------------ |
| Build commit and backend commit          | Pending      |
| iPhone model, iOS, Expo Go version       | Pending      |
| Android model, OS, Expo Go version       | Pending      |
| Audio route and volume on each           | Pending      |
| Network path and measured conditions     | Pending      |
| Private catalog/version reference        | Pending      |
| Test operator and date                   | Pending      |
| Recording/screenshot evidence references | Pending      |

Do not record access tokens, passwords, signed grant URLs, open-round text or private catalog contents in shared logs/screenshots. Store raw evidence privately and publish a sanitized reference.

## Required native scenarios

1. Complete a real five-round match with a winner and an eight-round tied match. No repeated word/version. Compare both visible scores/results with committed state. Submit three distinct IDs (including repeated spelling) and confirm attempts 3→2→1→0. After an unconfirmed submission, deliberate retry must recover the original ACK without a new point/attempt.
2. Both initial clips preload before readiness; typing unlocks only after local initial end and committed ACTIVE state at the fixed schedule. Neither player's completion changes the shared deadline. Test two extra replays, overlap rejection and no timer reset; no third replay.
3. Measure actual onset skew over initial and subsequent rounds with both devices on a common independent recording timeline. Use isolated channels/contact microphones or an arrangement that unambiguously identifies each phone; record calibration and timing uncertainty. Compute `abs(onset_iOS - onset_Android) + measurement_uncertainty`. Every reported accepted sample must be ≤150 ms. Record raw onset/end markers, scheduled times, asset version, network and audio route. JS callback timestamps or matching timers do not prove acoustic timing. If separation or uncertainty is inadequate, mark **unverified**, never pass.
4. Delay/lose audio delivery, use invalid bytes, background/lock a phone during preflight/playback and interrupt native audio. Verify bounded cancellation with `AUDIO_UNAVAILABLE`, unchanged deadlines, no new point/winner. A previously committed completed result must stay immutable.
5. During ACTIVE typing, interrupt one connection then restore within the server-observed ten seconds. Verify canonical scores, counted ACKs and locally spent replays survive. Exceed grace and confirm interrupted/no-win. Pretyping disconnect may hit the earlier audio safety gate; grace never extends typing. Cold-process restart during an open round fails closed.
6. Repeat with measured network delay, jitter, packet loss, backend/database delay and a backend restart in the authorized development environment. Record actual settings and observed receipt order; never simulate claims by editing scores. No point may appear before successful commit or after rollback.
7. Check safe areas, keyboard-visible timer/composer/Submit, native Submit/Send, larger text, screen reader labels/order/status, reduced motion, focus and disabled controls on both phones. Confirm replay and input availability follow authoritative state. Capture Game preflight/playback/typing/keyboard/reconnect and Results screenshots on both platforms.
8. Inspect ordinary network and logs for private answer/guess/token leakage. Canonical text appears only after the round closes. Known Gboard suggestions remain an accepted UI-foundation limitation and an outstanding M1 competitive-keyboard requirement; no custom keyboard is implemented or claimed fair here.

| Gate                                                | Result  | Evidence |
| --------------------------------------------------- | ------- | -------- |
| Editorial and eight final listening approvals       | Pending | None     |
| iPhone-versus-Android normal and sudden-death match | Pending | None     |
| Acoustic skew + uncertainty ≤150 ms                 | Pending | None     |
| Native failure/reconnect/latency scenarios          | Pending | None     |
| Native accessibility and UI regression              | Pending | None     |
| Both-platform screenshots                           | Pending | None     |

Automated checks establish software behavior, not these physical observations. Increment 04 final acceptance remains pending until this table contains actual evidence and material failures are resolved.
