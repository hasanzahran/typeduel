# M1 content and audio preparation worksheet

Date: October 30, 2026 (UTC). Status: Increment 03 documentary editorial preparation; eight proposed candidates and a bounded future generation request. No candidate, source right, pronunciation, audio file, measured duration or native playback result is approved by this document. No audio generation, provider call or provisioning is performed or authorized here.

Sources: [PRD](PRD.md), [System Design](SYSTEM_DESIGN.md), [implementation plan](IMPLEMENTATION_PLAN.md), [increment 01 plan](M1_INCREMENT_01_PLAN.md) and [mobile integration handoff](M1_MOBILE_INTEGRATION.md). Follow the approved single consistent US-English voice and offline reviewed Amazon Polly asset direction. No live per-match TTS or founder recording substitution.

## 1. Inventory and first-match goal

The inspected Increment 03 project source contains no reviewed playable word/audio catalog, MP3/WAV/M4A game assets or completed content provenance register. Its synthetic server fixtures are unit-test inputs; screenshots of audio UI are not recordings. No external asset inventory was supplied or verified.

Prepare eight distinct approved word/audio pairs for a restricted **General / Classic / Level 1** development match. Eight pairs support five normal rounds and up to three sudden-death rounds without repetition. If any candidate fails editorial, rights or audio review, replace it before admission; do not reduce the no-repeat gate or silently substitute another difficulty/category.

These candidate spellings belong to an editorial proposal, not a deployed catalog or public asset manifest. Do not import this document, answer mappings or editorial tooling into mobile/public contracts. The small development set is not a production secrecy or diversity claim.

## 2. Eight-word editorial decision register

Proposed set: **cat, dog, cup, milk, desk, hand, drum, frog**. All eight remain General / Classic / provisional Level 1. They originated in an agent brainstorm, not an imported dictionary dataset. The Content agent checked the linked primary Merriam-Webster text entries on October 30, 2026 (UTC); these references support spelling/pronunciation review and are not a source license, selected recording or exhaustive homophone clearance. No dictionary recordings were downloaded or heard. No dictionary definitions or example sentences are proposed as game content.

| Candidate / primary reference                           | Actual documentary finding and recommendation                                                                                                 | Remaining selected-voice / ambiguity check                                                                                                  | Owner/editorial decision      | Rights / voice / listening | Asset / duration / bytes / SHA-256      |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | -------------------------- | --------------------------------------- |
| [cat](https://www.merriam-webster.com/dictionary/cat)   | Ordinary animal noun and consistent base spelling; retain as a provisional candidate.                                                         | Check isolated vowel and final /t/; complete homophone/regional review of the selected rendition.                                           | Pending; reviewer/date absent | All pending                | None / unmeasured / unmeasured / absent |
| [dog](https://www.merriam-webster.com/dictionary/dog)   | Ordinary animal noun; entry lists two vowel realizations. Retain provisionally, without prescribing one regional listener's vowel.            | Confirm the single approved US voice is recognizable across target listeners and retains final /g/.                                         | Pending; reviewer/date absent | All pending                | None / unmeasured / unmeasured / absent |
| [cup](https://www.merriam-webster.com/dictionary/cup)   | Common drinking-vessel noun; entry provides one base pronunciation and the same spelling for the verb. Recommend as the replacement for fish. | Check isolated vowel and final /p/, complete regional/homophone review and confirm Level-1 suitability.                                     | Pending; reviewer/date absent | All pending                | None / unmeasured / unmeasured / absent |
| [milk](https://www.merriam-webster.com/dictionary/milk) | Common food/drink noun with one listed base pronunciation; retain provisionally.                                                              | Listen for vowel clarity, an intact final /lk/ cluster and any added syllable or clipped ending.                                            | Pending; reviewer/date absent | All pending                | None / unmeasured / unmeasured / absent |
| [desk](https://www.merriam-webster.com/dictionary/desk) | Common furniture noun with one listed pronunciation; retain provisionally.                                                                    | Ensure both sounds of the final /sk/ cluster survive trimming, compression and phone playback.                                              | Pending; reviewer/date absent | All pending                | None / unmeasured / unmeasured / absent |
| [hand](https://www.merriam-webster.com/dictionary/hand) | Ordinary body-part noun; base spelling remains the same in its verb use. Retain provisionally.                                                | Check vowel, nasal and final /d/ in isolated speech; do not accept a reduction that makes the intended spelling uncertain.                  | Pending; reviewer/date absent | All pending                | None / unmeasured / unmeasured / absent |
| [drum](https://www.merriam-webster.com/dictionary/drum) | Common instrument noun with one listed base pronunciation; retain provisionally.                                                              | Check initial /dr/ intelligibility, vowel and final /m/ without a prompt or extra syllable.                                                 | Pending; reviewer/date absent | All pending                | None / unmeasured / unmeasured / absent |
| [frog](https://www.merriam-webster.com/dictionary/frog) | Intended ordinary animal noun; entry lists two vowel realizations. Retain provisionally.                                                      | Check initial /fr/, selected US vowel and final /g/ across target listeners. Other senses do not by themselves create a spelling ambiguity. | Pending; reviewer/date absent | All pending                | None / unmeasured / unmeasured / absent |

**Fish replacement history:** the initial brainstorm included `fish`. The Content agent recommended excluding it because the dictionary lists the ordinary verb [phish](https://www.merriam-webster.com/dictionary/phish) with the same pronunciation. That is a concrete alternative spelling for an isolated spoken prompt and conflicts with the PRD's homophone exclusion. The approved Increment 03 plan records `cup` as the proposed replacement. Keep the rejected brainstorm row/history; neither this recommendation nor the plan grants owner approval to any recording.

The documentary findings above are intentionally narrower than a final accept decision. For each row, the human editor records accept/reject/replace, rationale, reviewer and date after the approved spelling, homophone, regional, family-friendly and difficulty checks. The source URLs do not prove that no other homophone exists. Common noun/verb senses with identical spelling do not by themselves require replacing a candidate.

No named-category tag or accepted variant is approved here. General is the virtual pool of all eligible approved words. Keep `approvedVariants` and `approvedCategoryMemberships` absent/pending until the editor explicitly decides them; an empty approved list must not be confused with an unfinished review. Store canonical NFC spelling privately. Server normalization does not erase internal punctuation, spaces or accent differences. All selected text must fit the shared 120-UTF-16-unit limit.

## 3. Required private records

Field names below are preparation templates, not frozen database schemas. Backend owns persistence/migrations; content owns the assigned editorial records. Use absent/null values for unperformed measurements rather than guessed numbers.

| Record                   | Fields to capture                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Provenance and rights    | `sourceName`, `sourceUrlOrReference`, `sourceVersion`, `retrievedAt`, `rightsBasis`, `licenseReference`, `attributionRequired`, `distributionRestrictions`, `reviewer`, `reviewedAt`, `decision`, supporting evidence reference.                                         |
| Word editorial           | Private `wordId`, canonical NFC spelling, approved variants, locale, difficulty, approved named-category memberships, provenance reference, homophone/context/regional notes, status, reviewer/date.                                                                     |
| Generation configuration | Approved US-English voice identifier, engine, language, speech settings, SSML/lexicon configuration and version, configuration hash, tool version, authorized batch reference. These values are not selected or approved here.                                           |
| Immutable asset          | Private word/asset association, opaque public asset identity and version, random nonsemantic storage key, MP3 format, final byte length, SHA-256 of final bytes, measured decoded duration, measurement tool/version, processing notes, listening status, reviewer/date. |
| Device evidence          | Exact asset version/checksum, build commit/runtime, device/OS, audio route, network conditions, actual playback start/end observations, decode/preload failures, listener feedback and disposition.                                                                      |
| Coverage report          | Category and level, unique approved words with approved current audio, pending/rejected/missing/regeneration counts, runtime eligibility and beta threshold result.                                                                                                      |

Document the actual source and applicable source/provider conditions before distribution; record any required attribution and restrictions. A source link alone is not an approval record. This worksheet makes no legal determination and contains no provider credentials or cost authorization.

## 4. Editorial and audio workflow

1. Review provenance, canonical spelling, variants, provisional level and proposed category memberships. Reject ambiguity and unsuitable vocabulary before spending on generation.
2. Choose and approve one consistent US-English voice/configuration through the authorized review process. A changed voice/accent requires renewed review; do not mix unreviewed versions in the initial set.
3. Obtain separate authorization for a bounded offline generation batch and any required delivery resources. Never call paid TTS from live gameplay or treat this document as permission to generate assets.
4. Validate nonempty MP3 output and successful decoding. Inspect leading/trailing silence, clipping and volume; perform any approved processing before final measurements and review.
5. Measure actual decoded duration using a recorded tool/version. Define and record the conversion to the integer `clipDurationMs` field without under-reporting playback length; do not estimate duration from spelling or compressed byte length. Hash the exact final bytes with SHA-256 and record byte length.
6. Inspect filenames, MP3 tags, object metadata and delivery response/error metadata for secret spelling, variants, generation text or private lookup identifiers. Use opaque nonsemantic public references.
7. A human listens to the exact final asset version and approves or rejects pronunciation, intelligibility, ambiguity, clipping, silence, volume and consistent voice. No machine-generated approval or implicit approval from successful synthesis.
8. Test the same immutable bytes on physical iPhone and Android with speakers and relevant headphones/Bluetooth routes. Record decode readiness and actual playback behavior; adjust reviewed assets or the common server margin only through the appropriate owner.
9. Approve the word metadata and exact audio version together, then calculate coverage. Backend selection admits only eligible approved combinations and persists the chosen immutable mapping before publication.

Regeneration or byte-changing processing creates a new asset version, duration/checksum and listening decision. Existing matches retain their selected version. Editing a category tag need not regenerate unchanged audio, but category membership still needs review. Review history must distinguish revoked assets from replacements.

## 5. Public/private boundary and validation

The public round descriptor may contain only the approved opaque asset reference/version, authorized access URL, measured duration and checksum of audio bytes, alongside public round identity/level/schedule. Private canonical text appears only in a closed-round result. Never expose variants, dictionary IDs, generation requests, spelling hashes, provider credentials or private manifest paths.

Both clients must receive the same approved version and integrity metadata. Validate access authorization/expiry and permitted URL scheme/host at the delivery boundary; UUID-shaped fields or schema-valid URLs alone do not prove privacy or authorization. Do not log signed URLs, raw guesses or secret answers. Checksum equality proves matching bytes, not correct pronunciation or rights clearance.

Before enabling the initial set, verify:

- Eight distinct normalized word identities, each with approved metadata and exact approved current audio; no duplicate disguised by casing/Unicode or overlapping tags.
- Correct category/level eligibility; no missing, disabled, revoked or partially generated asset admitted.
- Checksum/byte length/version mapping and actual decode success; no fabricated or stale duration.
- No secret metadata in the asset or delivery surface; no answer catalog or privileged material in public exports/mobile bundles.
- Human listening records and physical two-platform playback evidence identify the exact reviewed bytes.
- Server selection excludes every word previously used in the match, including sudden death; no fallback category or repetition on depletion.

## 6. Coverage gates and roadmap dependencies

| Gate                        | Requirement and practical limit                                                                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First restricted real match | Eight approved General/Classic/Level-1 pairs. Demonstrates one playable configuration, not Challenge or all five levels/categories.                                                                                                 |
| Full M1 runtime coverage    | Every enabled category/level and Challenge-reachable pool satisfies the approved minimum of eight eligible nonrepeating candidates. Classic can remain at any selected level; Challenge must be supported through Level 5.          |
| Current beta content gate   | At least 30 approved playable words per named category per level: four named categories × five levels × 30 = 600 approved category-level memberships. Shared tags can reuse one recording; General derives from all approved words. |

The tiny first-match set must be explicitly limited to a development configuration, with any required environment-only prototype override reviewed. It does not satisfy the stronger beta gate or authorize hiding promised categories from a finished release. Candidate coverage and actual approved-audio coverage must be reported separately.

Increment 03 supplies authenticated rooms/recovery and the bounded mobile consumer. Increment 04 combines approved audio with the minimum Game/Results bindings and a development-only harness for the first physical iPhone versus Android match. Full Home/Setup/lobby polish remains increment 05; no visual redesign is implied. Content review can proceed alongside backend work once the appropriate preparation/generation steps are authorized.

**Shared slow-database/late-start fairness gate:** verified clip duration does not establish on-time playback. Commit-before-publish delays can leave too little countdown lead, and device/network delays can make initial playback late. Mobile/backend must measure this with the reviewed clips and agree on a common preflight failure/reschedule-or-interrupt policy before playable acceptance. Do not compensate by extending one player's timer or awarding a winner from client-reported timestamps. No current synthetic fixture or document proves this gate.

## 7. Bounded eight-clip generation request — not authorized to run

The next reviewable generation request is exactly one isolated-word MP3 for each of the eight retained candidates, after their pending editorial/rights decisions and the single voice configuration are approved. This document performs no synthesis and authorizes no paid requests.

| Request field       | Required value / current status                                                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope               | Eight candidates above, one clip each; General / Classic / provisional Level 1 only. No extra words, alternate voices, large dataset or live per-match TTS.                                                                       |
| Input               | Private canonical word only. No definition, spelling recital, sentence or introductory prompt in the output. Any SSML/lexicon change is recorded and reviewed.                                                                    |
| Voice/configuration | One owner-approved US-English Polly voice following the approved Neural-engine direction; confirm supported region, locale, MP3 sample rate and speech settings. Exact IDs/configuration remain unselected; no invented approval. |
| Authorization       | Named approver/date, permitted account/region/environment, explicit maximum cost and maximum request count must be recorded before execution. No provider credentials in this document.                                           |
| Bounded run         | Proposed maximum eight synthesis requests, one per selected word, with no automatic paid retry. A failed or unsuitable clip remains pending; replacement/regeneration requests need their own bounded authorization.              |
| Output handling     | Private staging, random nonsemantic names, inspect/remove answer-bearing tags and metadata. Any permitted byte-changing processing precedes final measurement and listening. No upload/provisioning permission is implied.        |
| Measurement         | Actual successful decode, measured duration converted conservatively to integer clipDurationMs, final-byte count and final-byte SHA-256, with tool/version and transformation record. All values are currently absent.            |
| Listening           | Named human reviewer/date for each exact version, pronunciation/ambiguity/intelligibility/silence/clipping/volume decision. Approval cannot be inferred from successful synthesis or checksum equality.                           |
| Device evidence     | Identical final version/checksum on physical iPhone and Android; preflight/decode and playback observations recorded with device/OS/build/audio route. No device pass is claimed here.                                            |
| Eligibility         | Only word plus exact audio version approved together can be enabled. If fewer than eight pass, keep the restricted match unavailable rather than repeat, use an unreviewed fallback or expand scope silently.                     |

Before authorizing the run, fill the actual source/provider rights reference, restrictions/attribution decision, approved voice configuration, account/region, cost cap, request cap and reviewer availability. These are concrete missing fields, not guessed production facts. The ordinary-word brainstorm is distinct from the dictionary references used for review and from future provider output rights.

## 8. Ownership, evidence and next step

Content owns only explicitly assigned private editorial/audio tools and manifests, proposed under `tools/word-editorial/` and `tools/word-audio/`. Backend owns database/catalog adapters, runtime coverage, secure selection and authorized delivery. Mobile owns decoding/playback and device measurements. Lead owns shared contracts, dependencies and integration. These paths are future assignments. This Increment 03 task changes only `docs/M1_CONTENT_PREPARATION.md`; it creates no catalog, manifest, audio pipeline or application implementation.

Remaining blockers are actual provenance decisions, editor/listener availability, selected voice approval, authorized small-batch generation/delivery, measured asset metadata, native timing and coverage expansion. Early December remains a target; no date substitutes for evidence. Do not expand to a large batch before the small reviewed set and playback flow work.

Verification performed: inspected the repository for game MP3/WAV/M4A assets and catalog/manifest files; read the nine linked primary dictionary text entries; checked the eight-row worksheet against the approved PRD and Increment 03 plan; verified document formatting. No source/provider license determination, human listening, audio measurement, provider call, upload or native test was performed.

Next small step: the owner/editor completes the eight candidate decisions and provenance/rights fields, selects the single voice configuration and reviews the bounded eight-request proposal. In parallel, Backend prepares authorized opaque delivery/source eligibility and Mobile/QA prepare exact-version decoding and the common slow-database/late-start gate for Increment 04. Keep the first physical pair separate from full M1 reachability and the 600-membership beta target.

## Increment 04 implementation update — approval still pending

The bounded offline tool now lives at `tools/word-audio/`; see its README for exact request hash, account confirmation, private approval record and ledger behavior. Candidate and recording approvals in the table above remain pending. The proposed configuration is now concrete: Joanna / Neural / en-US / us-east-1 / MP3 / 24 kHz; eight attempts, 29 characters, estimated synthesis US$0.000464, proposed ceiling US$0.01. No request has been sent and no audio has been generated.

The owner approved application implementation, not this recording batch. Tool tests use synthetic bytes and fake approvals strictly inside temporary test directories. The private manifest compatibility fixture is not editorial evidence. Named owner/editorial, rights and exact-final-file listening decisions are still required. `afconvert`/PCM validation is implemented, but has not measured actual approved clips. Physical audio timing remains unverified.
