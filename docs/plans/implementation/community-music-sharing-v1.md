# Community Music Sharing v1: Store Music and Community Music

**Status (2026-10-10):** Agreed with the project owner on 2026-10-10. In progress across three repositories:
- **Platform (backend):** TycoonTycoon_Backend.
- **Studio:** this repository.
- **Game:** trivia_tycoon.

Decisions marked **(default)** were not settled explicitly. They are the plan's suggestion and are open to change.

## Goal

SynaptixPlay offers two kinds of adaptive music:

- **Store music.** Official music made by SynaptixPlay. It is sold in the store, or ships free as a game's default.
- **Community music.** Music that players make in the studio and choose to share. It is free, and credited to the creator's username.

Each player chooses what plays in the trivia game from the store, the community and their own music.

## What already exists

- **Sign-in to publish.** Publishing needs a SynaptixPlay sign-in, and the platform checks that the publisher owns the project. Every package belongs to its creator's account.
- **Storage.** Files are kept in object storage. Postgres keeps each file's location (`storage_key`), checksum and size. Download links are signed on request and expire within 15 minutes.
  - Links aren't stored, because a stored link would leak access that can't be withdrawn.
  - The stored storage key is what lets the platform issue a fresh link each time.
- **Access rules.** Version states and access rules (active, superseded, pending, revoked, expired) are fixed by TycoonTycoon_Backend#578. Until this plan lands, any signed-in player can download the active version of any package whose ID they know.

## Rules (agreed 2026-10-10)

### Two kinds of package

| | Official (store) | Community |
| --- | --- | --- |
| Made by | SynaptixPlay admins | Any signed-in player |
| Credited as | SynaptixPlay | The creator's username |
| Price | Sold in the store, or free if it's a game's default | Free |
| Visible to others | In the store | Only after the creator shares it **and** it passes review |

A package is **community** unless an admin marks it official. Only admins can do that, and an official package needs a store SKU, or to be marked as a free default.

### Sharing is private by default, and final once requested

- **Private by default.** A new package is private: only its creator can play it.
- **The creator decides.** Sharing happens only when the creator turns on **"Share with the community"** when publishing and confirms a clear warning:

  > Shared music stays in the community. Once you share it, you can't unshare it or remove it, because players may already have it in their library.

- **No take-backs.** After sharing, the creator can't unshare the package or revoke its shared versions. The platform refuses both.
  - This protects players who already downloaded the music or added it to their library.
- **Admin takedowns still exist.** SynaptixPlay admins can still take music down for a legal or policy reason, such as a copyright claim or abuse. That is the only way shared music leaves the community, and players lose access to taken-down music.
- **Updates (default).** Creators can keep publishing new versions of shared music.
  - Each new version is reviewed before the community gets it.
  - Until then, players keep the last approved version.
  - Every version that was approved stays downloadable for players who have the music in their library.

### Review before anyone else sees it

When a creator shares a version, it is checked in this order. It becomes visible to the community only when all three pass:

1. **Automatic checks.** The licence gate (no model that isn't cleared for commercial use) and the melody check (no match with known songs), from `publication-rules-v1.md`.
   - **Interim rule (default):** those checks aren't built yet. Until they are, the review queue shows "automatic checks not run", and the human reviewer is the only gate. Once the checks exist, a failed check blocks the share request outright.
2. **Human review.** An admin approves or rejects the version in the review queue.
   - Rejecting needs a reason, which the creator sees.
   - A rejected version is never shown. The creator can publish a corrected version and share again.
3. **Reports.** Any player can report community music, with a reason. Reports go to the same admin queue. An admin can dismiss a report, or take the music down.

### Kids' accounts

- Players in the kids' age bands **never** see community music unless a parent has given consent for community music.
- Store music follows the store's existing rules for kids.

### Credit

- Community music shows **"by @username"**, using the creator's SynaptixPlay username.
- If the platform later adds a separate display name, it's used instead.

### Selling community music

- Not now: community music is free.
- Selling it later needs a creator agreement covering rights, exclusivity and revenue share, plus protection against abuse. See `community-music-sales-later.md`, which is for later review.

## Who can download what

Owners keep the rules from #578. For anyone else, a version's files can be downloaded only if one of these holds:

- **Official package:** the version is active, and the package is a free default **or** the player owns its store SKU.
- **Community package:**
  - the package is shared and not taken down;
  - the version was approved in review, and isn't revoked or expired;
  - the player isn't a kid, or has parental consent for community music.

In every other case a non-owner gets "not found". This also hides whether private music exists.

## Library

- **Adding music.** A player can add community music, or store music they own, to their **library**. The game's music picker shows the library, so the player can choose what plays.
- **Removing it.** Removing music from the library is the player's own choice. It doesn't affect anyone else.

## The three parts

### Platform (TycoonTycoon_Backend)

- **Migration.** New package fields:
  - `kind` (`community` or `official`);
  - `store_sku`, and a free-default flag;
  - sharing state (`shared_at`, taken-down time and reason).

  New version fields: `community_review` (`none`, `pending`, `approved` or `rejected`), with reviewer, time and reason.

  New tables:
  - `adaptive_music_package_reports`;
  - `adaptive_music_library` (player, package).
- **Endpoints for creators:**
  - share a version (with the "I understand this is final" confirmation);
  - see the review state.
- **Endpoints for players:**
  - list approved community music: search, newest first, with creator username and latest approved version;
  - list store music, with an "owned" flag;
  - add to, remove from and list the library;
  - report music.
- **Endpoints for admins:**
  - the review queue (approve or reject);
  - the reports queue (dismiss or take down);
  - mark a package official, and set its SKU.
- **Access rule** as above, in the code path #578 fixed.
- **Refusals:** unsharing and revoking a shared version are refused.
- **Tests:** a database-backed test for every rule above.
  - Download access: owner, non-owner, kid, kid with consent, store owned / not owned / free default, taken down, each review state.
  - Sharing can't be undone.
  - Revoking shared music is refused.
  - Each endpoint's authorization.

### Studio (this repository)

- **Publish screen.** A **"Share with the community"** switch, off by default. Turning it on shows the warning that sharing is final.
- **SynaptixPlay card.** It shows **Shared** or **Private**. Shared music waiting for review, or rejected, says so under the label (with the reason).
- **Tests:** UI tests for the switch, the confirmation, and both labels.

### Game (trivia_tycoon)

- **Music section.** Three tabs:
  - **Store:** official music, with buy or owned state, through the existing store purchase flow.
  - **Community:** shared music, "by @username", with search, add to library and report.
  - **My library:** pick what plays in the game.
- **Kids.** The Community tab is hidden for kids unless a parent has given consent.
- **Tests:** widget and service tests for each tab, the kids gating and the library picker.

## Open items

- Reviewer tooling: the platform has an admin dashboard. The queues get admin endpoints first, and dashboard screens follow.
- The automatic checks (publication rules, phases 1 and 3) must land before the interim rule is removed.

## Revision

- 2026-10-10: first version, from the owner's decisions.
