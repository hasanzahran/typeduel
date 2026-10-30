# M1 content and audio preparation worksheet

Date: October 29, 2026. Status: preparation authorized during increment 02; candidates and workflow only. No candidate, source right, pronunciation, audio file, measured duration or native playback result is approved by this document. No audio generation, provider call or provisioning is performed or authorized here.

Sources: [PRD](PRD.md), [System Design](SYSTEM_DESIGN.md), [implementation plan](IMPLEMENTATION_PLAN.md), [increment 01 plan](M1_INCREMENT_01_PLAN.md) and [mobile integration handoff](M1_MOBILE_INTEGRATION.md). Follow the approved single consistent US-English voice and offline reviewed Amazon Polly asset direction. No live per-match TTS or founder recording substitution.

## 1. Inventory and first-match goal

The inspected increment 01 project source contains no reviewed playable word/audio catalog, audio assets or content provenance register. Its synthetic server fixtures are unit-test inputs; screenshots of audio UI are not recordings. No external asset inventory was supplied or verified.

Prepare eight distinct approved word/audio pairs for a restricted **General / Classic / Level 1** development match. Eight pairs support five normal rounds and up to three sudden-death rounds without repetition. If any candidate fails editorial, rights or audio review, replace it before admission; do not reduce the no-repeat gate or silently substitute another difficulty/category.

These candidate spellings belong to an editorial proposal, not a deployed catalog or public asset manifest. Do not import this document, answer mappings or editorial tooling into mobile/public contracts. The small development set is not a production secrecy or diversity claim.

## 2. Proposed eight-word editorial worksheet

The words were brainstormed for review, not extracted from a verified licensed dataset. Level 1 is provisional for every row. Every row requires an explicit search/review for confusing homophones, context-dependent readings, regional pronunciation/spelling and difficulty suitability. The observations below are review prompts, not findings that a word is unambiguous.

| Candidate | Proposed use | Individual listening/ambiguity checks | Rights/provenance | Editorial/voice review | Approved asset, duration, checksum |
| --- | --- | --- | --- | --- | --- |
| cat | General, Level 1 | Standalone pronunciation and clear final consonant; check unintended homophone ambiguity. | Pending | Pending | None; unmeasured; absent |
| dog | General, Level 1 | US-English vowel realization and intelligibility across target listeners; check regional variation. | Pending | Pending | None; unmeasured; absent |
| fish | General, Level 1 | Final sound clarity; assess whether unchanged singular/plural spelling causes instructional ambiguity. | Pending | Pending | None; unmeasured; absent |
| milk | General, Level 1 | Consonant cluster, vowel realization and possible regional syllable variation in the selected voice. | Pending | Pending | None; unmeasured; absent |
| desk | General, Level 1 | Final consonant cluster remains complete, audible and unclipped. | Pending | Pending | None; unmeasured; absent |
| hand | General, Level 1 | Final consonant remains audible in isolated playback; check reductions in the chosen voice. | Pending | Pending | None; unmeasured; absent |
| drum | General, Level 1 | Initial consonant cluster is intelligible, without an unintended added introductory sound. | Pending | Pending | None; unmeasured; absent |
| frog | General, Level 1 | Initial cluster and US-English vowel consistency; assess regional listener comprehension. | Pending | Pending | None; unmeasured; absent |

No named-category tag is approved by this table, even when a topic association appears obvious. General is the virtual pool of all eligible approved words. Do not infer accepted variants, pronunciation approval or rights clearance from familiarity with a word.

For each candidate record an editor's accept/reject/replace decision, rationale, reviewer and date. Ambiguous homophones or unresolved context-dependent pronunciations are excluded. Confirm canonical spelling and only explicitly approved variants; server normalization does not erase internal punctuation, spaces or accent differences. Every selected word must fit the shared 120-UTF-16-unit answer limit.

## 3. Required private records

Field names below are preparation templates, not frozen database schemas. Backend owns persistence/migrations; content owns the assigned editorial records. Use absent/null values for unperformed measurements rather than guessed numbers.

| Record | Fields to capture |
| --- | --- |
| Provenance and rights | `sourceName`, `sourceUrlOrReference`, `sourceVersion`, `retrievedAt`, `rightsBasis`, `licenseReference`, `attributionRequired`, `distributionRestrictions`, `reviewer`, `reviewedAt`, `decision`, supporting evidence reference. |
| Word editorial | Private `wordId`, canonical NFC spelling, approved variants, locale, difficulty, approved named-category memberships, provenance reference, homophone/context/regional notes, status, reviewer/date. |
| Generation configuration | Approved US-English voice identifier, engine, language, speech settings, SSML/lexicon configuration and version, configuration hash, tool version, authorized batch reference. These values are not selected or approved here. |
| Immutable asset | Private word/asset association, opaque public asset identity and version, random nonsemantic storage key, MP3 format, final byte length, SHA-256 of final bytes, measured decoded duration, measurement tool/version, processing notes, listening status, reviewer/date. |
| Device evidence | Exact asset version/checksum, build commit/runtime, device/OS, audio route, network conditions, actual playback start/end observations, decode/preload failures, listener feedback and disposition. |
| Coverage report | Category and level, unique approved words with approved current audio, pending/rejected/missing/regeneration counts, runtime eligibility and beta threshold result. |

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

| Gate | Requirement and practical limit |
| --- | --- |
| First restricted real match | Eight approved General/Classic/Level-1 pairs. Demonstrates one playable configuration, not Challenge or all five levels/categories. |
| Full M1 runtime coverage | Every enabled category/level and Challenge-reachable pool satisfies the approved minimum of eight eligible nonrepeating candidates. Classic can remain at any selected level; Challenge must be supported through Level 5. |
| Current beta content gate | At least 30 approved playable words per named category per level: four named categories × five levels × 30 = 600 approved category-level memberships. Shared tags can reuse one recording; General derives from all approved words. |

The tiny first-match set must be explicitly limited to a development configuration, with any required environment-only prototype override reviewed. It does not satisfy the stronger beta gate or authorize hiding promised categories from a finished release. Candidate coverage and actual approved-audio coverage must be reported separately.

Increment 03 supplies authenticated rooms/recovery and the bounded mobile consumer. Increment 04 combines approved audio with the minimum Game/Results bindings and a development-only harness for the first physical iPhone versus Android match. Full Home/Setup/lobby polish remains increment 05; no visual redesign is implied. Content review can proceed alongside backend work once the appropriate preparation/generation steps are authorized.

**Shared slow-database/late-start fairness gate:** verified clip duration does not establish on-time playback. Commit-before-publish delays can leave too little countdown lead, and device/network delays can make initial playback late. Mobile/backend must measure this with the reviewed clips and agree on a common preflight failure/reschedule-or-interrupt policy before playable acceptance. Do not compensate by extending one player's timer or awarding a winner from client-reported timestamps. No current synthetic fixture or document proves this gate.

## 7. Ownership, evidence and next step

Content owns only explicitly assigned private editorial/audio tools and manifests, proposed under `tools/word-editorial/` and `tools/word-audio/`. Backend owns database/catalog adapters, runtime coverage, secure selection and authorized delivery. Mobile owns decoding/playback and device measurements. Lead owns shared contracts, dependencies and integration. These paths are future assignments; this task creates no implementation.

Remaining blockers are actual provenance decisions, editor/listener availability, selected voice approval, authorized small-batch generation/delivery, measured asset metadata, native timing and coverage expansion. Early December remains a target; no date substitutes for evidence. Do not expand to a large batch before the small reviewed set and playback flow work.

This preparation performed no content licensing research, listening, audio measurement, provider call or native test. Next small step: review the eight candidates and complete actual provenance/editorial decisions; then seek the separately bounded generation approval with exact asset count and configuration. Keep rejected and pending entries visibly unapproved.
