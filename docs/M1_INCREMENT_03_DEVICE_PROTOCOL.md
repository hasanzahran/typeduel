# Increment 04 two-device evidence protocol

Status: preparation only. No physical device, provider, native audio or competitive-keyboard result is certified by this document. Increment 03 real Socket.IO/PostgreSQL tests exercise transport and authority with private synthetic fixtures; they do not establish native playback fairness.

## Prerequisites

Record the approved server/database environment, exact server commit, mobile build identifier, immutable reviewed audio manifest, and test account identities using nonsecret labels. Confirm permission to use the environment. Never include access tokens, invite codes, signed audio URLs or connection strings in evidence.

Use one physical iPhone and one physical Android phone. Record model, OS, app/runtime version, keyboard, keyboard settings, accessibility settings, output route and network for each. A successful Expo export is not a substitute for this evidence. Audio generation, deployments, custom keyboard implementation and paid infrastructure need their separate approvals.

The eight clips require approved spelling/variants and pronunciation, exact immutable audio version, measured decoded duration, checksum, opaque asset path and a listening decision. Choose the shared late-start policy before executing gameplay acceptance: a slow commit or late decode must never create an individual extension or silently change the winner.

## Per-run evidence sheet

| Field                                         | Record |
| --------------------------------------------- | ------ |
| Run identifier and UTC date                   |        |
| Tester and device A/B details                 |        |
| Server commit; mobile build/commit            |        |
| Environment and approved account labels       |        |
| Mode, category and starting difficulty        |        |
| Audio manifest/version and output routes      |        |
| Networks and controlled impairment            |        |
| Screen recording/screenshot references        |        |
| Match ID and final stateVersion               |        |
| A/B displayed final scores; PostgreSQL scores |        |
| Result: passed, failed, blocked or not tested |        |
| Defect and exact reproduction steps           |        |

For each round record server playbackAt, typingStartAt and deadlineAt, both actual audible start/end observations, input-enabled state, replay use, result visibility and resulting scores. Record the observation method and uncertainty; do not infer millisecond precision from ordinary screen recordings. Match/round IDs and versions may correlate evidence without exposing private guesses or credentials.

## Required runs

1. Complete a five-round General/Classic/Level-1 match, then an eight-round draw. Both phones and PostgreSQL agree on all final scores and outcomes. Replay controls allow two additional plays; three counted attempts exhaust submission without granting a fourth.
2. Exercise Challenge progression against sufficiently reviewed source coverage. Record the level displayed on both phones after each winning and scoreless round. Do not substitute unreviewed words to claim coverage.
3. Compare first playback, typing unlock and remaining time on both phones under comparable connectivity, then controlled asymmetric delay and jitter. Scoring remains first valid server receipt. Device-reported time never adjusts a winner.
4. Delay preloading/decoding on one phone and delay the server commit. Both clients follow the approved common late-start policy. No player gets a private schedule or extension.
5. Lose an answer acknowledgement and a result update, reconnect, and verify canonical recovery without another point or attempt. Replace a session and confirm the old phone stops automatic reconnect and cannot submit.
6. Cut connectivity; record physical cut time separately from server-observed disconnect. Exercise reconnect just before and at/after server-observed 10,000 ms grace. Deadlines continue; expiry interrupts without a match winner. Do not claim a ten-second physical-outage guarantee.
7. Repeat interruptions during listening, typing and round feedback: background/foreground, screen lock, incoming audio interruption, wired route changes and Bluetooth. Check for duplicate playback, stale-round audio and unfair timer changes. Record all untested routes explicitly.
8. Test small screens and large accessibility text, VoiceOver/TalkBack focus and announcements, safe areas, keyboard overlap and visible submit/replay controls. Do not announce the secret word before round result. Retain existing approved visuals.
9. Check keyboard predictions, autocorrect, spellcheck and third-party keyboard behavior on both devices. Record unresolved assistance honestly. A custom keyboard is not authorized by this protocol.
10. Exercise server interruption and token expiry. Show unavailable/reconnecting/authentication states without falsely declaring victory. Completed results survive restart; unfinished matches become non-win interruptions.

## Acceptance and handoff

A run passes only when its observed evidence supports the stated claim. Retain failed runs and correlate them to defects; do not replace them with screenshots from a different build. Any inconsistent completed score, premature answer exposure, phantom win or individual timer extension blocks competitive acceptance.

Report automated transport evidence, actual provider verification and physical-device evidence separately. Missing devices, approved recordings or reachable permitted infrastructure remain explicit prerequisites. This worksheet does not authorize provisioning or Increment 04 implementation.
