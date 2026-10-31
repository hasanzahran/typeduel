# M1 Increment 04 implementation verification

**Implementation review; physical acceptance pending.** Owner approved planning commit `64dfffb`. Main remains at accepted Increment 03 merge `8c29e2a`; this increment is on `codex/m1-04-playable`. No merge, external provisioning, audio generation, custom keyboard or later increment was performed.

## Implemented behavior

- Frozen strict completion/failure and scoped audio-access contracts; private manifest v1; no canonical word/lookup mapping in public descriptors or mobile bundles.
- Backend validates exactly eight reviewed immutable assets, checks hashes/paths/metadata and selects without replacement for General/Classic/Level 1. The explicit first-pair profile rejects missing content and production activation rather than substituting fixtures.
- Participant/session/round/owner-bound 60-second grants require current JWT and session again on download. Authorization is rechecked after awaited reads; errors do not echo grants or secrets. Responses are private/no-store.
- Durable 20-second preflight bound, fixed common schedule and completion gate. Both initial-completion receipts must arrive in `[playbackAt + duration, typingStartAt)`. Early genuine completions can retry after `INVALID_TIME`; missing proof cancels without a winner. No client completion changes a deadline. Existing FIFO, atomic commit-before-publication, 48 counted ACKs and ten-second reconnect policy remain.
- Checkpoint v2 and migration `0002_audio_gate`: old terminal v1 records remain readable without fabricating completion proof; unfinished old checkpoints are restart-interrupted. Do not roll back to an old binary after v2 writes.
- Mobile verifies bounded same-origin bytes and final hash, prepares a local native player, follows absolute server time, gates input on local initial completion and current authoritative state, reserves at most two replays and fences asynchronous work. Deliberate retries of unconfirmed identical submissions reuse the original ID; a new deliberate submission after a counted ACK creates a new ID even for the same spelling.
- Existing Gameplay/Results primitives now consume committed state. Development `/playtest` provides in-memory Supabase sign-in, matchmaking and readiness. Production exports exclude development entry/fixtures; this does not claim a completed production onboarding flow.
- Offline eight-clip tool defaults to dry-run. Explicit bounded approval is required for provider calls; one-attempt requests, a durable reservation ledger, bounded byte handling and private output prevent silent retries. Offline PCM measurement does not replace human listening or physical acoustic evidence.

## Agent contributions and integration

Backend implemented private catalog/delivery, durable audio gate, checkpoint upgrade, migration and baseline tests. Mobile implemented native cache/player/controller, real screen/runtime bindings, clock and session consumers. Independent QA added gate/rollback/FIFO/transport failure regressions and private-grant security tests. Lead froze interfaces/dependencies, integrated work, repaired callback races and early-completion contract mismatch, and implemented offline content tools and acceptance documentation. Content preparation reuses the eight-candidate worksheet; no named human editorial or listening decision was invented.

Implementation commits, excluding the two original planning commits:

| Commit                          | Scope                                                                               |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| `d70495e`                       | Shared contracts, synthetic private fixture, approved dependency pins               |
| `1c4cb38`, `7736341`            | Bounded audio tools, configuration, manifest validation                             |
| `27cf838`                       | Backend audio/catalog, authoritative gate and migration                             |
| `959ddf2`                       | Mobile native audio and committed Gameplay/Results                                  |
| `e073c0a`, `0f2d4d3`, `e764d7f` | Independent gate, transport, database and grant security tests                      |
| `f11fc88`                       | Integration fixes, callback fences, original-attempt retries and physical procedure |

Later integration commits fix the real server-receipt barrier in the slow-COMMIT regression, accept standard Supabase OAuth metadata while discarding unneeded fields, enforce HTTPS before live authentication and retry completion reports within the fixed window.

The downloaded team ZIP, extracted package, `.codex/` and untracked team-coordination document are excluded. Existing M0/M1 evidence is preserved.

## Dependency security

Pinned versions were accepted by pnpm with **unchanged `minimumReleaseAge: 1440`**, strict engines and existing build-script allowlist. A fresh clean-worktree `pnpm install --frozen-lockfile` succeeds. No release-age exclusions or policy bypasses were added. Registry metadata rechecked October 30, 2026; these versions were not marked deprecated:

| Package                                   | Pin      | Registry publication (UTC) |
| ----------------------------------------- | -------- | -------------------------- |
| expo-audio                                | 58.0.10  | 2026-10-21 18:16:03.288    |
| expo-file-system                          | 58.0.13  | 2026-10-28 15:39:27.892    |
| expo-crypto                               | 58.0.7   | 2026-10-16 15:42:06.380    |
| expo-asset                                | 58.0.19  | 2026-10-28 15:35:29.223    |
| @aws-sdk/client-polly (offline tool only) | 3.1159.0 | 2026-10-28 18:47:05.296    |

`expo-asset` was already transitive at this version; it is now explicit because Expo Audio requires the native peer. Expo SDK major and architecture remain unchanged. The pre-existing Metro peer-version warning remains in pnpm output; Expo validation and Doctor accept the resulting graph.

## Executed validation

Clean-worktree validation (Node 24.13.0 / pnpm 12.15.0), plus targeted rechecks after integration fixes; exact PR-head CI is the merge/review gate:

| Check                                               | Result                                                                                                                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frozen-lockfile installation                        | Passed                                                                                                                                                           |
| `pnpm format:check`                                 | Passed                                                                                                                                                           |
| `pnpm lint`, boundaries and generated design tokens | Passed                                                                                                                                                           |
| `pnpm typecheck`                                    | Passed across all workspaces                                                                                                                                     |
| Shared contract tests                               | 28 passed                                                                                                                                                        |
| Server unit/component tests                         | 141 passed                                                                                                                                                       |
| Mobile tests                                        | 88 passed                                                                                                                                                        |
| Offline audio-tool tests                            | 7 passed; no provider calls                                                                                                                                      |
| `pnpm build`                                        | Passed: contracts, server, offline tool and web/iOS/Android production exports                                                                                   |
| Release fixture isolation                           | Passed                                                                                                                                                           |
| `expo install --check`                              | Passed: dependencies up to date                                                                                                                                  |
| Expo Doctor                                         | 20/20 passed                                                                                                                                                     |
| Eight-clip generation dry-run                       | Passed; eight requests / 29 characters, no generation                                                                                                            |
| Real PostgreSQL/Socket.IO integration               | 108 passed on PostgreSQL 18.6; [CI evidence](https://github.com/hasanzahran/typeduel/actions/runs/41165097024)                                                   |
| Exact PR-head GitHub checks                         | [PR #6 checks](https://github.com/hasanzahran/typeduel/pull/6/checks) are authoritative for the latest head; require both quality and postgres-integration green |

Unit/component total: **264**. Native production export success is not proof of native installation, real audio output or two-phone gameplay. Local PostgreSQL is unavailable; real durability/crash tests run against the already-approved ephemeral PostgreSQL 18.6 CI service with its pinned image digest.

## Environment and remaining acceptance gates

Read-only local inventory: no configured server/mobile `.env`, database/Supabase/API credentials or AWS credential environment variables; no local PostgreSQL/Docker/provider CLI/tunnel executable on PATH. Android SDK exists. Xcode Command Line Tools exist, full Xcode does not. Built-in `afconvert` 2.0 is available for later authorized offline validation. This is not evidence that external accounts or remotely hosted resources do not exist.

Owner setup and exact commands are in [the physical-pair protocol](M1_INCREMENT_04_DEVICE_EVIDENCE.md). Required: existing authorized Supabase with two users, private session-capable PostgreSQL, a reachable TLS/WebSocket backend, reviewed private assets and the two phones. The app's Expo QR alone does not establish backend connectivity.

Audio generation remains separately unauthorized: eight Joanna Neural/en-US/24-kHz clips, 29 characters, estimated synthesis US$0.000464 at the [published US$16/million Neural rate](https://aws.amazon.com/polly/pricing/); proposed synthesis-only cap US$0.01. No infrastructure price is invented: choose/approve an existing host or obtain a provider-specific quote before provisioning.

All physical checks, screenshots, pronunciation/listening, actual ≤150 ms acoustic skew including uncertainty, native reconnect/failure scenarios, and VoiceOver/TalkBack/large-text regressions are **pending**. Keep Gboard predictions documented as the accepted M0 limitation and unresolved M1 competitive-input requirement. The current native keyboard is not claimed competitively assistance-free.

**Recommendation:** review application implementation after exact-head CI passes. Do not declare Increment 04 accepted or a production release ready until the physical evidence table is completed and material failures are fixed. Do not merge automatically or begin the next increment.

The first CI database run passed 107/108: the new slow-COMMIT test advanced time before confirming the second socket message had reached the server. Its fix waits for the existing post-admission hook and asserts the trusted receipt precedes typing; it does not relax the gameplay outcome assertion. The corrected real-database run passes 108/108. Supabase response compatibility was checked against the [upstream token response](https://github.com/supabase/auth/blob/master/internal/tokens/service.go); only consumed fields are retained.
