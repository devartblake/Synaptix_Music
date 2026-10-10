# Changelog

## Unreleased

### Added

- **The DAW piano roll's Edit and Rename menus float.** They open above everything else, below their button or above it when there's more room there, so the dock's height no longer cuts them off or hides them under the Browser. They stay open while you edit, so you can press +1 repeatedly and watch the notes move. The Edit actions are laid out three across.
- **Renamable note labels (from FL Studio 2026).** Notes can carry a name, such as "Hook" or "Kick", that the DAW piano roll shows in place of the pitch.
  - **Editing:** select notes, open **Rename** next to **Labels**, type a name and press Enter. A blank name or **Clear label** removes it. Each rename is one undo step, and copy and paste keep the labels.
  - **Schema:** an optional `label` (1–32 characters) on MIDI notes in TypeScript/Zod, both JSON Schemas and both Python models. Projects without labels are unchanged, including their checksums.
- **The project key travels with the project.** Projects now store an optional key: a tonic pitch class and one of the generator's seven modes.
  - **Schema:** the field is in TypeScript/Zod, both JSON Schemas and both Python models. Projects without a key are unchanged, including their checksums.
  - **Editing:** choosing a key in the piano roll's **Scale** menu saves it to the project as an undoable edit, and **Auto** clears it and detects the key from the clip's notes. Hiding the shading (**Off**) stays a per-browser choice.
  - **Generator:** applying a generated arrangement sets the project key from the generator's chosen key; undo restores the previous key.
- **Browser and inspector in the DAW layout (Studio UI v2, step 7).** The Browser searches every instrument by name, description or family and groups them by family. Enter adds a track and Shift+Enter swaps the selected clip's track; dragging onto a track swaps it and dropping elsewhere adds one. Swapping is one undo step (`SwapInstrumentEditorCommand`). A Patterns tab adds an instrument's starter phrase as a new clip, and a Project tab lists the clips. The inspector shows the selected clip and its track. The classic layout is unchanged.
- **Mixer channel strips in the DAW dock (Studio UI v2, step 6).** The dock's Mixer tab shows one strip per track, then the Music, Drums and Reverb buses, then Master. A track strip has insert slots (choosing one opens the track in Devices), Pan and Send knobs, a vertical fader with a peak-and-RMS meter, mute/solo and its output route. Every change is one undo step. The classic layout's mixer drawer is unchanged.
- **Device chain in the DAW dock (Studio UI v2, step 5).** The dock's Devices tab shows one track's devices left to right, with a Track picker that follows the clip being edited.
  - **Devices:** Instrument (with its on/off switch), Filter, Envelope (with an ADSR drawing), Modulation (folded unless the preset uses it), Reverb send and plug-in inserts.
  - **Knobs:** drag up or down, or use the arrow keys, Page Up/Down or Home/End. Double-click resets a knob to the instrument's default. Each gesture is one undo step, and cutoff moves logarithmically. The classic Devices page is unchanged.
- **Piano roll tools in the DAW dock (Studio UI v2, step 4b).**
  - **Select / Draw:** in Draw, one click adds a note; **B** switches tools.
  - **Ghost:** shows another track's notes faintly behind the clip.
  - **Humanize:** nudges the selected notes' timing and velocity a little, as one undo step. It's seeded, so redo gives the same result (new `HumanizeMidiNotesCommand`).
  - **Labels:** writes each note's name on it.
- **Piano roll in the DAW dock (Studio UI v2, step 4a).**
  - **Keyboard and toolbar:** the keys look like a keyboard (black keys shorter, C rows labelled). The toolbar fits on one row: Preview, Grid, Snap, Scale, Chords, Quantize, an **Edit** menu (duplicate, transpose, copy, cut, paste, delete, stop sound) and compact zoom. The insert-note fields are gone, since drawing on the grid replaces them.
  - **Scale:** **Scale** shades the rows in the key. **Auto** detects the key from the clip's notes, and a chosen key is remembered per project in this browser.
  - **Chord Panel** (inspired by FL Studio 2026): **Chords** shows a lane naming the chords along the clip (for example C, Dm, Am7, C/E), and the selection readout names the chord of the selected notes.
  - Drum clips keep their drum names. The classic layout's piano roll is unchanged.
- **Section markers and a loop brace in the DAW layout (Studio UI v2, step 3b).** Two lanes above the ruler:
  - **Markers:** "+ Marker" adds a section marker at the playhead's bar and opens it for naming. Click a marker to jump to it, double-click or press F2 to rename it, and press Delete to remove it.
  - **Loop:** drag across bars to set the loop and turn it on, or press L to loop the bars the selected clip covers. × clears the loop. A saved loop that is switched off shows as a dashed brace.
  - **Undo:** each marker or loop change is one undo step (new `SetMarkersEditorCommand` and `SetLoopRegionEditorCommand`).
  - **Account:** the account control moved to the status bar so the transport bar stays on one row.
- **Coloured timeline in the DAW layout (Studio UI v2, step 3a).** Each track and its clips take their instrument family's colour, matching how the audio engine resolves the instrument. Each track header has a live level meter, and muted tracks are dimmed. The transport bar shows bar.beat and clock time. A new, empty project shows a "Start with an instrument" prompt that adds the instrument chosen in the Browser. The classic layout is unchanged.
- **DAW layout preview (Studio UI v2, step 2).** Turn it on from Layout → "DAW layout (preview)"; the classic layout stays the default. Its parts:
  - **Transport bar:** playback, position, tempo, undo/redo, an Arrange / Adaptive states switch (Alt+S), Generate, Export, the master meter and your account.
  - **Browser:** the instrument picker.
  - **Timeline and dock:** the timeline stays in view above a resizable, collapsible dock. The dock's tabs are Editor, Devices and Mixer (Alt+1/2/3, or arrow keys between tabs); editing a clip opens it in the dock instead of replacing the timeline.
  - **Inspector.**
  - **Status bar:** names the control under the pointer or focus, and shows save and sync state with Sync now.

  The layout choice, dock tab, height and open state are remembered. Reset layout keeps the layout choice, and phones keep the classic layout. Also fixed: the classic sidebar's letter glyphs ran into their labels ("AArrangement"). See [the plan](docs/plans/ui/studio-ui-v2.md).

- **The generator can use the new instruments.** Every instrument added since the original twelve is now offered for the roles it suits. Examples: Drum Kit for drums; 808, Acid, Wobble, Reese and Chip Triangle for bass; FM Marimba for arpeggios and sparkle; NES Pulse, Supersaw and Chiptune leads for melody. Composed plans can request them. Role defaults and the procedural ensemble are unchanged, so existing requests sound the same. Riser and Downsweep FX are left out because no role plays one-shot transitions. A test now fails if a playable catalog instrument isn't offered by any role.
- **NES Pulse** and **Chip Triangle** (slice 3, step 4, the NES pack): two new kernel oscillators. **pulse-12** is a band-limited 12.5% pulse, the thinnest NES duty, for a buzzy lead. **chip-triangle** is the NES triangle channel's 4-bit, 32-step staircase. It is deliberately not band-limited, because its steps are the sound, and suits basslines. Each has its own icon, both are in the generation API's instrument list, and existing instruments render byte-identical.
- **FM Marimba** and **FM Vibraphone** (slice 3, step 3): two new two-operator FM presets in the kernel (codes `fm-marimba` and `fm-vibraphone`), both at a 4:1 ratio like a tuned bar's first overtone. The marimba's brightness dies in tens of milliseconds, giving a woody knock. The vibraphone fades more gently and its preset adds a 5 Hz tremolo for the vibraphone's shimmer. Each has its own icon, both are in the generation API's instrument list, and existing instruments render byte-identical.
- **Riser FX** and **Downsweep FX** (slice 3, step 2): a build into the next section, and an impact or release after one, useful for the game's adaptive-music transitions. They use a new kernel oscillator, **noise**: white noise seeded from the note, independent on each side so it sounds wide. **Filter Envelope** now goes from −6 to +6 octaves: positive starts the cutoff above its setting and falls (Downsweep), negative starts below and rises (Riser). A new "fx" instrument family has its own colour and icon. Both are in the generation API's instrument list, and existing instruments render byte-identical.
- **Slice 3, settings-only instruments** (26 in all): **Wobble Bass** (resonant saw with an LFO on the cutoff, the dubstep wub), **Reese Bass** (low supersaw with a slowly drifting filter), **Ensemble Strings** (wide supersaw strings with gentle vibrato) and **Trance Pluck** (short supersaw stab with a snappy filter envelope). They combine existing kernel features, so they need no new synthesis code. Each has its own icon and is in the generation API's instrument list. Existing instruments render byte-identical.
- **Rust synthesis kernel: preview and export now sound the same** (#58, #59). Every instrument note is synthesized by `crates/dsp`, compiled to WebAssembly and embedded in `packages/dsp-kernel/src/kernel-wasm.ts`. It is a plain module with no JavaScript glue, so the same code runs in the render worker for exports and in an AudioWorklet for the studio preview.
  - **Preview matches export sample for sample.** It replaces the Tone.js synths and their 12 dB filter, so preview tone moved slightly towards the export. Checked by running the shipped worklet in 128-frame blocks against the export path, and in Chromium's audio thread.
  - **Saw and square waves are band-limited (PolyBLEP),** so exports of Bass Synth, Lead Synth, Pluck, Organ, String Ensemble and Brass Section changed on purpose: less harsh aliasing. Sine and triangle instruments render byte-identical to before.
  - **Deterministic on every platform:** only plain IEEE-754 arithmetic in a fixed order; sine, `2^x` and `tan` come from the kernel's own functions.
  - **Guard rails:**
    - a TypeScript reference test checks the kernel's arithmetic;
    - golden tests pin every instrument's stem, plus one hit of every Drum Kit drum;
    - CI rebuilds the embedded WebAssembly and fails if it differs.
  - **Faster renders:** dense project master 5.8× → 9.4× real time.
  - The unused wasm-bindgen gain stub is gone.
- **Ten new instruments, 22 in all** (#60–#62, #64–#66, #70). None of them changed an existing instrument's sound.
  - **Supersaw Lead** and **Unison Pad** (#60): seven band-limited saws detuned about ±19 cents, spread across the stereo field (#69).
  - **Plucked String** (#61): a Karplus–Strong string (guitar, harp and koto colours). Its noise is seeded from each note's id, so preview and every export pluck the same string.
  - **FM Bell** and **FM Electric Piano** (#62): two-operator FM whose brightness falls over the note.
  - **Drum Kit** (#64): kick, rim, snare, clap, closed and open hats, crash, ride and tuned toms. The note picks the drum from the General MIDI map. It sits alongside Drum Synth, which is unchanged.
  - **808 Bass** (#65): a long sine bass whose pitch drops onto the note, with soft saturation.
  - **Chiptune Lead** (#66): a band-limited 25% pulse, the retro game lead.
  - **Acid Bass** and **Motion Pad** (#70): presets for the new filter and modulation controls (below).
  - **Distinct icons** (#71): each new instrument has its own picker and device-panel icon (stacked saws, an acoustic guitar, a game controller and so on) in its family's colour.
- **Filter and modulation controls on every instrument** (#68, #70). All default to off, so existing projects render byte-identical.
  - **Resonance** (0–1): above 0, a 12 dB resonant low-pass at the Filter Frequency, up to about +20 dB and stable at full resonance. Going from 0 to just above it changes the slope from 6 dB to 12 dB per octave, which you can hear.
  - **LFO Rate**, routed to **Vibrato** (cents), **LFO to Cutoff** (octaves) and **Tremolo**.
  - **Filter Envelope** (octaves above the cutoff on each note) and **Filter Env Decay**.
  - **How it stays deterministic:** vibrato warps each oscillator's phase in closed form, and a moving cutoff updates every 16 samples on a grid from the note's start. That keeps preview blocks and exports identical, and keeps Motion Pad affordable.
- **Stereo voice path** (#69). Notes render in stereo in exports and the preview. Mono instruments write the same samples to both sides, and the supersaw instruments spread their saws.
  - The preview now pans instrument tracks with the export's equal-power law, in a stage after the inserts, because Tone's channel panner folded stereo to mono.
  - Checked in Chromium: both channels match the export on every sample.
- **Render engine version** (#58, #63, #69). Renders record which synthesis made them (`RENDER_ENGINE_VERSION` in `@synaptix/render-contracts`).
  - **History:** 1.1.0 is the Rust kernel with band-limited saw and square; 1.2.0 adds stereo voices.
  - **The worker owns the version:** it stamps its own version on artifact manifests, and turns away requests for another engine. A new submission gets `409 engine_version_mismatch` ("reload the studio"). A job already queued is retried, so an older worker can take it during a rolling deploy.
  - **Existing evidence stays valid:** renders, freezes and certified packages are checked against their own recorded checksums, never re-rendered.
  - **Deploy the studio and render worker together** when the version changes (runbook: `docs/operations/stage-12-deployment-certification.md`).
- **Drum editing** (#67).
  - Drum Kit tracks open in the step sequencer, with a lane for everything the kit plays.
  - A **Piano roll** button opens any drum track in the piano roll (for off-grid timing or notes without a lane), and **Steps** switches back.
  - On drum tracks the piano roll names rows and notes by drum, e.g. "Kick (C2)".
- **Instrument catalog roadmap** (#57, `docs/plans/implementation/instrument-catalog-roadmap-v1.md`): every instrument Synaptix Music could add, grouped by effort, with the DSP, CPU cost and dependencies of each. It also lists the rules every new instrument follows and tracks progress; slices 1 and 2 and the filter, modulation and stereo infrastructure are done.
- **Render profiling and speed-ups** (#54, #56).
  - **Profiling:** `npm run profile -w @synaptix/render-worker` times typical, dense and worst-case projects. Synthesis dominates; effects and encoding run 40–160× real time.
  - **WAV encoder:** no longer allocates per frame. Output is byte-identical and 2× faster at 24-bit.
  - **Synthesis loop:** made 1.5–1.9× faster in TypeScript before the Rust kernel replaced it.
  - **Results:** in `docs/development/dsp-profiling.md`, with each step's numbers and the revisit criteria.
- **Per-player render-job limit** (#55, operational hardening): a signed-in player may have at most `RENDER_MAX_ACTIVE_JOBS_PER_OWNER` (default 10, `0` = off) queued or running render jobs. A submission over the limit gets 429 `render_quota_exceeded`.
  - One dense stems render can hold a worker for minutes, so a single player could otherwise fill the queue.
  - Submissions are serialized per player, so concurrent requests can't overshoot.
  - Replaying an accepted request is never refused, and private callers aren't limited.
- Added an offline app shell (#49): a service worker precaches Home, Library and an offline page, saves Library and Studio pages for offline use, and never touches `/api/*`. The studio is installable (manifest and icon); the Library shows an offline banner and disables **Download for offline** without a connection. Turn the worker off with `NEXT_PUBLIC_SERVICE_WORKER=off`; `next dev` never registers it.
- Added studio handoff from the player (#49): "Open in Studio" and "Edit in Studio" pass the listening position (`?t=`), and the studio opens at that point, snapped to the beat.
- Changed prototype audio to queued jobs with live progress (#49): the MusicGen service runs jobs first-in first-out on one GPU worker (Redis when `REDIS_URL` is set), with `POST /audio/jobs`, status, a server-sent event stream, audio and cancel. The studio's panel shows the queue position, model loading and a progress bar, and resumes a job after a reload.
- Recorded the game's audio-engine update for Stage 13 certification: the adaptive-music runtime in trivia_tycoon now runs on flutter_soloud 5.1.6 and Flutter 3.47.7 (trivia_tycoon #408, #417, #418), with a minimum of iOS 15 / Android 7.0. A failed play now throws instead of playing silence, so a failed stem start falls back to the master mix. The certification runbook asks for builds from #418 on, since earlier evidence doesn't carry over.
- Recorded the SynaptixPlay backend side of Stage 13.6 and 13.7 (TycoonTycoon*Backend #571–#573, trivia_tycoon #399): the game's `adaptive_audio*\*` runtime events are now ingested as metrics with a dashboard, alerts and a runbook; a staging preflight script checks the music setup end to end; and the kill switch reaches sessions already playing.

- Added switchable arrangement composers to the generation API (`SYNAPTIX_COMPOSER=procedural|claude|local`). The Claude composer (default model `claude-opus-5`, structured output, adaptive thinking, server-side refusal fallbacks) writes a compact arrangement plan: per-section chords, 16-step drum and bass patterns, and melody phrases in scale degrees. The service renders it into in-key, in-bounds notes. The studio now sends the creative brief, and previews name the composer. Any AI failure falls back to the procedural composer with a plain-language warning. The backend dispatch timeout is configurable (`Music:DispatchTimeoutSeconds`, default 180 s).
- Added a piano-roll velocity lane: drag a note's bar (or the whole selection) or use arrow keys, with each change a single undo step.
- Added browser storage monitoring (usage on the home page, warnings when storage is nearly full, and plain-language errors when a save fails for lack of space) and a crash-recovery journal that offers unsaved edits back after a crash or closed tab.
- Added note copy, cut and paste in the piano roll (Ctrl/Cmd+C, X, V and toolbar buttons). Pasted notes land after the selection or at the playhead, as one undoable step, and can move between clips. Added **Stop sound** (panic) to the piano roll and drum sequencer, which also silences note previews.
- Added project export and import: each home project card exports a `.synaptix.json` file with a checksum, and **Find or create project → Import** opens a file as a new copy, refusing edited, damaged or unsupported files with an explanation.
- Added studio save safety: a Saved / Saving / Not saved indicator, a failed-save banner with **Retry save** that re-saves the same revision without replaying the edit, a leave-page warning while changes are unsaved, and single-writer tabs (a second tab on the same project is read-only until the first closes). Cloud uploads now name the last revision that actually saved as their parent.
- Added package developer guides (command-system, project-storage, daw-engine, render-contracts), sequence diagrams for sync, generation and render flows (`docs/architecture/flows.md`), and `CONTRIBUTING.md` requiring docs and changelog updates with each change.
- Added Stage 13 publication hardening: player-readable active versions, pending→active activation on finalization, superseded/revoked/expired retention, retention-checked delivery grants and downloads, owner revocation with automatic rollback, manifest-to-request evidence validation, and idempotency-conflict detection. Studio version history shows retention and offers revoke.
- Added the Flutter adaptive runtime slices: streamed checksum verification, age-limited cache, last-verified offline fallback with revocation purge, monotonic transport clock with boundary preload/cancellation/drift correction, voice-group-aligned stems with intensity gains and master fallback, tag-resolved states, stingers with bounded ducking and cooldowns, redacted telemetry forwarding, and a server kill switch/stems flag.
- Added an optional `clock` (tempo, meter, phrase length) to the adaptive manifest contract, taken from the project tempo map and used by game runtimes for beat/bar/phrase quantization; added reconnect-time package refresh that stops withdrawn packages and stages newer versions for the next load.
- Added adaptive playback underrun telemetry (stalls and lost voices, measured against the lifecycle-aware transport clock) and a studio Role control that authors stinger states for the seven gameplay cues, keeping them out of the default state and transition graph.
- Added the Stage 13 certification and rollout runbook (device matrix, functional checks, staged rollout, kill switch and rollback) and an admin Adaptive Audio diagnostics screen with live mixing, timing and health data plus an on-device 30-minute soak harness that reports pass/fail JSON evidence.
- Added the first Stage 13 Adaptive States authoring workspace with completed-render discovery, state/intensity controls, validated manifest preview, and an explicit fail-closed Stage 12 publication gate.
- Added the first studio UI modernization slice: a responsive, timeline-first three-panel shell, semantic dark-theme tokens, project synchronization and revision status, and restrained SynaptixPlay adaptive-audio accents.
- Added visible, explicitly gated entry points for generation, adaptive-state authoring, and publication workflows without presenting unfinished actions as functional.
- Added a production-connected generation workspace with creative-brief interpretation, presets, structured controls, idempotent generation-job submission, durable polling/reload recovery, proposal preview, duplicate-application protection, and reversible apply-to-project behavior.
- Added credentialed SignalR generation updates with immediate/reconnect reconciliation and polling fallback, plus desktop/tablet layout contracts and axe-powered WCAG screen-reader validation in CI.
- Added Project Schema v2 cutover prerequisites: renders pin the checksum of the snapshot the platform stored (v1 or v2) and explain up front when plug-ins would stop a render; the SynaptixPlay backend rejects uploads with an unknown project schema version or mismatched project, revision or checksum; and revisions that could not upload earlier (such as plug-in projects before the platform accepts v2) upload on project load or **Sync now**, surfacing a conflict instead of overwriting a diverged cloud copy.
- Added the local composer (`SYNAPTIX_COMPOSER=local`): an open-weight model (default `qwen2.5:7b`) in an optional Ollama GPU container (`COMPOSE_PROFILES=local-ai`) writes the same arrangement plan as the Claude composer, constrained by a tightened schema grammar so it always produces full drum, bass, harmony and melody parts. Includes a model comparison script.
- Added SynaptixPlay sign-in to the studio (home page and studio header). The platform access token lives in an HttpOnly cookie held by the studio's server, which now sends it as the `Authorization` header on every `/api/platform/*` call instead of forwarding browser cookies. The render-job and adaptive proxies now require a valid, unexpired session rather than any cookie. Live generation updates use a same-origin token endpoint, and cloud lists and pending uploads retry after sign-in. Sessions last as long as the platform's access token (8 minutes by default), and the studio says when to sign in again; silent refresh needs a platform decision, because `/auth/refresh` requires the KMS secure channel.
- Added `npm run publish:cert-revision`, which publishes a fixed certification project through the studio's own routes and prints the `STAGE12_CERT_*` inputs, and recorded a full local Stage 12 certification rehearsal (all formats, determinism, and every negative path) in `docs/operations/evidence/stage-12-local-2026-09-26/`.
- Added major keys and mode choice to generation: 12 tonics × major, minor, dorian, phrygian, lydian, mixolydian and harmonic minor. Every composer builds chords from the chosen scale and uses a progression suited to the mode (e.g. I–V–vi–IV in major, i–iv–V–i in harmonic minor); AI composers are told the mode's notes and character. The studio's Generate form has separate Key and Mode controls, new Adventure Route (C major) and Villain Encounter (A harmonic minor) presets, and briefs can set a key ("in C major") or suggest a mode ("heroic", "villain", "dreamy"). Existing minor-key requests are unchanged apart from the chord fix below.
- Added orchestration to generation: besides drums, bass, harmony and melody, composers can add sub-bass, pad, arpeggio, countermelody, stabs and sparkle layers on any of the studio's 12 instruments (exact catalog ids), bringing layers in and out by section and suggesting a mix (level, pan, reverb) the studio applies. The procedural composer picks an ensemble from the mood and mode; Claude and the local model choose one in their plan. Generation tempo now spans 60–200 BPM (Adventure Route preset at 156), and "up-tempo" briefs ask for at least 152.
- Redesigned the studio's instrument picker: six instruments in the sidebar, plus an **All instruments** dialog listing every instrument with its description in the same tile style. A choice made in the dialog takes the sixth sidebar spot.
- Added prototype text-to-audio: `services/audio-generation` runs MusicGen on the local NVIDIA GPU (`local-ai` Compose profile) and the Generate workspace has a **Prototype audio** panel whose prompt follows the generator's mood, tempo, key and brief, with play and WAV download. MusicGen weights are CC-BY-NC 4.0, so responses are labelled `prototype-only` and clips never enter projects, renders or published packages. The panel is hidden unless `AUDIO_GENERATION_API_URL` is set; CI tests the service with a fake generator.
- Enabled adaptive-package publication with server-side render verification (Stage 13.1). Before publishing, the SynaptixPlay backend asks the render worker (new service-token-authenticated `POST /internal/render-evidence`, indexed by render ID) about the certification render and every package artifact: each must come from a completed render of the version's exact project revision and checksum, with matching file and artifact-manifest checksums. Verification failures are refused (409) and an unreachable worker fails closed (503). Stage 12 evidence is recorded as accepted.
- Switched platform sync to Project Schema v2 (cutover step D): the local stack, `.env.example` and the README now set `NEXT_PUBLIC_SYNAPTIX_PLATFORM_PROJECT_SCHEMA_VERSION=2`, so plug-in projects sync to the platform instead of staying local-only. A live smoke test (`tests/ui/live-v2-sync.spec.ts`, skipped without credentials) checks v2 storage, the plug-in render refusal, and a completed render from a v2 revision.
- Added plug-in freezing (Project Schema v2 cutover step E). **Freeze** in a track's plug-in rack renders the track through its first-party plug-ins on the render worker (new `plugin-freeze` render scope; the offline Reference Drive matches its browser AudioWorklet sample for sample) and attaches the frozen audio as undoable, checksummed evidence. The rack shows whether each freeze is current or out of date; third-party and automated plug-ins aren't freezable yet, and freeze renders never appear as adaptive states.

- Render evidence (`POST /internal/render-evidence`) now reports each render's `scopeKind` (`master`, `stems` or `plugin-freeze`). The SynaptixPlay backend publishes package audio only from master and stem renders, so a plug-in freeze (one track through its plug-ins) can't be published as a game state through the API. Before, only the studio's UI kept freezes out. A worker that doesn't report the scope is refused, so deploy this worker before the matching backend change (TycoonTycoon_Backend #571).

- Studio sign-in uses SynaptixPlay's own studio routes (`/api/v1/auth/studio/login` and `/studio/refresh`), separate from the game clients: only the studio's server calls them, with `SYNAPTIX_PLATFORM_SERVICE_TOKEN` (the backend's `ServiceTokens:MusicStudio`), and the platform assigns the studio identity. Sessions now last: the studio's server keeps the refresh token in an HttpOnly cookie and renews the session a minute before the 8-minute access token ends, and when the studio is reopened (`PUT /api/auth/session`).

#### Stage 12 preview, artifact-manifest, and lossy export completion

- Added deterministic FFmpeg-backed MP3 and OGG delivery packaging after the canonical WAV render, including canonical Ogg serials/page CRCs so retries remain byte-identical.
- Added optional bounded MP3/OGG master previews and configurable lossy bitrates to the render manifest.
- Added a strict artifact-manifest contract and emitted `artifact-manifest.json` linking every audio/preview artifact to its immutable project revision, checksum, engine, range, and scope evidence.
- Added a Node 22 production render-worker image containing FFmpeg with MP3/Vorbis codecs.
- Added a least-privilege MinIO policy restricted to `synaptix-assets/renders/*`.
- Added `npm run certify:stage12` and an operations runbook to submit a real staging render, verify signed downloads/checksums/byte lengths, and retain certification evidence.
- Added the ordered Stage 13 execution plan covering publication hardening, Flutter loader/cache, runtime scheduling, stem mixing, stingers/ducking, telemetry, and cross-device rollout.

#### Stage 12 platform project loader and production worker wiring

- Added a fail-closed `HttpProjectLoader` that fetches an exact immutable project revision from the SynaptixPlay backend's internal music API, sends `X-Service-Token`, validates the response with `MusicProjectSchema`, and rejects identifier mismatches.
- Wired the render polling loop into `main.ts` when both platform-loader and MinIO configuration are present, including stable worker IDs and graceful abort on shutdown.
- Added focused coverage for successful loads, service-token forwarding, HTTP failures, schema drift, identifier mismatches, and environment configuration.
- Added the matching fail-closed internal revision API in SynaptixPlay backend PR #525; staging still needs matching `RENDER_WORKER_SERVICE_TOKEN` / `ServiceTokens__RenderWorker` secret provisioning and end-to-end verification.

#### Stage 12 MinIO artifact storage and signed delivery

- Added `MinioArtifactStore` as a durable `ArtifactSink` using deterministic `renders/{renderId}/{fileName}` object keys and checksum/artifact metadata.
- Added bounded presigned GET delivery and a render-worker route that only signs artifacts recorded on a completed render job.
- Added an authenticated Next.js BFF proxy route for artifact download grants.
- Added opt-in environment configuration and automated coverage for upload naming, metadata, expiry limits, path traversal, and recorded-artifact authorization.
- Production least-privilege MinIO credential provisioning and deployment verification remain operational work.

#### Stage 12 deterministic offline reverb and master compression

- Added deterministic Freeverb-style stereo reverb with canonical per-track `reverbSend` routing in the offline master renderer.
- Added a stereo-linked feed-forward master compressor aligned with the browser graph's fixed threshold, ratio, attack, and release settings.
- Preserved dry stem exports for remixing and adaptive layer assembly.
- Added DSP and renderer regression coverage for repeatability, decay, gain reduction, stereo linking, reverb-send binding, and dry-stem isolation.

#### Stage 12 render-job HTTP API, BFF wiring, and offline WAV rendering — commits c3ffdc9, 513b7b9

- Added a private, server-to-server render-job HTTP API (`services/render-worker/src/http-server.ts`): `POST /render-jobs` (idempotent submission), `GET /render-jobs`/`GET /render-jobs/:id` (list/status), `POST /render-jobs/:id/cancel`, `GET /render-jobs/:id/events`. Not internet-facing, matching the Python generation-api's private-dependency posture.
- Added Next.js BFF routes at `/api/platform/render-jobs/*` proxying directly to the render-worker HTTP API via a new `RENDER_WORKER_API_URL` env var, requiring end-user authentication. This deliberately deviates from the generation-jobs/adaptive-packages convention of routing everything through `SYNAPTIX_PLATFORM_API_URL` (the .NET SynaptixPlay backend) — that backend is a separate, large, unfamiliar production solution (also hosting KMS, Wallet, and Compliance) that doesn't need to be extended for a resource that has no multi-tenant authorization requirement yet.
- Added a deterministic, dependency-free offline WAV renderer (`offline-renderer.ts`): reuses `resolveEffectiveInstrumentSettings` from `@synaptix/daw-engine` (via a new Tone.js-free `./production-audio` subpath export) for canonical device/parameter semantics per ADR-0003, then does its own pure-JS oscillator/ADSR/one-pole-filter synthesis, mute/solo/pan/volume mixing, master-or-stems scope handling, tick-range restriction, peak normalization, and clipping detection. Deterministic reverb and master compression were added in the subsequent DSP slice above.
- Added a RIFF/WAVE PCM `wav-encoder.ts` (16/24/32-bit) and SHA-256 artifact checksumming.
- Added a worker loop (`worker.ts`): `processNextJob` leases one job, heartbeats for the duration of the render (so a slow render isn't reclaimed by another worker), executes the renderer, and reports the result through the control plane's existing retry/dead-letter rules; `runWorker` polls it continuously. Production `ProjectLoader` and `ArtifactSink` implementations were added in subsequent slices above.
- Added `FilesystemArtifactSink`, a local-disk placeholder for artifact storage pending real object-storage upload and signed delivery.
- Added a minimal `main.ts` entry point that boots the HTTP API; production worker-loop wiring was added in the platform project-loader slice above.
- Added 24 new tests (42 total in the package): full HTTP lifecycle tests against a real running server, 11 offline-renderer tests (determinism, silence gating, mute/solo, range filtering, stems, normalization, fail-closed error handling), 5 WAV-encoder tests, and 5 worker-loop tests including a heartbeat-during-slow-render race test — all verified against a real, disposable Postgres instance.
- Fixed a test-isolation bug: Node's test runner executes test **files** concurrently by default, so two files sharing one database and each truncating its tables in `beforeEach` were racing each other. Added `--test-concurrency=1` to the package's test script.
- **Remaining operational gap:** merge and deploy the matching SynaptixPlay backend endpoint, provision matching service and object-storage credentials, and run an end-to-end staging render.

#### Stage 12 render-job PostgreSQL persistence — commit c3b3d98

- Added the `@synaptix/render-worker` service (`services/render-worker`) with `PostgresRenderJobStore`, a durable, concurrency-safe counterpart to the in-memory `RenderJobQueue`.
- Leasing uses `SELECT ... FOR UPDATE SKIP LOCKED` so multiple worker processes can lease concurrently without double-claiming a job; verified with a dedicated concurrent-leasing test against a real database.
- Extracted `resolveFailureOutcome`, the retry/dead-letter decision logic, into a pure function shared by both `RenderJobQueue` and `PostgresRenderJobStore` so the two implementations cannot silently diverge on business rules.
- Added a SQL migration (`db/migrations/0001_render_jobs.sql`) for `render_jobs` and `render_job_events`, applied idempotently via `applyMigrations()`.
- Added 14 integration tests, gracefully skipped when no database is configured and run for real via `RENDER_WORKER_TEST_DATABASE_URL`. Wired a Postgres service container into the CI TypeScript job so these run for real instead of always skipping, and added `services/render-worker/` to the CI TypeScript path-detection pattern.
- An HTTP submission/status API, BFF wiring, and an actual render worker that executes rendering are not yet implemented.

#### Stage 12 render-job control plane contracts — commit 25f4c94

- Added `RenderJob` and `RenderJobEvent` contracts (status lifecycle, lease fields, retry/dead-letter fields, structured events) alongside the existing render manifest/result contracts.
- Added `RenderJobQueue`, a tested in-memory state machine: idempotent submission keyed by idempotency key with render-ID conflict detection, FIFO leasing that respects scheduled retry times, heartbeat-extendable worker leases, exponential-backoff retry up to a configurable attempt limit, dead-lettering, expired-lease reclamation, and an append-only event log for observability.
- Extracted the existing render manifest/result schemas out of `render-contracts`'s barrel file into their own module so the new job contracts can depend on them without a circular import.
- Added 28 deterministic tests across the render-contracts package (17 new) covering the full job lifecycle, retry backoff, ownership/authorization failures, and lease expiry.
- This slice was contracts and in-process queueing logic only, matching how Stage 12's foundation and Stage 13's groundwork were bootstrapped; PostgreSQL persistence followed immediately after (see below).

#### Stage 12 master meter and device parameter binding — commit 15f13a4

- Mounted `MasterMeter` in the studio header, exposing live peak/RMS/clipping state.
- Added a canonical device-parameter catalog (filter frequency, envelope ADSR, reverb send) with defined ranges, clamping, and override resolution shared between profile defaults and live runtime nodes.
- Restructured the reverb bus into a proper per-instrument send (`Tone.Gain` per device) instead of a fixed whole-bus connection, enabling the new reverb-send control.
- Added a per-track device panel in the studio UI (enable toggle, filter, ADSR, and reverb-send sliders) wired through the existing reversible device commands.
- Added `Device`/`DeviceParameter` type exports to `@synaptix/project-model`.
- Oscillator waveform and dedicated bus/master trim controls are intentionally out of scope for this slice: the command system only carries numeric per-device values, and bus/master gain is project-level rather than per-device.

#### CI efficiency phase — PR #33

- Added path-aware Synaptix Music CI validation so unrelated workspaces are not revalidated on every change.
- Added the Synaptix CI operating-model runbook.

#### Stage 13 adaptive game audio — PRs #29–#31

- Added framework-neutral adaptive package contracts covering named music states, normalized intensity, master/stem artifact references, loop boundaries, entry/exit cues, semantic cue points, and immutable linkage to an exact project revision and SHA-256 checksum.
- Added deterministic adaptive package assembly from certified render-artifact metadata, including loop/cue defaults, deduplicated stem identifiers, and sorted semantic tags.
- Added state selection by normalized intensity and required tags, directed transition lookup, and immediate/beat/bar/phrase/cue-point transition planning with minimum source-playback enforcement.
- Added SynaptixPlay platform persistence contracts and authenticated Next.js BFF proxy routes for listing, publishing, and reading adaptive package versions and artifact delivery grants.
- Added deterministic tests for package assembly, selection, lookup, scheduling, and invalid evidence.
- This slice produces validated package metadata and transition timing only; it does not decode or play audio, and packages cannot be published until Stage 12 produces certified render artifacts.

#### Stage 12 production graph integration — PR #26

- Integrated the production audio graph into `BrowserAudioEngine`, preserving transport scheduling and audition while adding device-profile instrument selection, drum/music bus routing, shared reverb and master compression, master peak/RMS snapshots, clipping evidence, and disposable meter subscriptions.
- Added reversible editor commands for enabling/disabling a device and adding/updating numeric device parameters, participating in the existing revision, undo/redo, IndexedDB, and platform-synchronization pipeline.
- Added `MasterMeter`, a browser-facing master level display with peak, RMS, and clipping indication (not yet mounted in the studio shell).

#### Documentation Synchronization Milestone

- Added a current roadmap with completion estimates, ordered remaining work, and release gates.
- Added the accepted system architecture covering browser, BFF, .NET platform, Python generation, and render-worker boundaries.
- Added architecture decision records for the canonical project model, local-first synchronization, browser-preview/render separation, and canonical device parameters.
- Added Alpha Foundation release notes and tag-readiness requirements.
- Synchronized the root README, documentation index, and implementation-stage ledger with the actual repository state.

#### Stage 12 foundation — PR #25

- Added device-specific instrument profiles for drums, bass, lead, and general polyphonic tracks.
- Added an explicit browser production graph with drum and music buses, a shared reverb return, master compression, and master output metering.
- Added peak/RMS snapshots and clipping evidence.
- Added versioned deterministic render manifests and results.
- Required exact project revision, project checksum, rendering-engine version, deterministic seed, tick range, scope, output format, sample rate, bit depth, and effect-tail settings.
- Added strict render artifact evidence, including SHA-256 checksums and byte lengths.
- Added deterministic tests for routing profiles, metering, render defaults, invalid ranges, and missing artifact evidence.

#### Detailed MIDI editor and drum workflow — PRs #17–#24

- Added command-backed mixer, transport, MIDI-note, quantization, transposition, duplication, and drum-step edits.
- Added bounded browser undo/redo with keyboard shortcuts, single-flight execution, explicit project anchors, and redo invalidation.
- Added piano-roll selection, snapping, note creation, movement, resizing, velocity editing, marquee selection, zoom, and duplication.
- Added a command-backed drum step sequencer with device-aware lane mappings, multi-bar patterns, velocity/accent controls, duplication, clearing, and playback-position feedback.
- Added track-scoped MIDI audition, authoritative transport tick snapshots, and all-notes-off panic handling.
- Added browser-session recovery state for saving, unsaved, and failed revisions.
- Added retry of the same pending revision envelope without replaying the musical command.
- Added before-unload protection and project-scoped multi-tab editing leases.
- Added deterministic command-history, piano-roll, drum-sequencer, persistence-recovery, and multi-tab tests.

#### Platform project synchronization — PRs #14–#16 and backend PRs #500–#501

- Added local-first hybrid project repositories and persistent IndexedDB synchronization queueing.
- Added authenticated project-list, download, creation, revision-upload, revision-history, archive, and restore APIs.
- Added idempotent writes and `If-Match` optimistic concurrency.
- Added explicit conflict envelopes and user-controlled cloud/local resolution.
- Added automatic startup, online, reconnect, periodic, and manual queue draining.

#### Generation-job status updates — PRs #10–#13

- Added polling, terminal-state handling, and authenticated BFF status reads.
- Added player-scoped SignalR lifecycle delivery with automatic reconnect.
- Added durable reconnect reconciliation, event replay cursors, and acknowledgements.
- Added concurrent active-job tracking.
- Added deterministic job-based command, transaction, and revision identifiers.
- Added duplicate completed-proposal protection and transition coalescing.

#### PR #9 — SynaptixPlay platform integration boundary

- Added `@synaptix/platform-contracts` with strict schemas for users, entitlements, project access, credit reservations, generation jobs, and normalized errors.
- Added a typed browser client and authenticated Next.js backend-for-frontend boundary.
- Preserved the Python generation service as a private server-to-server dependency.

#### PR #8 — MIDI synthesis, clip visualization, and autosave

- Added Tone.js scheduling for canonical MIDI clips and notes.
- Added per-track channels and polyphonic synthesizers.
- Applied volume, pan, mute, and solo state to the audio graph.
- Added visible generated clip regions and IndexedDB autosave.

#### PR #7 — Generation conversion and browser transport

- Converted validated generation proposals into one canonical command transaction.
- Added generated tempo, markers, and provenance to the project revision.
- Added the browser audio transport and four-track editor shell.

#### PR #6 — Procedural generation service v1

- Added a deterministic Python/FastAPI procedural composer.
- Added strict Pydantic and TypeScript/Zod generation contracts.
- Added seeded electronic trivia/game-show arrangements with drums, bass, harmony, and melody.

#### PR #5 — Local project storage v1

- Added IndexedDB and in-memory adapters, immutable revision snapshots, validation, checksum verification, and recovery operations.

#### PR #4 — Command transaction history v1

- Added serializable commands, atomic transactions, rollback, undo/redo history, revision lineage, canonical JSON, and SHA-256 checksums.

#### PR #3 — Canonical Project Schema v1

- Added strict versioned TypeScript/Zod, JSON Schema, fixture, and Python/Pydantic project contracts.

#### PR #2 — Foundation Slice 1

- Pinned Node, npm, Python, and Rust toolchains.
- Added the committed npm lockfile and four-lane CI.
- Added Docker health checks, Python validation, Rust/WASM checks, and package-boundary enforcement.

#### PR #1 — Documentation organization

- Established `docs/plans/` and the architecture, implementation, product, research, and archive categories.

### Changed

- **Documentation refreshed (2026-10-10).** Updated for the instrument and Studio UI v2 work:
  - **Roadmap:** a 32-instrument catalog, Rust kernel status, and a Studio UI v2 active-work section.
  - **Implementation ledger:** merged PRs #52–#73 and an "In Review" table for #74–#85.
  - **Docs index and root README:** the new capabilities and plans.
  - **daw-engine README:** an "Adding an instrument" checklist covering keywords, the generation API list, icons, golden checksums, kernel oscillators and the engine version.
  - **This changelog:** the two "Unreleased" sections are merged into one, keeping every entry.
- **Tidier device panel.** Each device now shows filter, envelope and reverb send first. The six modulation controls (Filter Envelope, Filter Env Decay, LFO Rate, Vibrato, LFO to Cutoff, Tremolo) move into a collapsible **Modulation** section. It starts open for presets that use modulation (such as Wobble Bass or FM Vibraphone), where it is marked "in use", and closed otherwise. It stays open while you edit, even if the edit takes it back to unused. A device without modulation is about a quarter shorter. The section is a native disclosure, so Tab and Enter work. The Devices visual baselines are updated.
- Updated the repository entry points to mark Stages 1–11 complete and Stage 12 active.
- Replaced obsolete Stage 9 next-step text with the current production-audio and rendering sequence.
- Clarified that browser Web Audio is a preview runtime and not production-render evidence.
- Added a formal documentation ownership model and ADR process.
- Refreshed the local-demo starter arrangement's note patterns in `createStarterProject()` (commit 15f13a4).

### Fixed

- The DAW piano roll's Chord lane no longer fails the accessibility check when a clip has no chords: it was a list with no list items, and is now a plain group holding the hint.
- The Drum Kit's starter beat now has a closed hat on every eighth note; it skipped beat 3 (#67).
- The generation API's instrument list now includes the ten new studio instruments (#72), so its catalog-parity test passes again. PR CI only runs the Python job when Python files change, so the PRs that added the instruments didn't catch the gap; `main`'s full run did. Generated arrangements don't use them yet: each role's suitable instruments are unchanged, and the plan still swaps an unsuitable choice for the role's default.
- Fixed studio sign-in being refused by the platform, which requires a product registration on its game sign-in route: the studio now signs in through the platform's studio routes instead. Before, every sign-in showed "That email and password don't match".
- Fixed studio edits being silently lost when made while the previous edit was still saving (the editor history refuses overlapping operations, and the mixer ignored clicks while busy). Edits, undo and redo now queue and each builds on the latest project; cloud uploads no longer hold up the queue. This also fixes the flaky mixer-meter UI test.
- Added Linux visual-regression baselines, generated in the Playwright 1.63 Ubuntu 24.04 image, so CI (ubuntu-latest) compares against reviewed images instead of failing on missing snapshots.
- Fixed local-model generations that timed out leaving Ollama busy with the abandoned answer, which made every queued request time out too; answers are now length-capped.
- Fixed the procedural composer building every chord as a minor triad, which put the VI and VII chords out of key; chords now come from the scale.
- Fixed the render-worker MinIO policy, which MinIO rejected (`s3:GetBucketLocation` can't take an `s3:prefix` condition), and made the local stack give the worker the scoped `RENDER_WORKER_MINIO_*` service account instead of the MinIO root credentials.
- Fixed regressions from merging Project Schema v2 (#41, #43) with the studio workflow work: the studio compiles again; crash recovery, project export/import and new-project saves handle plug-in (schema v2) projects; cloud uploads again use the last revision that actually saved as their parent; per-track reverb sends and the project mixer survive v2 conversion (Zod, JSON Schema and Python contracts updated); and frequency-drone tracks follow their chosen output bus again.
- Fixed the render-worker image installing with npm 10 (the base image default) instead of the repository's required npm 11.4.2, which printed `EBADENGINE` warnings during `run-local.sh`.
- Fixed the local-development guide and environment templates: the SynaptixPlay backend runs on port 5100 (not 5080), must listen on all interfaces for Docker, and needs a matching render-worker service token; the SignalR URL includes `/ws/notify`.
- Fixed adaptive package integration defects: version responses now include artifact descriptors, the Flutter parser reads the canonical `masterArtifactId`/`stemArtifactIds` manifest, the mobile app now bootstraps the adaptive runtime, and studio contracts accept the platform's `Accepted`-style enum casing.

All notable Synaptix Music changes are documented here. The project is pre-release, so entries are grouped under `Unreleased` and reference the pull request or milestone that introduced each completed slice.

- Corrected repeated npm workspace lockfile drift when packages were introduced.
- Upgraded GitHub Actions to Node 24-compatible action versions.
- Corrected Ruff import ordering and formatting failures.
- Corrected unsupported npm `workspace:*` dependency declarations.
- Corrected TypeScript contract exports and `.ts` ESM test resolution.
- Corrected strict-TypeScript meter-value narrowing in the production audio foundation.
- Lazily initialized the browser production audio graph so server-side and pre-interaction construction of `BrowserAudioEngine` no longer touches the Web Audio API (PR #28).
- Clamped piano roll resize gestures to valid note bounds (PR #32).
- Fixed environment-variable loading: shared root `.env.local` values (including `SYNAPTIX_PLATFORM_API_URL`) never reached the Next.js server process because Next only reads `.env*` files from its own app directory, not the monorepo root. Every platform sync attempt failed with `platform_unavailable` and a 502. `next.config.ts` now loads the monorepo-root env files via `@next/env` (commit 3f997aa).
- Replaced raw JSON error envelopes surfaced in the sync status line with the extracted `message` field (commit 3f997aa).
- Fixed the master meter reporting drifting, non-physical dBFS readings (e.g. -1300 dBFS) instead of settling to silence after playback stops, by clamping sub-floor meter readings to -Infinity (commit 15f13a4).
- Aligned the music-studio app's test runner with the rest of the monorepo (`--experimental-transform-types`), fixing a TypeScript parameter-property incompatibility that only surfaced once a test imported `platform-project-repository.ts` (commit 3f997aa).

## Active Work

Studio UI v2 (a DAW layout drawing on FL Studio 2026 and Ableton Live 12.4) is in progress behind Layout → "DAW layout (preview)": steps 1–3 (shell, dock, coloured timeline, markers and loop brace) are done; step 4 (piano roll in the dock) is next. See `docs/plans/ui/studio-ui-v2.md`.

Stage 12 (Production Audio and Rendering) is implementation-complete: durable jobs, exact-revision loading, deterministic WAV rendering with master effects, stems, MP3/OGG derivatives, bounded previews, artifact manifests, MinIO signed delivery, production image/policy, and certification tooling are implemented and tested. Live secret provisioning and staging evidence remain before operational closure. Stage 13 execution is now ordered across publication hardening, Flutter loading/cache, playback scheduling, stem mixing, stingers/ducking, telemetry, and cross-device certification; publication remains gated on accepted Stage 12 evidence.

## Release Policy

The first tagged alpha requires the standalone browser editor, local persistence, procedural generation, platform job integration, project synchronization, production audio graph, and at least one deterministic offline WAV rendering path to be validated together.
