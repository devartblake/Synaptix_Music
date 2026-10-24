# Publication Rules v1: Provenance, Licensing and AI Marking

**Status (2026-10-24):** Phases 1 and 2 are built. Phase 3 is partly built: the melody check is calibrated but not enforced, and the disclosure text and credits are in the studio. Phase 4 waits for an AI audio model. Decisions marked **Agreed** were settled on 2026-10-10 or later; items marked **To discuss** are still open. Production still needs the watermark service switched on and a trusted C2PA certificate.

**Not legal advice.** The owner's lawyer reviews this before launch, in particular Stable Audio 3.0's licence text and the final wording of the EU deadline change.

## Goal

Every piece of music published from Synaptix Music to SynaptixPlay can answer three questions, automatically and truthfully:

1. **Where did it come from?** Which generator and model, which version and licence, which prompt or plan, and how much a person changed it.
2. **May we ship it?** It came from a model cleared for commercial use, and it doesn't copy a known melody.
3. **Does it say what it is?** Exported audio carries machine-readable "made with AI" marks, and game makers get disclosure text they can paste into a store page.

The rules are enforced by code at publish time. Policy written in a document alone doesn't count.

## Where things stood (2026-10-10)

| Area | Today |
| --- | --- |
| Composers | Claude writes an arrangement plan, and the generation API turns it into notes. Any failure, a rate limit included, falls back to the procedural composer, with a warning on the proposal (`services/generation-api/app/generation/composers.py`). A local Ollama composer exists (`SYNAPTIX_COMPOSER=local`, default model `qwen2.5:7b`). |
| Provenance | `generationMetadata` records the generator, its version, the seed, the prompt and an arrangement fingerprint. The project's origin (Generated, Edited or Hand-composed) is computed from that fingerprint. Nothing records the model's licence or how much was edited, and the published package carries none of it. |
| AI audio | `services/audio-generation` runs MusicGen, whose weights are CC-BY-NC 4.0 (non-commercial). Its responses carry `X-Synaptix-License: CC-BY-NC-4.0`, and the UI labels it as a prototype. Nothing stops its output from being published. |
| Marking and disclosure | None. |

## Decisions

| # | Rule | Decision |
| --- | --- | --- |
| 1 | Provenance record on every asset | **Agreed.** Stored in **both** the project and the published package, so the two always agree. |
| 2 | Commercial-licence gate | **Agreed.** A **hard block**, with an **admin override**. MusicGen is for demos only and is removed entirely before the full release. |
| 3 | AI marking on exported audio | **Agreed.** C2PA plus a metadata tag on every export, by 2 December 2026. **Every export with any AI involvement also gets a watermark, now** (agreed 2026-10-10: not only 100% AI-made audio, so part-generated music is never left unmarked). |
| 4 | Prompt and output checks | **Agreed:** no lyrics, ever. A melody match is a **complete block**: the music isn't published or played, and the user sees a warning. **To discuss:** which reference set (research below). |
| 5 | Disclosure text for game makers | **To discuss.** What it means for this platform is explained below. |
| 6 | Credits that travel with the asset | **Agreed in principle.** Carried in the provenance record. The actual credit text is decided when an AI audio model is adopted. |
| 7 | Revenue watch | **To discuss.** It's a business process, and the owner doesn't expect to approach the thresholds. |
| L1 | Main composer | **Agreed.** Claude, with a paid API key in production. |
| L2 | Fallback | **Agreed.** The procedural composer, used when Claude fails or is rate-limited. This already works. |
| L3 | Local model | **To discuss.** Qwen3-8B (Apache 2.0) is the candidate. How it would plug in is below. |
| L4 | AI-generated audio | **Agreed.** Not offered yet. It sits behind a server-side lock. Stable Audio 3.0 is the preferred model when it is offered, with the "Powered by Stability AI" credit, subject to the lawyer's review. |

## Phase 1: provenance record and licence gate

**Why first:** this blocks a bad release today, and every later rule reads the provenance record.

### Provenance record (decision 1)

- **Where it lives in the project:** an optional `provenance` object on `generationMetadata`, in every schema (Zod v1 and v2, both JSON Schemas, both Pydantic models). It is absent on older projects, so their checksums don't change.
- **Where it lives in the package:** the publish request and the package manifest carry the same record, and the platform stores it with the version.
- **Fields:**
  - `generator`: `synaptix-claude-composer`, `synaptix-procedural-composer`, `synaptix-local-composer` or an audio model.
  - `model` and `modelVersion`: the model that actually ran, for example `claude-…` or `qwen3:8b`. For the procedural composer, its version.
  - `licence`: an SPDX identifier or a named licence, for example `Anthropic-Commercial-Terms`, `Apache-2.0`, `CC-BY-NC-4.0` or `none` (procedural).
  - `commercialUse`: `allowed`, `not-allowed` or `conditional` (for example, Stability's revenue threshold). The generation API fills this in from a reviewed table, never from what the model says about itself.
  - `planSha256`: a hash of the prompt and the plan, so the exact input can be proven later without storing the prompt in the package.
  - `generatedAt`.
  - `editShare`: how much of the music a person changed, from 0 to 1. See the open question below.
  - `similarityCheck`: the result of the melody check (Phase 3), with the reference set's version.
  - `credits`: required credit lines, for example "Powered by Stability AI". Empty for Claude and the procedural composer.
- **Hand-composed projects** carry no generator. Their record says "hand-composed", which is itself useful evidence of authorship.

**How `editShare` is measured (Agreed 2026-10-10).** The fingerprint we keep today tells us *whether* the music changed, not how much. So `generationMetadata` also keeps, per clip, the IDs of the generated notes and a short hash of each note's pitch, timing and velocity.

- `editShare` = (generated notes removed or changed + notes added) ÷ (generated notes + notes added).
- This was chosen over keeping a copy of the whole generated arrangement: it's cheaper (a few KB per project) and exact.
- Applying a generated arrangement records it. Undoing the apply removes it.

### Phase 1 progress

- **1a, done (2026-10-19): the provenance record in the project.**
  - **Generation API:** every proposal's provenance gets `licence`, `commercialUse`, `planSha256` and `credits` from a reviewed table (`app/generation/licensing.py`), never from the model. Unknown generators and local models whose exact tag wasn't reviewed fail closed (`unreviewed`, `not-allowed`). The procedural fallback carries the procedural composer's licence, not the failed composer's.
  - **Project schema:** `generationMetadata.provenance` and `generationMetadata.generatedNotes`, optional, in Zod v1 and v2, both JSON Schemas and both Pydantic models.
  - **Studio:** applying a generated arrangement records both; undo removes them. `editShare(project)` measures how much a person changed. Proposals from an older API record no provenance, which publishing will treat as unlicensed.
  - **Not stored:** `editShare` itself (computed at publish, since every edit changes it), `generatedAt` (it is `generationMetadata.createdAt`) and the generator (it is `generatorId`).
- **1b, done (2026-10-19): the package carries the record, and the studio checks first.**
  - **Record:** `PackageProvenanceSchema` and `packageProvenance(project)` (project-model): origin, generator and version, `generatedAt`, the licence facts and `editShare`, computed when the manifest is built.
  - **Manifest:** an optional `provenance` on the adaptive package manifest. It travels inside the publish request, so the request and the manifest can't disagree. The platform and the game read manifests field by field, so the extra field is safe before 1c lands.
  - **Only for the current revision:** the record describes the project as it stands, so it is attached only when the package's renders are of the current revision. For older renders the studio asks for a render of the current revision.
  - **Studio check:** `licenceRefusal(record)` is the rule: hand-composed music passes; generated or edited music needs a licence record that isn't `not-allowed`; no record means no publish. The publish panel shows the reason and disables Publish.
  - **Trust:** the platform must not rely on the studio's record. 1c recomputes it from the platform's stored copy of the revision and enforces the gate on that.
- **1c, done (2026-10-19, backend):** the platform derives the record from its own stored revision, stores it with each version and enforces the gate (422 `LicenceRefused`; 409 `ProvenanceMismatch` when the manifest claims otherwise). An admin can override one refused draft version with a reason, recorded as an audit event.
- **1d, done (2026-10-19): the server-side lock on AI audio.** The audio service, the studio's side and the platform's grant endpoint are built.
  - **Grant:** the platform signs `v1.<account>.<expires>.<hmac>` (HMAC-SHA256 over the first three parts, a few minutes' life) for an entitled account. The studio's server fetches one per request with `POST /api/v1/music/ai-audio/grants` (answering `{ token, expiresAt }`, or 403 `AiAudioNotEntitled`) and forwards it as `X-Synaptix-Audio-Grant`.
  - **Service:** every `/audio` route checks the grant against `SYNAPTIX_AUDIO_GRANT_SECRET` (`app/entitlement.py`); health checks stay open. With no secret it refuses everyone. `SYNAPTIX_AUDIO_LOCK=off` opens it for local demos.
  - **Studio:** the **Prototype audio** panel shows only when the platform grants this account access. Signed-out callers and refused accounts get 403 without the service being called; a platform that can't answer gets 502, never an open service.
  - **Platform:** the grant endpoint, with entitlement as a feature flag (`Music:AiAudio:Enabled`) plus a per-account allow-list, signed with `Music:AiAudio:GrantSecret`.

### Licence gate (decision 2)

- **The rule:** publishing refuses any version where an asset's provenance says `commercialUse: not-allowed`, or where provenance is missing on generated material.
  - The rule is enforced in the platform's publish endpoint (`AdaptivePackagePublicationEndpoints`), because the platform is the source of truth.
  - The studio checks the same rule first, so the person sees why before uploading.
- **Admin override:** a platform admin role can override a refusal for one version.
  - It needs a written reason.
  - The override is recorded in the package's audit events (`AdaptiveArtifactLifecycleEndpoints` already has an audit trail) and stamped on the version.
- **MusicGen:** it already reports `CC-BY-NC-4.0`, so it is blocked by data rather than by a special case. When it is removed before the full release, the gate needs no change.

### Server-side lock on AI audio (decision L4)

- **What blocks it:** the audio generation service only answers when the platform says the caller is entitled. Entitlement means a server-side feature flag plus a per-account permission.
- **Where it's checked:** the BFF route checks it, and so does the service itself, so hiding a button is never the only barrier.
- **Production:** the service isn't deployed. Local and demo environments keep it, still labelled as a prototype and blocked from publishing by the licence gate.

## Phase 2: AI marking on exported audio (decision 3; EU deadline 2 December 2026)

**Progress (2026-10-19):**
- **Watermark built.** AudioSeal runs in the backend's `Synaptix.Watermark` service (TycoonTycoon_Backend; MIT code and weights, CPU, internal only). The render worker sends each master and stem WAV of a project with AI involvement to the backend's `/internal/music/watermark` before transcoding, so every format carries the mark. The backend sets the 16-bit message (`5358`, "SX" v1). Hand-composed projects and plug-in freezes aren't marked. A watermark failure fails the render. In a robustness check on a synthetic clip, the mark sat 32.7 dB below the music and was detected after MP3 192/128/96k and OGG 160/96k (p ≥ 0.993; unmarked 0.269). On three real renders it was detected in every format (p ≥ 0.997; unmarked ≤ 0.22); the 16-bit message is best effort (see the service README).
- **C2PA built.** The backend's watermark service signs with `c2pa-python` (ES256). The render worker sends each WAV and MP3 deliverable, last, to `/internal/music/projects/{id}/revisions/{rev}/content-credentials`, and the backend states the provenance from its stored revision (the licence gate's reader) with an IPTC digital source type: generated, composite (edited) or human. Tampering with the audio fails verification (`assertion.dataHash.mismatch`).
  - **Signing certificate:** self-signed for now (`Synaptix.Watermark/scripts/staging-c2pa-cert.sh`); validators show the signer as untrusted. DigiCert and SSL.com are being asked for a trusted claim-signing certificate.
  - **OGG (Agreed 2026-10-19):** the C2PA SDK can't bind to OGG at all, so a sidecar isn't possible either. Music with AI involvement isn't offered or delivered as OGG: the studio's Export menu leaves it out and the render worker refuses an OGG request, previews included. Hand-composed music can still be exported as OGG.
  - **More signable formats (Agreed and built 2026-10-19):** AAC in M4A (default 192 kbps), Opus in an MP4 container (`.mp4`, default 128 kbps) and FLAC. They were checked with the C2PA SDK, the watermark and a real render: each signs and verifies, detects tampering, and keeps the watermark (detection p ≥ 0.995 at AAC 128k and Opus 96k). AAC/M4A is the lossy replacement for OGG; FLAC is the lossless compressed option. Music with AI involvement can be exported as WAV, MP3, M4A, Opus or FLAC.
- **Watermark container checked (2026-10-24, TycoonTycoon_Backend #609, in review).** The backend's `docker/Dockerfile.watermark` image was run offline (`--network none`) with production-style mounted signing files. That found two faults:
  - `/watermark` returned 500 because AudioSeal calls `torch.compile`, which needs a C++ compiler the slim image doesn't have. The service and the image now set `TORCHDYNAMO_DISABLE=1`.
  - Signing returned 415 because `staging-c2pa-cert.sh` writes `signer.p8` readable by root only, while the container runs as uid 1000. An unreadable key or chain is now a 503 that names the file; the script prints the `chown`, and the production deploy refuses to continue when uid 1000 can't read the key.
  - After the fixes, in the container: watermarking takes 3.0 s for 4 s of audio and 4.7 s for 30 s of 24-bit 48 kHz audio; the mark is detected (0.985) and the original isn't (0.002); C2PA signs and verifies as Valid with both assertions; the mark survives signing; about 420 MiB of memory.
- **Metadata tags built.** Projects with AI involvement get `AI_GENERATED`, `AI_GENERATOR`, `AI_MODEL` and `AI_LICENSE` as ID3 TXXX frames (MP3), Vorbis comments (OGG) and a LIST/INFO comment (WAV). They are written before signing, so the signature covers them.

- **C2PA manifest on every export.** Signed content credentials that state AI involvement, generator, model, licence and `editShare`, written with the open-source C2PA SDK (`c2pa-rs` / `c2patool`).
  - The renderer already writes WAV, MP3 and OGG files. The manifest is embedded where the format supports it and written as a sidecar `.c2pa` file otherwise.
  - Signing needs a certificate; the KMS work in the backend (`Synaptix.Security.Kms`) is the natural home for the key.
- **Metadata tag on every export.** For example an ID3 `TXXX:AI_GENERATED` frame in MP3, a Vorbis comment in OGG, and an INFO chunk in WAV. Players and tools that don't read C2PA still see it.
- **Watermark on audio with any AI involvement, now.** This means anything whose origin is Generated or Edited.
  - It is an inaudible watermark that survives re-encoding.
  - The candidate is **AudioSeal** (Meta, published under the MIT licence; verify the licence before use).
  - The EU's July 2026 Code of Practice expects at least two techniques. Signed metadata plus a watermark satisfies that.
- **Watermark scope (Agreed 2026-10-10):** every export with any AI involvement gets the watermark, edited or not. The C2PA manifest carries the nuance (how much was edited). Hand-composed projects get the C2PA manifest saying so, and no watermark.
- **Tests:** round-trip each format (embed, re-read, verify the signature), check the watermark is still detected after MP3 and OGG re-encoding, and check that a tampered file fails verification.

## Phase 3: melody check and disclosure text

### Melody check (decision 4)

**Why a reference set of popular songs matters most:**
- Melody infringement turns on *access* plus *substantial similarity* of protectable expression, which means a distinctive sequence of pitch and rhythm (a hook).
- Common chord progressions are not protectable (*Structured Asset Sales v. Sheeran*, 2d Cir. 2024).
- Popular songs are where access is easy to argue, so they carry nearly all the risk.

**Reference sets that fit:**

| Set | Contents | Licence for our use | Fit |
| --- | --- | --- | --- |
| Lakh MIDI, matched subset | 45,129 MIDI files matched to real songs (176,581 files in the full set); mostly Western pop and rock | Dataset is CC-BY 4.0; the songs in it are still copyrighted. We would use it for internal screening only, never redistribution | **Best free coverage of pop hooks.** Noisy: the melody track has to be picked out by heuristics, and there are duplicates. Ask the lawyer to confirm internal screening use. |
| POP909 | 909 pop songs with clean melody tracks | MIT (the songs are still copyrighted) | Small. A good test set for tuning the matcher. |
| Essen folk collection | About 8,500 public-domain folk tunes | Open access | A "known safe" baseline that keeps the matcher from flagging common folk phrases. Not a block list. |
| MetaMIDI | 436,631 MIDI files | Research use only | Not usable commercially without an agreement with its makers. |
| Hooktheory (TheoryTab) | Melodies and chords of famous song sections | No data licence offered | Ideal content, if a licence can be negotiated later. |

**The check, in two layers:**

1. **Symbolic check at publish (build now).**
   - Pull the melody line out of every generated clip.
   - Index the reference set as interval-and-rhythm n-grams that don't depend on key (5–8 notes), weighted by how rare each phrase is.
   - Confirm candidate matches with a local alignment.
   - Starting threshold: **8 or more consecutive matching notes** (interval and rhythm), or a high rarity-weighted score, against a copyrighted song means a **block**. Matches only against public-domain tunes are logged, not blocked.
   - Calibrate the thresholds on POP909 and known infringement cases before switching the block on.
   - This runs in the generation API, which already turns plans into notes, so a generated variation is checked *before* it is offered. It runs again at publish, so hand edits are covered too.
2. **Audio check at export (later).**
   - Run rendered audio through a commercial service that matches compositions rather than only recordings: ACRCloud's cover-song identification (the most accessible; prices on request) or Pex's melody matching.
   - This catches arrangement-level similarity that the symbolic check misses.
   - It matters because content-ID systems on YouTube and Twitch will scan streams of the game.

**Progress: the symbolic check is built in the generation API (`app/similarity/`), calibrated on POP909, and not yet enforced.**
- **Matcher:**
  - It takes the top line of each pitched clip.
  - Tokens are (interval, onset-gap ratio), so a match ignores key and tempo and survives doubled or halved note values.
  - Exact runs are found from rarity-weighted 4-token seeds.
  - Runs against the same song that are a changed or added note apart are joined into one match.
- **Rule, changed by calibration (2026-10-24):** a block needs a match of at least 8 notes carrying at least 56 bits of information.
  - "Information" is how rare each interval-and-rhythm step is across the reference set.
  - A run also found in a public-domain reference is only logged.
  - The original rule, 8 consecutive notes, flagged 81.7% of unrelated POP909 songs and every generated arrangement. The shared runs were repeated notes, scale steps and bass patterns.
  - `SYNAPTIX_MELODY_BLOCK_BITS` overrides the threshold. It must be recalibrated for the real reference set, because bits are relative to the set's own phrases and POP909 is Chinese pop.
- **Calibration** (`scripts/calibrate_melody_check.py`, POP909, 909 songs; share caught at 56 bits):

  | Case | Caught |
  | --- | --- |
  | Unrelated songs (false positives) | 2.5% (about 1.6% without POP909's duplicate songs) |
  | Exact or transposed copy, 12 notes | 62% |
  | Exact or transposed copy, 16 notes | 99.7% |
  | 16-note copy with one changed note | 80% |
  | 16-note copy with one added note | 54% |
  | Alternative transcriptions of the same song | 99.7% |
  | Generated arrangements (150) | 0% (highest 46.5 bits) |

  An 8-note copy almost never blocks now: an 8-note figure rarely carries enough information to tell a copied hook from a common one. That trade-off is for the lawyer to confirm.
- **Melody extraction for the index:** the builder prefers a part named melody, vocal or lead, and otherwise takes the most monophonic part. With track names hidden, that found POP909's labelled melody in 85% of songs; "the highest part" found it in 40%.
- **Generation API:** every proposal carries `similarityCheck` (`clear`, `blocked` or `unchecked`), with findings by track, clip and bars, never naming the song. It reads `unchecked` until `SYNAPTIX_MELODY_INDEX` points at an index built with `scripts/build_melody_index.py`.
- **Still to do:**
  - Choose and build the reference set (the lawyer needs to sign off on Lakh MIDI), then recalibrate on it.
  - Act on a block: regenerate or warn in the studio, block preview and publish, and run the check again at publish over the edited project.
  - Store the result in the package record.

**What a block does (Agreed):**
- The version can't be published, and the matched clip can't be previewed.
- The person sees a warning naming the clip and bars, but not the matched song, so the warning doesn't become a lookup service. It suggests regenerating or editing those bars.
- The result is stored in `similarityCheck`.

**To discuss:**
- Whether the lawyer is comfortable with Lakh MIDI for internal screening.
- Whether to budget for an audio-matching service, and when.

### Disclosure text for game makers (decision 5)

**What Steam asks:** developers fill in a Content Survey that has two AI categories.
- **Pre-generated:** made with AI tools during development and shipped with the game. Steam treats it like any other content.
- **Live-generated:** created by AI while the game runs. The developer must also describe the guardrails against illegal content.
- Since January 2026 the survey only covers content players experience directly. Coding assistants and pipeline tools are out of scope.
- Disclosures appear on the store page.

**What it means here:**
- SynaptixPlay music is **pre-generated**: it's composed in the studio and shipped as a package.
- Mixing between existing layers and changing intensity during play creates nothing new, so it's still pre-generated, and no guardrail statement is needed.
- If a future game generated music while running, it would move to live-generated and need written guardrails.
- The trivia game is a SynaptixPlay title, so "the game maker" is SynaptixPlay itself for now. The same text serves third-party games later.

**Proposal:**
- The package's publication page offers disclosure text generated from the provenance record: a long form for Steam and a one-liner for other stores.
- Example of the long form:

  > *The music in this game was composed with Synaptix Music, which uses Anthropic's Claude to plan arrangements alongside a non-AI procedural composer. The music is note-based and was rendered to audio before release; about 35% of the notes were edited by hand. No lyrics or voice cloning were used, and every track was screened for melodic similarity to known songs. No music is generated while the game runs.*

**Other stores:**
- **itch.io** requires AI disclosure on asset pages. We should tag SynaptixPlay music packages if they are ever listed there.
- **Google Play** only has rules for apps that *generate* content at runtime, so they don't apply.
- **Epic** shows no AI labels.

**Built (2026-10-24):** `disclosureText(record, { screened })` in project-model writes the long form, the one-liner and the Steam category from the provenance record. The publication panel shows them with copy buttons once the licence check passes.
- **Wording:** the procedural composer is described as rule-based, with no machine-learning model. Hand-composed music reads "composed by hand, without AI" and needs no Steam category.
- **Screening:** the text claims melody screening only when the music passed the check. The package record doesn't hold a check result yet, so the studio doesn't claim it today.

**To discuss:** whether SynaptixPlay's own store should show this disclosure for its games, the way Steam does.

### Credits (decision 6)

`credits` in the provenance record are copied into the package manifest and shown on the package's publication page.
- Claude and the procedural composer need none.
- Stable Audio would add "Powered by Stability AI".
- A CC-BY model would add its attribution.

**Built (2026-10-24):** the credits travel in the package manifest's provenance record, and the publication panel shows them under "Credits required by the model's licence" when there are any.

## Phase 4: revenue watch (decision 7)

**This is a business process with one small piece of code.** The thresholds that matter:
- Stability's Community Licence is free under US$1M in yearly revenue; above that an Enterprise licence (which includes indemnity) is needed.
- ElevenLabs' plans below Enterprise exclude game use; it isn't planned anyway.

**Proposal:**
- **Owner:** the project owner checks the thresholds once a year, or when pricing changes.
- **Code:** the platform's admin report lists, for each licence that has a threshold, the packages that use it and the store revenue they brought in.
- With no AI audio model in use, this phase can wait until one is adopted.

## Licensing and composers

- **Claude (Agreed):** move production to a paid API key. Under Anthropic's Commercial Terms the customer owns the outputs, and paid use comes with an IP indemnity.
- **Fallback (Agreed, already built):** the procedural composer is used when Claude fails, rate limits included.
- **Local model (to discuss):** how Qwen3-8B would plug in.
  - The generation API already has a local composer that talks to an Ollama server: `SYNAPTIX_COMPOSER=local`, `SYNAPTIX_LOCAL_MODEL` and `SYNAPTIX_LOCAL_MODEL_URL`. The local Docker Compose file runs Ollama.
  - Moving from qwen2.5:7b to Qwen3-8B means pulling the model in Ollama (`ollama pull qwen3:8b`) and setting `SYNAPTIX_LOCAL_MODEL=qwen3:8b`. There's no code change.
  - The real costs are hosting and quality:
    - **Hosting:** it needs a GPU with about 8 GB of memory for reasonable speed, or a paid GPU host.
    - **Quality:** small models write weaker plans, so validation and the procedural fallback stay in place.
  - Worth it only for offline use or to cut API costs at volume.
  - **To decide:** whether to try it, and on what hardware.
- **AI audio (Agreed):** locked server-side until it's offered.
  - **Model:** Stable Audio 3.0 when it is offered, subject to the lawyer's review.
  - **Its conditions:** free under US$1M in yearly revenue, then an Enterprise licence with indemnity. Register with Stability, and credit "Powered by Stability AI".
  - **Before then:** MusicGen is removed before the full release.

## Work breakdown

| Phase | Studio repo | Backend repo |
| --- | --- | --- |
| 1 | Provenance schema fields; the generation API fills them in; `editShare` tracking; the studio's licence pre-check and refusal message; locking the audio service | Store the provenance with each version; the licence gate in publish; admin override with an audit event; the entitlement check for AI audio |
| 2 | C2PA and metadata tags in the render worker; watermark on generated audio; verification tests | Signing key in KMS; serve and verify credentials |
| 3 | Melody extraction and n-gram index (generation API); block and warning UI; disclosure text on the publication page | Store `similarityCheck`; refuse a failed check at publish |
| 4 | — | Admin licence and revenue report |

Each phase is one or two PRs per repo, with tests, docs and changelog.

## Open questions

1. ~~How to measure `editShare`~~: generated note IDs (agreed 2026-10-10).
2. ~~Watermark scope~~: everything with AI involvement (agreed 2026-10-10).
3. Is Lakh MIDI acceptable for internal screening? (For the lawyer.)
4. Budget and timing for an audio-matching service (ACRCloud or Pex).
5. Should SynaptixPlay's store show AI disclosures for its games?
6. Who owns the revenue watch, and is a yearly check enough?
7. Try Qwen3-8B locally, and on what hardware?
8. Who holds the admin role that can override the licence gate?

## Sources

- Steam Content Survey: https://partner.steamgames.com/doc/gettingstarted/contentsurvey
- EU AI Act Article 50 and the Code of Practice on AI-generated content: https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content
- Lakh MIDI: https://colinraffel.com/projects/lmd/
- POP909: https://github.com/music-x-lab/POP909-Dataset
- MetaMIDI: https://metacreation.net/metamidi-dataset/
- Essen and KernScores: https://kernscores.stanford.edu/help/data
- ACRCloud cover-song identification: https://acrcloud.com/cover-song-identification-awa/
- Pex Attribution Engine: https://pex.com/blog/building-attribution-engine-how-rd-fuels-our-groundbreaking-products/
- Müllensiefen and Pendzich, court decisions and melodic similarity: https://research.gold.ac.uk/id/eprint/5382
- *Structured Asset Sales v. Sheeran* (2d Cir. 2024): https://copyrightlately.com/ed-sheeran-wins-copyright-appeal-5-things-to-know/
- The earlier licensing research (Claude, Qwen, Stable Audio, MusicGen and others), shared on 2026-10-10.

## Revision

- 2026-10-10: first draft, from the owner's decisions and research on reference sets and store disclosure rules.
- 2026-10-10: agreed: `editShare` from generated note IDs; a watermark on every export with AI involvement.
- 2026-10-24: status brought up to date: phases 1 and 2 built, phase 3 partly built.
