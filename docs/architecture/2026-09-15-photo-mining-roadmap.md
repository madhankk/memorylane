# Mining a Lifetime of Photos: Roadmap for Phases 5–8

**Status:** Draft for discussion — 2026-09-15
**Builds on:** `2026-09-14-media-intelligence-design.md` (Phases 1–4, all merged to `main`: full EXIF, stacks, CLIP similarity/search, People).
**Theme:** A library that spans decades is only valuable if you can *ask it things* and *make things from it*. This document lays out the features that turn the index we now have into that — conversational search, places, timelines and "best of" mining, light editing, collages and slideshows, and opt-in AI transformations — with the architecture each needs and what, if anything, has to leave the machine.

---

## 1. Principles carried forward

1. **Originals are never modified.** Every feature below that produces an image writes a *new* file (an edit export, a collage, a slideshow) into a plainly named sibling folder, exactly like the video-modernization archive does today. Edits are stored as recipes and rendered on demand until the user chooses to export.
2. **Local by default, cloud by explicit choice.** Everything in Phases 1–4 runs on the user's machine. Where a feature is better with a hosted model (query understanding, image generation), it is a provider the user configures, labelled with precisely what is sent: *question text and metadata* vs. *pixels*.
3. **Same pipeline, new analyzers.** Places, quality scores and captions are just more `Analyzer`s on the existing `media_analysis` worker; they get progress bars, retries and versioning for free.
4. **People data stays special.** Anything that sends a face crop or a name off-machine is a separate, explicit opt-in.

---

## 2. Feature areas

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

### B. Places — offline reverse geocoding

**What:** Turn the GPS we already store into names: "Reykjavík, Iceland", "Austin, Texas". A **Place** facet on Reports, a place filter for Ask, and "same place, different years" rediscovery.

**How:** a `places` analyzer that runs a *bundled, offline* reverse geocoder — GeoNames `cities1000` (≈150k populated places, CC BY 4.0, ~30 MB) plus admin/country tables, loaded into SQLite with an R-tree or a simple geohash grid; nearest-city lookup is sub-millisecond. Columns on `media_exif`: `place_city`, `place_region`, `place_country`, `place_id`. No network, no API key.

**Extras once it exists:** a map view (tile server is the one thing that *would* need network — offline-first alternative is a country/region choropleth from the same dataset), and trip detection: consecutive days ≥ N km from the user's home cluster = "Trip to Iceland, May 2016" — an auto-album with a real name.

**Effort:** small–medium. **Data leaving the machine:** none.

### C. People context — relationships, birthdays, "age in photo"

**What:** Optional fields on a person: relationship ("son", "partner", "friend"), birthday. Enables "my kids" in Ask, and the surprisingly delightful **age caption** — "Arjun, 4 years old" — on every photo, plus a **growing-up timeline** per person (one photo per month/season, chronological).

**How:** two nullable columns on `persons`; the library summary includes relationships; the Viewer caption and person page compute age from `captured_at_precise − birthday`.

**Effort:** small. **Data leaving the machine:** relationship words go to the LLM only as part of the summary; birthdays never leave.

### D. Captions and keywords (optional analyzer)

**What:** A short caption + keywords per photo ("two children building a snowman in a garden"), indexed into full-text search so text queries work without CLIP and so Ask can answer from words alone.

**How:** the `caption` analyzer from the original design §11: a vision-language model — **local** (a small VLM through the sidecar; Moondream-class models run on CPU at a few seconds per image, fine as a background backfill) or **cloud** (Claude vision). Run on demand for a selection/folder/favourites first; whole-library is an explicit choice because of cost/time. Output to `media_captions(media_id, model, caption, keywords_json)` and into `media_fts`.

**When it earns its keep:** text-only retrieval without the sidecar running, album naming ("Snow day, Feb 2019"), and richer Ask answers. Not required for A — CLIP already covers content queries.

**Effort:** medium. **Data leaving the machine:** pixels, if the cloud option is chosen — labelled as such.

### E. Filtered semantic ranking (infrastructure)

**What:** "Rank *these* ids by similarity to a text or image vector." Today semantic search ranks the whole index.

**How:** for candidate sets up to ~20k, brute-force cosine over vectors read from `media_embeddings` (SQLite) — milliseconds. Above that, LanceDB's `where id IN (…)` pre-filter. One function on `VectorIndex`/`EmbeddingRepo`; used by A and by "Find similar within this folder/person".

**Effort:** small.

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

### G. Light editing — non-destructive

**What:** Rotate, flip, straighten, crop (free/fixed ratios), exposure/contrast/white-balance sliders, and one-click "auto". Enough to fix a tilted horizon or crop a scan; not a Lightroom.

**How:**
- **Recipe, not pixels.** An `edits` table: `media_id`, `recipe_json` (ordered ops), `version`, `updated_at`. The Viewer renders the recipe on the fly with Sharp (`rotate`, `extract`, `modulate`, `linear`, `gamma`) from the analysis input tier (1600 px preview for RAW, original for JPEG) — fast enough interactively at preview size.
- The grid thumbnail regenerates from the recipe (bump `thumbnail_version`, existing cache-busting works).
- **Export** writes a new full-resolution JPEG to `<original folder>/_MemoryLane-Edits/<name>-edited.jpg` (mirroring the transcode archive convention), which the scanner then indexes as a normal photo paired to its source via a `derived_from` column (shown in the stack with the original). Originals untouched; RAW exports render from the embedded preview unless `dcraw`/`libraw` is added later (open decision).
- "Reset" deletes the recipe.

**Effort:** medium. **Data leaving the machine:** none.

### H. Collages, cards and slideshows

**What:** Make something from a selection or an Ask result: a grid/mosaic collage, a "Year 2016" poster, a birthday/holiday card with a caption, and an **MP4 slideshow** with Ken Burns motion and captions (people, place, date).

**How:**
- Collages/cards: Sharp compositing from a small set of templates (grid, masonry, polaroid scatter, poster with title). Export PNG/JPEG/PDF to `<data-dir>/creations/` and offer "save next to…" into the library's `_MemoryLane-Creations` folder so it gets indexed.
- Slideshows: **ffmpeg is already bundled** (`ffmpeg-static`) — zoompan + xfade filters produce a 1080p/4K H.264 slideshow from the rendered frames in seconds per minute of output. Music is user-supplied (no bundled audio, no licensing question).
- Selection model: the folder "Select" mode grows a **Create…** menu; Ask results and person/year pages get the same.

**Effort:** medium. **Data leaving the machine:** none.

### I. Fun AI transformations (holidays, styles) — opt-in

**What:** "Turn this into a watercolour", "add falling snow", "make a Diwali card from this photo", "swap the background for the Northern Lights". Generated images are always **new files labelled as AI-modified**, never replacing anything.

**How — a provider, because the honest answer is that this needs a big model:**
- **Cloud image editing/generation provider** (hosted image models with edit/inpaint endpoints): best quality, minutes to integrate, **sends the photo's pixels** to the provider; per-image cost; may include faces — so this sits behind the People-style opt-in and shows a per-request "this photo will be sent to X" notice.
- **Local** (Stable Diffusion / FLUX-class models via the sidecar with a diffusers backend): private, free per image, but needs a real GPU (8 GB+ VRAM for practical speed) and 5–10 GB of weights. Offered as an advanced option on machines that can run it.
- Output goes to `_MemoryLane-Creations/` with an `ai_generated` flag and provenance (source photo, prompt, model) stored in a `creations` table; the grid badge says **AI**.

**Effort:** medium (cloud) / large (local). **Data leaving the machine:** pixels, for the cloud option — explicitly consented per use.

---

## 3. Architecture additions

| Addition | Where | Notes |
|---|---|---|
| `LlmProvider` (chat + tool calling) | `server/src/providers/llm/` | Claude, OpenAI-compatible, local. Same shape as the AI sidecar provider: health, config in Settings, clear "what is sent". |
| `ImageEditProvider` | `server/src/providers/image/` | Cloud edit/inpaint or local diffusers via the sidecar. Phase 8 only. |
| `places` analyzer + bundled geodata | `server/src/analysis/analyzers/places.ts`, `server/data/geonames/` | Offline; adds columns to `media_exif`. |
| `quality` analyzer | `analyzers/quality.ts` | Sharpness/exposure from the thumbnail; in-process. |
| `caption` analyzer | `analyzers/caption.ts` | Optional; local VLM or cloud vision. |
| `edits`, `creations`, `derived_from` | migrations | Recipes and provenance; exports are normal indexed media. |
| Filtered ranking | `vectors/` | `rankByText(ids, text)`, `rankByVector(ids, v)`. |
| Ask routes + page | `api/ask-routes.ts`, `client/src/pages/AskPage.tsx` | Tool loop server-side; streaming optional later. |
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

---

## 5. Suggested order

| Phase | Contents | Why this order |
|---|---|---|
| **5 — Ask** | E (filtered ranking), B (places), C (relationships/age), `LlmProvider` (cloud + local), Ask page | Highest value per effort; makes decades of data *reachable*. Places and age captions are visible wins on their own. |
| **6 — Mining** | quality analyzer, Year in review, Best of, growing-up timelines, then & now, trips, slideshow export (ffmpeg) | Pure exploitation of data now in place; slideshow is the first "make something" feature and needs no new model. |
| **7 — Editing & creations** | non-destructive edits, exports, collages/cards, Create menu | Self-contained; Sharp only. |
| **8 — AI transformations** | `ImageEditProvider` (cloud first, local for GPU owners), provenance, AI badge | Last because it is the only feature that must send pixels away or needs a GPU; the consent UX from People is reused. |
| optional | D (captions) | Slot in after 5 for users who want text-only retrieval or album naming. |

---

## 6. Open decisions

1. **First LLM provider for Ask** — cloud (Claude/OpenAI) for best query understanding, or local-only to keep the zero-egress promise? Recommendation: build the abstraction, ship both, default to "not configured".
2. **RAW exports in editing** — embedded-preview quality (simple) or a real RAW decode (adds `libraw`)? Recommendation: preview quality in Phase 7, revisit if photographers ask.
3. **Where creations live** — data dir only, or also offered "save into the library" so they appear in Browse? Recommendation: both, default data dir.
4. **AI transformations provider** — which hosted image model(s), and whether to gate face-containing photos more strictly. Decide at Phase 8 with the market at that time.
5. **Geodata licensing** — GeoNames is CC BY 4.0: attribution text in Settings › About is sufficient.
