# Offline Location Map Design

**Status:** Approved direction in conversation, 2026-09-16. The navigation and time filter refinements were approved in the same discussion.

## Goal

Let people explore where their photos were taken without sending photo coordinates to a map service. The first release provides a bundled offline world map, a density view that remains useful for very large libraries, a time range control, and a way to open the photos represented by a location. It includes Apple Photos catalog entries with coordinates even when their image is unavailable locally.

## Existing data and backfill

Ordinary media already stores `gps_lat` and `gps_lon` from EXIF in `media`; `media_exif` retains the promoted EXIF coordinates. Apple Photos sync stores coordinates for indexed media and has dedicated `catalog_gps_lat` and `catalog_gps_lon` columns on `apple_photos_assets`. The current library has 2,574 filesystem media rows and 5,995 indexed Apple media rows with valid coordinate pairs. All 7,797 Apple catalog rows currently have empty dedicated catalog-coordinate columns; the last full Photos sync preceded that migration. A new Photos sync must fill whatever coordinates the helper reports, including catalog-only items. No filesystem rescan or embedding rebuild is needed for the coordinates already in `media`.

The map uses one point per asset. Filesystem media uses `media.gps_lat/lon`. Apple assets use the Photos catalog coordinates when present, falling back to their linked media coordinates. This gives Photos-adjusted locations precedence without changing originals or EXIF. A catalog-only Apple asset is identified by its library/root and Photos UUID, so linking a local image later cannot create a second point. Rows without both finite, in-range coordinates do not appear on the map. Date precedence follows the same pattern: Apple catalog date, then linked media capture date; filesystem capture date comes from `media`.

## Offline map and interaction

Bundle a small [Natural Earth land outline](https://www.naturalearthdata.com/downloads/110m-physical-vectors/) with the client; [Natural Earth's terms](https://www.naturalearthdata.com/about/terms-of-use/) place its map data in the public domain. The map makes no runtime request for tiles or geocoding. It supports pan, zoom, pointer and keyboard controls, and a density layer. At broad zoom, nearby assets combine into count-weighted cells; zooming in separates them into smaller cells and individual points. The density legend explains that color represents photo count. Selecting a cell opens a paginated result panel with a count, photo previews, and a link to the normal Viewer. Catalog-only Apple entries display their date/name and **Open in Photos**; the UI never implies that their image is viewable in MemoryLane.

A compact year histogram and inclusive start/end year handles filter the map as the user changes them. Clearing the range restores all geotagged assets. Items without a date appear in the unfiltered map and are excluded while a year range is active. Source filters allow filesystem and Apple Photos to be shown separately or together. The map reports its visible count and an empty state when filters return no located items. Tag and person filters can be added later using the same location query service.

## Query and scale

An authenticated location service combines normal media and Apple catalog assets. It applies the same active-media, deletion-mark, plugin, root, hidden, and trash visibility rules as ordinary browsing. The server returns a year histogram and source counts, plus bounded map cells for the current viewport and zoom. Cell keys are derived from normalized longitude and Web Mercator latitude; validation handles the antimeridian and polar clamp. The client receives aggregates for dense areas rather than every coordinate in a large library. A separate paginated cell-items route resolves a selected cell to linked media or catalog-only Apple entries. Counts and selection use the same filters and point identity, so displayed totals agree with opened results.

Indexes support coordinate and year filtering where needed. The first implementation can group coordinates in SQLite for each viewport; performance tests with a large synthetic library determine whether cached spatial buckets are necessary. The service never writes location values during map requests. A Photos sync updates catalog coordinates through the existing sync path and the next map request sees them.

## Navigation

Keep **Browse**, **Favorites**, **Library**, **Settings**, and search in the top bar. The single **Library** menu contains **Locations**, **People**, **Tags**, **Reports**, and **Cleanup**. It works with mouse, touch, and keyboard, exposes the active destination, and remains usable at narrow widths. Existing routes and deep links continue to work.

## Boundaries and follow-up

The first map has geographic outlines but no street-level detail, place-name search, or remote tiles. Its time filter uses capture dates, not file modification dates. Reverse geocoding, trip grouping, and animated playback are later additions. AI tag quality is a separate follow-up: current CLIP similarity scores are heuristic, and removing an incorrect AI tag already suppresses it from later regeneration. AI tags do not affect map placement.

## Verification

Tests cover coordinate validation, source/date precedence, Photos UUID deduplication, visibility after marks or plugin disable, catalog-only entries, time-range boundaries and unknown dates, cell aggregation, and paginated cell results. Client checks cover Library-menu keyboard access, map pan/zoom, year-range changes, cell selection, and opening linked versus catalog-only results. Manual verification uses a synced Apple library and a filesystem folder with known GPS coordinates, including a Photos resync after the catalog-coordinate migration. The production build must make no runtime map-network request.
