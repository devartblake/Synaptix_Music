# Listening Player v1: Library, Mini Player, Now Playing

**Status:** Implemented (local projects, rendered mixes, rename, cover art, offline renders, offline app shell)
**Design references:** iOS 27 Music (liquid-glass controls, blurred-artwork hero, floating mini player above a glass tab bar, separate round search button) and Spotify (near-black canvas, dense track list, prominent primary play action).

## What it is

A listening mode next to the studio:

- **Library** (`/library`): every project saved in this browser as an "album" with generated artwork, search, play-on-hover, and Play all.
- **Project page** (`/library/[projectId]`): a "…" options menu in the upper right (Add/Change cover, Remove cover, Rename), blurred-artwork hero, centered title, white play button between glass circle actions (edit in Studio, repeat), a glass **Latest render** card, and the project's tracks as a list; tapping a track plays it solo.
- **Mini player**: a floating glass capsule above the tab bar on Home and Library pages, with play/pause, next, and a progress hairline. Tapping it opens **Now Playing** (full-screen dialog: artwork, scrubber, repeat/previous/play/next, Up next queue, Open in Studio).

## What it plays

| Source | How | When |
| --- | --- | --- |
| Live mix / solo track | `BrowserAudioEngine` renders the saved project in the browser (built-in instruments and plug-in inserts), loop switched off so the queue can advance | Always, offline, no account; reflects the latest saved edit |
| Rendered mix | `<audio>` streams the newest completed render's master file via a short-lived download link from the platform | When signed in to the platform and a render exists |

Durations, queue rules (repeat off/all/one, "previous" restarts after 3 s), solo previews and artwork are pure functions in `lib/player/playback-model.ts` with unit tests.

## Interaction with the studio

- **One audio owner.** Tone.js has a single global transport, so the player and the studio cannot both drive audio. The studio calls `usePlayer.getState().release()` on mount: the player stops and frees its engine, and the studio's own transport takes over. The mini player is not shown in the studio.
- **Navigation.** The player lives in a module-level zustand store, so it keeps playing across client-side navigation between Home, Library and project pages (internal links use Next `<Link>`). A full page load stops playback.
- **Edits.** The library reads projects from IndexedDB when a page opens, so a project edited in the studio plays its latest saved revision next time it's started from the library.
- **Handoff to editing.** "Open in Studio" (project page and Now Playing) opens the project in the editor; playback stops there by design.

## Project details: name and cover art

- **Rename** is a project edit: the studio title has a rename button (Enter saves, Escape cancels) that runs `RenameProjectEditorCommand`, so it's undoable, saved as a revision and synced like any other edit, and respects the single-writer tab lease. The Library's **Rename** opens the studio with `?rename=1`, which starts editing immediately.
- **Cover art** is listening metadata, not project content. Uploaded PNG/JPEG/WebP images (≤ 20 MB) are decoded in the browser, center-cropped to a square, scaled to at most 1024 px and re-encoded (which also strips metadata such as EXIF location), then stored in the local media store (`@synaptix/project-storage/media`, IndexedDB `synaptix-music-media`). Covers never enter project revisions, checksums or platform uploads. Every artwork surface uses `CoverArt`, which falls back to the generated artwork; the OS media controls show the cover too.

## Offline listening for rendered mixes

1. **Download.** On a project page, **Download for offline** fetches the newest render through `/api/platform/render-jobs/{jobId}/artifacts/{artifactId}/content`. That route resolves the object store's signed URL and streams the file server-side, so the bucket needs no browser CORS policy and signed URLs never reach the client.
2. **Verify.** The bytes are stored only if their size and SHA-256 match what the render worker recorded for the artifact (`cacheVerifiedRender`); a truncated or tampered download is rejected.
3. **Keep.** The file goes into the media store's `renders` store. The app asks the browser to make storage persistent (`navigator.storage.persist()`), which reduces the chance of eviction under storage pressure.
4. **Play.** The player always checks for a downloaded copy first and plays it from a local object URL, so it works without a network; otherwise it streams from a fresh signed link. The Library's **Downloaded** section lists every saved mix with its size, and each can be removed.

## Opening the app offline (service worker)

`public/sw.js` makes the app itself start without a network; the data (projects, covers, downloaded mixes) was already local.

- **Install.** On first visit the worker saves `/`, `/library` and `/offline.html` plus the scripts and styles they reference. The page also sends the assets it loaded before the worker took control (`warm-static`), so the current page works offline right away.
- **Pages** (`/`, `/library*`, `/studio/*`): network first, so online users always get the latest build; a successful load is saved (keyed without the query string) along with its assets. Offline, the saved copy is served, and a page never opened online gets `/offline.html`, which links back to the Library.
- **`/_next/static/*`**: content-hashed, so served cache-first.
- **Never cached:** `/api/*`, other origins and non-GET requests, so platform calls, signed links and render downloads always go to the network.
- **Updates.** Cache names are versioned (`synaptix-pages-v1`, `synaptix-static-v1`); on activation the worker deletes other `synaptix-*` caches. Pages are capped at 60 entries and assets at 400.
- **Where it runs.** Registered only in production builds (`next dev` unregisters it so stale bundles never stick). `NEXT_PUBLIC_SERVICE_WORKER=off` disables it. A web app manifest (`app/manifest.ts`, `app/icon.svg`) makes the app installable to a home screen, opening at `/library`.
- **Offline UI.** The Library shows a "You're offline" banner, and **Download for offline** is disabled until the connection returns.

The worker's logic is unit-tested by running `public/sw.js` against fake Cache Storage (`lib/pwa/service-worker.test.ts`). CI's browser tests run against `next dev`, so the end-to-end offline flow was checked by hand on a production build. The check: open online, stop the server, then cold-start the Library, play a project and open an unvisited page. Playwright's `setOffline` does not stop the worker's own requests, so a real check has to stop the server.

## Deliberate limits (follow-ups)

- Playback position is not carried into the studio ("continue from here in Studio").
- Covers are local to this browser; syncing them across devices needs a platform asset upload.
- Only pages opened online (plus Home and Library) work offline; studio pages for other projects show the offline page.
- Search covers project names only.
