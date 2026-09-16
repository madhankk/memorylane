# Mining a Lifetime of Photos: Roadmap for Phases 5–9

**Status:** Roadmap draft — updated 2026-09-16
**Builds on:** `2026-09-14-media-intelligence-design.md` (Phases 1–4, all merged to `main`: full EXIF, stacks, CLIP similarity/search, People).
**Theme:** A library that spans decades is only valuable if you can *ask it things*, *keep it tidy*, and *make things from it*. This document lays out the features that turn the index we now have into that — conversational search, places, timelines and "best of" mining, housekeeping (delete/hide/export), virtual albums, sharing, light editing, collages and slideshows, and opt-in AI transformations — with the architecture each needs and what, if anything, has to leave the machine.

**Structure:** the core stays small (index, analysis pipeline, query builder, UI shell); everything in §2 is delivered as a **plugin** against the extension points in §3, so capabilities can be added — including ones that need paid API keys or a GPU — without the core growing.

## Status at a glance

The status here describes implementation, not priority. **In PR** means implemented on a branch but not yet merged to `main`; **Plan ready** means an implementation plan exists, not that the feature is built.

| Area — click to jump to details | Phase | Status |
|---|---|---|
| [EXIF and People foundation hardening](#recent-foundation-work) | Before 5 | In PR ([#7](https://github.com/madhankk/memorylane/pull/7)) |
| [A. Ask your library](#feature-a) | 5 | Planned |
| [B. Places](#feature-b) | 5 | Planned |
| [C. People context](#feature-c) | 5 | Planned |
| [D. Captions and keywords](#feature-d) | Optional after 5 | Planned |
| [E. Filtered semantic ranking](#feature-e) | 5 | Planned |
| [F. Mining](#feature-f) | 7 | Planned |
| [G. Light editing](#feature-g) | 8 | Planned |
| [H. Collages, cards and slideshows](#feature-h) | 8 | Planned |
| [I. AI transformations](#feature-i) | 9 | Planned |
| [J. Housekeeping](#feature-j) | 6 | Planned |
| [K. Virtual albums](#feature-k) | 6 | Planned |
| [L. Sharing](#feature-l) | 7–9 | Planned |
| [M. Apple Photos library](#feature-m) | 6 | Plan ready |

## Recent foundation work

[PR #7](https://github.com/madhankk/memorylane/pull/7) implements the following improvements to Phases 1–4. They are **not yet merged to `main`**, and they do not mark any Phase 5–9 feature above as complete.

- **EXIF recovery:** zero-byte files are recorded as unsupported rather than repeatedly failing full-EXIF analysis, so a bad file does not hold up the rest of the queue.
- **People cleanup:** people are sorted by photo count; unwanted person groupings can be removed with confirmation without deleting photos or face detections. Their detected faces remain dismissed across re-detection and automatic discovery.
- **People usability:** each People-grid card has quick Remove and inline Rename actions, so neither requires opening the person page.
- **Person-page loading:** the person-photo query uses an indexed person-first path instead of the slow correlated query that stalled on large libraries.

---

## 1. Principles carried forward

1. **Originals are never modified.** Every feature below that produces an image writes a *new* file (an edit export, a collage, a slideshow) into a plainly named sibling folder, exactly like the video-modernization archive does today. Edits are stored as recipes and rendered on demand until the user chooses to export.
2. **Local by default, cloud by explicit choice.** Everything in Phases 1–4 runs on the user's machine. Where a feature is better with a hosted model (query understanding, image generation), it is a provider the user configures, labelled with precisely what is sent: *question text and metadata* vs. *pixels*.
3. **Same pipeline, new analyzers.** Places, quality scores and captions are just more `Analyzer`s on the existing `media_analysis` worker; they get progress bars, retries and versioning for free.
4. **People data stays special.** Anything that sends a face crop or a name off-machine is a separate, explicit opt-in.
5. **Plugins, not a bigger core.** A feature is a plugin that declares what it *provides* (analyzers, providers, pages, actions) and what it *requires* (API keys, sidecar models, GPU, network). The core loads, configures and shows them; it doesn't know what they do. Disabling a plugin removes its UI and stops its work without leaving the library in a broken state.
6. **Deletion is a user act, staged and reversible.** Nothing is ever unlinked by the app on its own. "Delete" means *mark → review → move to a visible trash folder next to the originals*; emptying that folder is a separate, explicit step.

---

## 2. Feature areas

<a id="feature-a"></a>

### A. Ask your library — conversational search

**What:** A chat panel (on Reports, and as a `/ask` page) where the user types "photos of my son Arjun in 2008", "the sharpest shots from the Iceland trip", "Maya and Ravi together at the beach", and gets a photo grid plus a one-line explanation of what was searched. Follow-ups refine the current set ("only outdoors", "just the birthday").

**How it works — hybrid retrieval, LLM as the query planner:**

```
question ──▶ LLM (tool calling) ──▶ find_photos({ persons, from, to, camera, lens, aperture…, place, description })
                 ▲                              │
   library summary (people names,               ▼
   cameras, lenses, places, year range)   SQL filter via buildMediaQuery  ──▶ candidate ids
                                                │
                                   description? ▼
                                   CLIP text vector · cosine over candidates (re-rank)
                                                │
                                                ▼
                                        grid + explanation
```

- The LLM never sees pixels. It sees the question and a compact **library summary** (names of persons, cameras/lenses present, places, year range) so it can resolve "my son Arjun" → `personIds`, "summer 2019" → dates, "Diwali 2008" → dates it knows, "the R5" → camera.
- Most questions are fully structured (person + time + gear) and need **no embeddings**. Content words ("beach", "cake", "snow") use the existing CLIP text embedding to **re-rank inside the filtered set** — so "Arjun in 2008 at the beach" is *filter to Arjun+2008 (SQL)* then *order by similarity to "beach" (vectors)*.
- Tools exposed to the model: `find_photos(filters)`, `list_people()`, `library_summary()`, `refine(previousResultId, filters)`. Results are ids; the UI renders them like any other grid.

**Providers:** `LlmProvider` interface with three implementations — Claude, OpenAI-compatible, and local (Ollama / llama.cpp server). Key/URL in Settings › AI › "Ask your library". Default: not configured; the panel explains what each choice sends where.

**Needs from the codebase:** filtered semantic ranking (E), places (B), optional relationships (C). The rest exists.

**Effort:** medium. **Data leaving the machine:** question text + metadata summary (cloud providers) or nothing (local).

<a id="feature-b"></a>

### B. Places — offline reverse geocoding

**What:** Turn the GPS we already store into names: "Reykjavík, Iceland", "Austin, Texas". A **Place** facet on Reports, a place filter for Ask, and "same place, different years" rediscovery.

**How:** a `places` analyzer that runs a *bundled, offline* reverse geocoder — GeoNames `cities1000` (≈150k populated places, CC BY 4.0, ~30 MB) plus admin/country tables, loaded into SQLite with an R-tree or a simple geohash grid; nearest-city lookup is sub-millisecond. Columns on `media_exif`: `place_city`, `place_region`, `place_country`, `place_id`. No network, no API key.

**Extras once it exists:** a map view (tile server is the one thing that *would* need network — offline-first alternative is a country/region choropleth from the same dataset), and trip detection: consecutive days ≥ N km from the user's home cluster = "Trip to Iceland, May 2016" — an auto-album with a real name.

**Effort:** small–medium. **Data leaving the machine:** none.

<a id="feature-c"></a>

### C. People context — relationships, birthdays, "age in photo"

**What:** Optional fields on a person: relationship ("son", "partner", "friend"), birthday. Enables "my kids" in Ask, and the surprisingly delightful **age caption** — "Arjun, 4 years old" — on every photo, plus a **growing-up timeline** per person (one photo per month/season, chronological).

**How:** two nullable columns on `persons`; the library summary includes relationships; the Viewer caption and person page compute age from `captured_at_precise − birthday`.

**Effort:** small. **Data leaving the machine:** relationship words go to the LLM only as part of the summary; birthdays never leave.

<a id="feature-d"></a>

### D. Captions and keywords (optional analyzer)

**What:** A short caption + keywords per photo ("two children building a snowman in a garden"), indexed into full-text search so text queries work without CLIP and so Ask can answer from words alone.

**How:** the `caption` analyzer from the original design §11: a vision-language model — **local** (a small VLM through the sidecar; Moondream-class models run on CPU at a few seconds per image, fine as a background backfill) or **cloud** (Claude vision). Run on demand for a selection/folder/favourites first; whole-library is an explicit choice because of cost/time. Output to `media_captions(media_id, model, caption, keywords_json)` and into `media_fts`.

**When it earns its keep:** text-only retrieval without the sidecar running, album naming ("Snow day, Feb 2019"), and richer Ask answers. Not required for A — CLIP already covers content queries.

**Effort:** medium. **Data leaving the machine:** pixels, if the cloud option is chosen — labelled as such.

<a id="feature-e"></a>

### E. Filtered semantic ranking (infrastructure)

**What:** "Rank *these* ids by similarity to a text or image vector." Today semantic search ranks the whole index.

**How:** for candidate sets up to ~20k, brute-force cosine over vectors read from `media_embeddings` (SQLite) — milliseconds. Above that, LanceDB's `where id IN (…)` pre-filter. One function on `VectorIndex`/`EmbeddingRepo`; used by A and by "Find similar within this folder/person".

**Effort:** small.

<a id="feature-f"></a>

### F. Mining — rediscovery features that use the new data

All of these are queries over data we already have (or B/C add), surfaced as pages or Home cards:

| Feature | What it shows | Needs |
|---|---|---|
| **Year in review** | For a chosen year: photo count by month, top places, people who appear most, the "best" 30 photos, a one-click slideshow | EXIF, People, B, quality score (below) |
| **Best of** | Ranked photos for any filter: favourites first, then a **quality score** = sharpness (Laplacian variance on the thumbnail — a tiny in-process analyzer) × exposure sanity × "not a near-duplicate of a better frame" (stacks) | new `quality` analyzer (small) |
| **Growing-up timelines** | Per person, one representative photo per period, chronological, with age captions | People + C |
| **Same place, different years** | "You've photographed this waterfall in 2016 and 2023" | B + similarity |
| **Then & now** | Pairs of similar photos far apart in time (kNN restricted to Δt > N years) | E |
| **Trips** | Auto-albums from place/time clustering | B |
| **This day / this week** | Already exists — extend with "on this day, N years ago" spread across years | EXIF |

**Effort:** small–medium each; the quality analyzer is the only new computation.

<a id="feature-g"></a>

### G. Light editing — non-destructive

**What:** Rotate, flip, straighten, crop (free/fixed ratios), exposure/contrast/white-balance sliders, and one-click "auto". Enough to fix a tilted horizon or crop a scan; not a Lightroom.

**How:**
- **Recipe, not pixels.** An `edits` table: `media_id`, `recipe_json` (ordered ops), `version`, `updated_at`. The Viewer renders the recipe on the fly with Sharp (`rotate`, `extract`, `modulate`, `linear`, `gamma`) from the analysis input tier (1600 px preview for RAW, original for JPEG) — fast enough interactively at preview size.
- The grid thumbnail regenerates from the recipe (bump `thumbnail_version`, existing cache-busting works).
- **Export** writes a new full-resolution JPEG to `<original folder>/_MemoryLane-Edits/<name>-edited.jpg` (mirroring the transcode archive convention), which the scanner then indexes as a normal photo paired to its source via a `derived_from` column (shown in the stack with the original). Originals untouched; RAW exports render from the embedded preview unless `dcraw`/`libraw` is added later (open decision).
- "Reset" deletes the recipe.

**Effort:** medium. **Data leaving the machine:** none.

<a id="feature-h"></a>

### H. Collages, cards and slideshows

**What:** Make something from a selection or an Ask result: a grid/mosaic collage, a "Year 2016" poster, a birthday/holiday card with a caption, and an **MP4 slideshow** with Ken Burns motion and captions (people, place, date).

**How:**
- Collages/cards: Sharp compositing from a small set of templates (grid, masonry, polaroid scatter, poster with title). Export PNG/JPEG/PDF to `<data-dir>/creations/` and offer "save next to…" into the library's `_MemoryLane-Creations` folder so it gets indexed.
- Slideshows: **ffmpeg is already bundled** (`ffmpeg-static`) — zoompan + xfade filters produce a 1080p/4K H.264 slideshow from the rendered frames in seconds per minute of output. Music is user-supplied (no bundled audio, no licensing question).
- Selection model: the folder "Select" mode grows a **Create…** menu; Ask results and person/year pages get the same.

**Effort:** medium. **Data leaving the machine:** none.

<a id="feature-i"></a>

### I. Fun AI transformations (holidays, styles) — opt-in

**What:** "Turn this into a watercolour", "add falling snow", "make a Diwali card from this photo", "swap the background for the Northern Lights". Generated images are always **new files labelled as AI-modified**, never replacing anything.

**How — a provider, because the honest answer is that this needs a big model:**
- **Cloud image editing/generation provider** (hosted image models with edit/inpaint endpoints): best quality, minutes to integrate, **sends the photo's pixels** to the provider; per-image cost; may include faces — so this sits behind the People-style opt-in and shows a per-request "this photo will be sent to X" notice.
- **Local** (Stable Diffusion / FLUX-class models via the sidecar with a diffusers backend): private, free per image, but needs a real GPU (8 GB+ VRAM for practical speed) and 5–10 GB of weights. Offered as an advanced option on machines that can run it.
- Output goes to `_MemoryLane-Creations/` with an `ai_generated` flag and provenance (source photo, prompt, model) stored in a `creations` table; the grid badge says **AI**.

**Effort:** medium (cloud) / large (local). **Data leaving the machine:** pixels, for the cloud option — explicitly consented per use.

<a id="feature-j"></a>

### J. Housekeeping — delete, hide, export

**What:** the tidying tools a large archive needs: get rid of the 19 rejected frames of a burst, drop a whole folder of screenshots, hide the photos you never want to see again, and export a selection in a chosen format and size for a website, a frame, or a friend.

**Delete — staged, reviewable, reversible:**
- **Mark for deletion** from anywhere: one photo, the non-cover frames of a stack ("keep the cover, delete the rest"), everything in a selection, or a whole folder. A mark is a row in `deletion_marks(media_id, marked_at, reason)`; the grid shows a 🗑 badge; nothing on disk changes.
- **Review** on a *Marked for deletion* page (count, total size, grouped by folder, with a filmstrip so you see exactly what goes). From here: unmark, or **Move to trash**.
- **Move to trash** moves each original (and its companions — RAW pair, Live Photo video, XMP sidecar) into `<same folder>/_MemoryLane-Trash/`, a plain visible folder next to where it was, and removes the rows from the index. Reversible by moving the files back and rescanning (a **Restore** action does this from the trash view). Folder-level delete is the same flow with the folder's items pre-selected; it never removes the folder itself.
- **Empty trash** permanently deletes files in `_MemoryLane-Trash/` folders — a second confirmation that states the count and size, and the only place the app ever unlinks anything. Disabled while a scan is running.
- The scanner ignores `_MemoryLane-Trash/` like it ignores `_MemoryLane-Archived-Originals/`.

**Hide:** `hidden` on `media` (per photo, per stack, or per folder subtree). Hidden items leave every listing (`buildMediaQuery` gets `includeHidden`), are skipped by analyzers, and are not re-added by rescans (the scanner keeps the row, just hidden). A *Hidden* page under Settings lists them with unhide. Folder-level hide is the existing "Ignore folder", surfaced in the same place.

**Export:** a **Create › Export** action for any selection/album: choose format (JPEG / PNG / WebP / HEIC where supported / original), long-edge size or exact dimensions, quality, whether to apply edit recipes (G), keep or strip EXIF/GPS, and a filename pattern (`{date}_{person}_{n}`). Sharp renders; output goes to a folder the user picks (or a zip for download from a remote browser). RAW exports use the embedded preview until a RAW decoder is added (open decision 2).

**Effort:** medium. **Data leaving the machine:** none.

<a id="feature-k"></a>

### K. Virtual albums — saved queries

**What:** any filter combination the app can express becomes an album: "Arjun, 2008–2010", "Iceland trips", "R5 + 100-500 wildlife", an Ask result, or a hand-picked set. People and Places are already albums of this kind; this makes the concept explicit and user-owned.

**How:** `albums(id, name, kind, query_json | null, cover_media_id, sort, created_at)` + `album_items(album_id, media_id, position)` for manual/mixed albums. `kind = "query"` albums re-run `buildMediaQuery(query_json)` on open (always current: new photos of Arjun join automatically); `kind = "manual"` is a pinned list; a query album can be **frozen** into a manual one. Albums appear in the nav, on Home, and as a share/export/create target. **Smart suggestions**: trips (B), "best of {year}" (F) and person timelines offer *Save as album*.

**Effort:** small–medium. **Data leaving the machine:** none.

<a id="feature-l"></a>

### L. Sharing

**What:** show one photo or an album to someone else. Three tiers, because "sharing" means different things for a self-hosted app:

1. **Export & send** (always available): the export flow (J) produces sized JPEGs or a zip — the user sends them however they like. Zero infrastructure.
2. **Share links on your own server** (core): a `shares(token, album_id | media_id, expires_at, password_hash | null, allow_download, view_count)` table and a public `/s/<token>` page that renders a stripped-down gallery/slideshow **without login**, sized derivatives only (no originals unless *allow download* is on), optional password and expiry, revocable from a Shares list. Works on the LAN out of the box; over the internet it needs the user's existing reverse-proxy/TLS setup (documented; the app still never ships without-TLS-to-the-internet defaults).
3. **Hosted sharing** (plugin, optional, paid infra): a plugin that uploads the sized derivatives of a share to a hosting bucket (the user's own S3/R2/B2 with their keys, or a MemoryLane-provided service later) and returns a public URL — for people without a reachable server. Clearly labelled: *these derivatives leave your machine*.

**Effort:** small (1), medium (2), medium (3). **Data leaving the machine:** none (1–2, other than to the people you share with), sized derivatives to the chosen host (3).

<a id="feature-m"></a>

### M. Apple Photos library (macOS)

**What:** detect `~/Pictures/*.photoslibrary` (and let the user point at another), index it read-only, and bring across what Photos already knows — so a Mac user's phone photos are in MemoryLane without exporting anything.

**How it's laid out:** the package holds `originals/` (unmodified files under UUID names), `database/Photos.sqlite` (filenames, adjusted dates/time zones, camera/lens/exposure summary, favourites, keywords, titles, albums, **named people with face rectangles**, location, hidden/trashed state, local-vs-iCloud state per asset) and `resources/derivatives/` (a ~2048 px preview + thumbnail per asset).

**Plugin `apple-photos`:**
- A new **scan-root kind** (`kind: "apple-photos"`) — the one core seam this needs. The scanner walks `originals/`; a catalogue sync reads a *copy* of `Photos.sqlite` (+WAL) so Photos.app is never contended, mapping UUID files to real names, dates, GPS, and the EXIF summary. Read-only, always; edits/deletes stay in Photos.app and our trash flow is disabled for this root.
- **People bootstrap:** Apple's person names attach to our detections by box overlap — a decade of labels for free.
- **Albums / favourites / keywords** import into virtual albums (§K), our favourites, and full-text search.
- **Schema drift:** Apple changes the schema with each macOS; use `osxphotos` (MIT, tracks every release) in the sidecar as a `photos-catalog` provider rather than hand-maintaining the mapping.
- **Permissions:** reading the package needs Photos or Full Disk Access for the launching app — detect *Operation not permitted* and explain, as with network volumes.

**iCloud "Optimize Mac Storage":** originals may not be on disk. Everything still works from the derivative + catalogue: thumbnails, CLIP embeddings, faces, dates, location, camera/lens/exposure facets. Only the full tag dump and full-resolution use are gated. Each media row carries `original_available`; the Viewer shows *"Original is in iCloud — showing Apple's 2048 px preview"* with:
1. **Open in Photos** — AppleScript `spotlight media item id <uuid>`; viewing it there makes Photos fetch the original. Needs one Automation prompt, works with plain `npm start`.
2. **Download original** — a small signed PhotoKit helper (Swift CLI shipped with the desktop app) requests the resource with network access allowed; either streamed once for viewing/editing/export, or kept in an opt-in MemoryLane originals cache. Whether Photos retains it afterwards is Apple's caching choice; we refresh `original_available` on the next catalogue sync rather than assume.
3. **Fetch originals for this album/selection** — AppleScript export *using originals* into a folder that MemoryLane then indexes as a normal root (the way to materialise a whole trip).

**Windows:** no equivalent — Microsoft Photos uses plain folders and iCloud for Windows syncs to one, both already normal scan roots.

**Effort:** medium (catalogue sync + People bootstrap), plus small native work for the PhotoKit helper. **Data leaving the machine:** none.

**Implementation plan:** `docs/superpowers/plans/2026-09-15-apple-photos-plugin.md` (10 tasks; introduces the scan-root *kind* seam, reusable by future importers such as Lightroom catalogues or Google Takeout). Verified while planning: `osxphotos` 0.76 (MIT, Python ≥ 3.10) installs against the sidecar venv; reading the package from a VS Code-launched process is denied by macOS until the Photos/Full Disk Access permission is granted — the plan treats that as a first-class state.

---

## 3. Plugin architecture — the extension points

The core owns: scanning, the SQLite index, the `AnalysisWorker`, `buildMediaQuery`, the vector index, the UI shell (nav, grid, viewer, Settings), auth, and the plugin loader. Everything else is a plugin — including features already merged, which get refactored onto these seams as each roadmap phase touches them (People, stacks and the AI sidecar first).

**A plugin is a package** under `plugins/<name>/` (server + optional client bundle) with a manifest:

```ts
export interface PluginManifest {
  id: string; name: string; version: string; description: string;
  // What the plugin adds. Each kind maps to a core extension point.
  provides: {
    analyzers?: AnalyzerFactory[];        // rows on media_analysis, progress bars for free
    providers?: ProviderFactory[];        // llm | image-embed | face | image-edit | geocode | share-host …
    routes?: RouteRegistrar[];            // /api/plugins/<id>/…
    pages?: PageDescriptor[];             // nav entry + lazy-loaded client module
    actions?: ActionDescriptor[];         // entries in the selection "Create…" / "…" menus and the Viewer
    facets?: FacetDescriptor[];           // extra Reports facets backed by columns the plugin adds
    settings?: SettingsSchema;            // zod schema → auto-rendered Settings section
    migrations?: string;                  // plugin-owned tables, namespaced <id>_*
  };
  // What must be true for the plugin to run. The core shows unmet
  // requirements in Settings and keeps the plugin inert until they are met.
  requires: {
    secrets?: { key: string; label: string; help: string; url?: string }[];   // e.g. an API key, stored encrypted at rest
    sidecarModels?: string[];             // e.g. "clip-vit-base-patch32@1", "yunet-sface@1"
    gpu?: boolean; network?: boolean; minCoreVersion?: string;
  };
  // Honest disclosure rendered next to the enable switch.
  dataEgress: "none" | "metadata" | "pixels";
  license?: string;
}
```

Rules that keep this from becoming a mess:
- **Namespaces.** Tables `<id>_*`, routes `/api/plugins/<id>/`, settings keys `<id>.*`, analyzer keys `<id>:<analyzer>`.
- **Core-provided services only.** Plugins get a `PluginContext` (db, paths, query builder, vector index, provider registry, settings, secrets, logger, media renderers) — never raw access to other plugins' tables.
- **Secrets** are stored encrypted at rest (key derived from a machine secret in the data dir), never logged, never sent to the client; Settings shows "set / not set".
- **Enable/disable** is a runtime switch: disabling stops the plugin's analyzers (rows stay `pending`), hides its pages/actions, and leaves its data in place; **uninstall** offers to drop its tables.
- **Trust model:** plugins run in-process (same as today's code) and are installed from the repo's `plugins/` directory or a reviewed registry — this is not a sandbox for untrusted third-party code; that would be a later, separate design.
- **Paid capabilities** are just providers with `requires.secrets` and `dataEgress` set; the core never contains a paid API call.

**Mapping this roadmap to plugins:**

| Plugin | Provides | Requires | Egress |
|---|---|---|---|
| `ask` | page, routes, `llm` provider slot | one configured LLM provider | metadata |
| `llm-claude`, `llm-openai`, `llm-local` | `llm` provider | API key (cloud) / URL (local) | metadata / none |
| `places` | `places` analyzer, facet, bundled geodata, trip albums | — | none |
| `people-context` | person fields, age captions, timelines page | `people` | none |
| `captions` | `caption` analyzer (local VLM or cloud vision) | sidecar model or API key | none / pixels |
| `mining` | quality analyzer, Year in review / Best of / Then & now pages | — | none |
| `housekeeping` | deletion marks, trash, hidden, export action + page | — | none |
| `albums` | albums tables, page, save-as-album action | — | none |
| `share` | share links, `/s/<token>` public page; `share-host` provider slot | — (host plugins need bucket keys) | none / derivatives |
| `edit` | recipes, Viewer editing panel, export | — | none |
| `create` | collages, cards, slideshows (ffmpeg) | — | none |
| `ai-transform` | `image-edit` provider slot, AI badge/provenance | image provider (API key or GPU) | pixels (cloud) |
| `apple-photos` (macOS) | scan-root kind, catalogue sync (osxphotos in the sidecar), People/albums/favourites import, iCloud state + viewer actions, optional PhotoKit helper | Photos/Full Disk Access permission | none |

The first plugin-refactor step is small and mechanical: give `people`, `stacks` and the sidecar `ai` the manifest shape and load them through the registry, so the seams are proven before new plugins land.

### Core additions

| Addition | Where | Notes |
|---|---|---|
| `LlmProvider` (chat + tool calling) | `server/src/providers/llm/` | Claude, OpenAI-compatible, local. Same shape as the AI sidecar provider: health, config in Settings, clear "what is sent". |
| `ImageEditProvider` | `server/src/providers/image/` | Cloud edit/inpaint or local diffusers via the sidecar. Phase 8 only. |
| `places` analyzer + bundled geodata | `server/src/analysis/analyzers/places.ts`, `server/data/geonames/` | Offline; adds columns to `media_exif`. |
| `quality` analyzer | `analyzers/quality.ts` | Sharpness/exposure from the thumbnail; in-process. |
| `caption` analyzer | `analyzers/caption.ts` | Optional; local VLM or cloud vision. |
| `edits`, `creations`, `derived_from` | migrations | Recipes and provenance; exports are normal indexed media. |
| Filtered ranking | `vectors/` | `rankByText(ids, text)`, `rankByVector(ids, v)`. |
| Ask routes + page | `plugins/ask/` | Tool loop server-side; streaming optional later. |
| Plugin loader, `PluginContext`, secrets store | `server/src/plugins/` | Manifest validation, namespacing, enable/disable, encrypted secrets, Settings auto-sections, client lazy-loading of plugin pages/actions. |
| `deletion_marks`, `media.hidden`, trash/restore, export renderer | `plugins/housekeeping/` | Trash = move to `_MemoryLane-Trash/` beside the original; empty-trash is the only unlink in the app. |
| `albums`, `album_items` | `plugins/albums/` | Query albums re-run `buildMediaQuery`; manual albums are pinned lists. |
| `shares`, public `/s/<token>` | `plugins/share/` | Sized derivatives, expiry, password, revoke; hosted upload via provider. |
| Create menu + renderers | `server/src/creations/` | Sharp compositing; ffmpeg slideshow. |

Everything runs through the existing `AnalysisWorker`, `buildMediaQuery`, `MediaGrid`/`Viewer` and the Settings patterns — no new subsystems beyond the two providers.

---

## 4. What leaves the machine — at a glance

| Feature | Local-only possible? | If cloud is chosen, what is sent |
|---|---|---|
| Ask your library | Yes (local LLM) | Question text + library summary (names, gear, places, years). Never pixels. |
| Places | Always local | — |
| People context / age | Always local | Relationship words only, inside the Ask summary |
| Captions | Yes (local VLM) | Pixels of the selected photos |
| Mining features | Always local | — |
| Editing, collages, slideshows | Always local | — |
| AI transformations | Yes, with a GPU | Pixels of the chosen photo + prompt, per explicit request |
| Housekeeping, albums | Always local | — |
| Sharing | Yes (export, own-server links) | Sized derivatives to the chosen host, only with the hosted-sharing plugin |
| Apple Photos library | Always local | — |

---

## 5. Suggested order

Plans written so far: **§M Apple Photos** → `docs/superpowers/plans/2026-09-15-apple-photos-plugin.md` (plan only, not scheduled).

| Phase | Contents | Why this order |
|---|---|---|
| **5 — Plugin seams + Ask** | plugin loader/manifest/secrets, refactor `people`/`stacks`/`ai` onto it; E (filtered ranking), B (places), C (relationships/age), `llm` providers (cloud + local), Ask page | Seams first so every later feature lands as a plugin; Ask is the highest value per effort and makes decades of data *reachable*. |
| **6 — Housekeeping, albums & Apple Photos** | J (marks → trash → empty, hide, export), K (query + manual albums, save-as-album from people/places/trips/Ask), M (Apple Photos root, catalogue sync, People bootstrap, iCloud state) | The tidying tools a real library needs before "making things" is fun; M reuses albums and hidden state, and brings phone photos in for Mac users. |
| **7 — Mining & sharing** | quality analyzer, Year in review, Best of, timelines, then & now, trips; L tiers 1–2 (export, own-server share links) | Exploits data now in place; share links reuse albums. |
| **8 — Editing & creations** | G (non-destructive edits, exports), H (collages, cards, ffmpeg slideshows), Create menu | Self-contained; Sharp + bundled ffmpeg only. |
| **9 — AI transformations & hosted sharing** | I (`image-edit` provider, provenance, AI badge), L tier 3 (hosted share plugin) | Last: the only features that must send pixels away or need a GPU/bucket; reuse the People consent UX. |
| optional | D (captions) | Slot in after 5 for users who want text-only retrieval or album naming. |

---

## 6. Open decisions

1. **First LLM provider for Ask** — cloud (Claude/OpenAI) for best query understanding, or local-only to keep the zero-egress promise? Recommendation: build the abstraction, ship both, default to "not configured".
2. **RAW exports in editing** — embedded-preview quality (simple) or a real RAW decode (adds `libraw`)? Recommendation: preview quality in Phase 7, revisit if photographers ask.
3. **Where creations live** — data dir only, or also offered "save into the library" so they appear in Browse? Recommendation: both, default data dir.
4. **AI transformations provider** — which hosted image model(s), and whether to gate face-containing photos more strictly. Decide at Phase 8 with the market at that time.
5. **Geodata licensing** — GeoNames is CC BY 4.0: attribution text in Settings › About is sufficient.
6. **Trash location** — beside the originals (`_MemoryLane-Trash/` per folder, visible and restorable, works on any volume) or the OS trash (macOS/Windows APIs, not available for network volumes)? Recommendation: per-folder trash folder, with "Reveal in Finder/Explorer" links.
7. **Plugin client bundling** — one Vite build that includes enabled plugins' pages, or per-plugin bundles loaded lazily? Recommendation: single build with lazy routes for Phase 5; per-plugin bundles only if third-party plugins ever ship.
8. **Apple Photos originals cache** — when the user asks to download an iCloud original, stream it once or keep a full-res copy in MemoryLane's data dir (their disk-space trade-off)? Recommendation: stream by default, opt-in cache per action.
9. **Share links over the internet** — document reverse-proxy + TLS (as the README already does) or add a built-in tunnel/hosted relay later? Recommendation: document first; hosted relay is the tier-3 plugin's job.
