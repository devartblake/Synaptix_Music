# Listening Player v1: Library, Mini Player, Now Playing

**Status:** Implemented (local projects + rendered mixes)
**Design references:** iOS 27 Music (liquid-glass controls, blurred-artwork hero, floating mini player above a glass tab bar, separate round search button) and Spotify (near-black canvas, dense track list, prominent primary play action).

## What it is

A listening mode next to the studio:

- **Library** (`/library`): every project saved in this browser as an "album" with generated artwork, search, play-on-hover, and Play all.
- **Project page** (`/library/[projectId]`): blurred-artwork hero, centered title, white play button between glass circle actions (edit in Studio, repeat), a glass **Latest render** card, and the project's tracks as a list; tapping a track plays it solo.
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

## Deliberate limits (follow-ups)

- Playback position is not carried into the studio ("continue from here in Studio").
- Renders are listed from the platform's job history; there is no offline cache of rendered files.
- Artwork is generated; projects have no user-provided cover art yet.
- Search covers project names only.
