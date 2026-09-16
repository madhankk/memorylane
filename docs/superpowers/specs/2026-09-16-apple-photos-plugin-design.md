# Apple Photos Plugin — First Release Design

**Status:** For user review — 2026-09-16

**Supersedes for implementation:** the plugin lifecycle and sidecar assumptions in `docs/superpowers/plans/2026-09-15-apple-photos-plugin.md`. That plan must be revised before code work.

**Roadmap:** `docs/architecture/2026-09-15-photo-mining-roadmap.md`, item M.

## Goal and release boundary

A Mac user can opt in to a shipped Apple Photos plugin, add a `.photoslibrary` package, and browse its local originals and available iCloud previews in MemoryLane. Import is read-only toward Photos. It brings over adjusted dates, display filenames, location, camera summary, favourites, keywords, and named-face suggestions. It shows when an original is unavailable and offers **Open in Photos**. Disabling the plugin immediately stops its work and makes all Apple-sourced media inaccessible through MemoryLane, while preserving its index for re-enabling.

The first release **does not** import Apple albums, because MemoryLane has no virtual-albums data model yet. It also defers the optional PhotoKit **Download original** helper; that is a separate native desktop capability. Both remain follow-up work, not silently completed parts of item M. This release does not build a third-party plugin marketplace.

## Plugin lifecycle

The server gains a small first-party plugin registry: static, cheap manifest metadata; a persisted `enabled` bit (off by default); platform availability; optional helper status; and lazily loaded server entry points. Each shipped plugin can provide guarded routes, a scan-root kind, and a settings view. Fastify registers only lightweight route guards at startup; the Apple implementation is dynamically imported on first enable, not registered after the server starts. Apple Photos is registered only as metadata on Windows/Linux and is unavailable there. The Apple implementation and `osxphotos` are not imported, probed, or started when disabled.

Enabling on macOS activates the Apple routes and root kind and exposes its settings view. Disabling rejects new Apple operations, cancels an in-progress Apple sync at the next asset boundary, prevents any new Apple analysis work, and makes Apple-sourced media invisible in listings and unavailable by direct id, file, thumbnail, preview, face-crop, search, and related routes. The current page refreshes to clear already displayed assets. Plugin state and per-root enabled state remain separate; disabling the plugin retains the root configurations and indexed rows. Re-enabling restores access to still-valid indexed assets and offers a sync to refresh them. A helper started manually can remain idle after disable; Settings explicitly tells the user to stop its terminal command with Ctrl+C. No application request is sent to that helper while disabled.

A cold start with the plugin disabled loads no Apple implementation and runs no Apple work. After a hot disable, JavaScript modules already imported may remain cached until the main server restarts; the separate helper may remain resident until its terminal command is stopped. Settings states those two steps when the user wants to reclaim all memory immediately. Neither process does Apple work while disabled.

Visibility must be enforced centrally, not only by hiding client controls. The media-query builder, direct media resolver, analysis claims, and any media lookups outside the builder use the same active-source rule. Apple thumbnail/file responses use non-persistent caching so disabling cannot be defeated by a long-lived browser cache. Existing generic folder scans skip `.photoslibrary` packages even when their parent folder is a scan root; only the Apple root kind indexes them.

## Helper and setup

Apple Photos uses a **dedicated macOS-only Python helper**, never the AI sidecar. The first release provides one command, `npm run photos-helper`, whose launcher creates an isolated environment and installs the Apple-only dependencies on first use, then starts a loopback-only service. It reports readiness and errors in Settings. It may stay running while the plugin is enabled. The launcher is not run and those dependencies are not installed on Windows or when the plugin is unused. A future desktop packaging pass can bundle and start/stop the helper automatically without changing the plugin protocol.

The helper imports `osxphotos` only for a sync request. It opens/processes the catalogue once per sync and streams asset records in bounded batches to the server; it must not reopen the entire database for every page. The server validates the selected package path and communicates only with the local helper. The helper requires a per-install secret shared through the app data directory (not shown in the browser); it rejects unauthenticated calls even on loopback. Health reports ready or missing dependencies; sync reports permission denial or unsupported catalogue format. Neither helper nor server writes inside a `.photoslibrary` package.

The main server and helper both need filesystem permission for the package: the helper reads the catalogue, while the server reads originals/previews. Settings explains macOS Photos/Full Disk Access requirements for the app or terminal that launched each process. An unreadable library is a visible setup error, not an empty successful sync. No cloud service or SaaS account is involved; all data stays local.

## Import and rescan

The core scan-root seam adds `kind: folder | apple-photos` with the normal folder behavior unchanged. An Apple root is created only from the enabled plugin's settings view. A catalogue sync maps each Photos asset UUID to one stable MemoryLane media row: use the original if present, otherwise an available derivative preview. Derivatives are never blindly indexed as separate photos. If neither is locally available, record an explicit unavailable/skipped state rather than inventing a usable image. The catalogue mapping stores provenance, original availability, Photos identifiers, and the chosen derivative path in MemoryLane-owned tables. Migrations start after the current highest migration (`022`); the old plan's `021` and `022` filenames are invalid.

The original file and package are never modified. Metadata from Photos fills absent or adjusted fields without overwriting a user change. Favourites and keywords are imported; a later Photos sync must not erase a MemoryLane-side user favourite. Hidden/trashed Photos assets are excluded from normal browsing without relying on the not-yet-built housekeeping plugin. Missing or permission-denied syncs do not mark previously indexed Apple assets missing. Rescans reconcile original availability and refresh full EXIF only when a newly available original warrants it; they avoid duplicating assets or resetting unrelated user edits.

Named People are matched only where a Photos face box overlaps a face detected by MemoryLane. Existing explicit user assignments, rejections, and dismissed people win over imported suggestions. People import requires MemoryLane's People feature to be enabled; otherwise the catalogue data is retained for a later bootstrap. No face pixels or names leave the machine.

## Settings and user flow

Settings gains a permanent **Plugins** tab listing shipped plugins and their status. Apple Photos is off by default. Once enabled, **Settings → Plugins → Apple Photos** shows detected libraries and an Add path action, helper health and the exact start/stop command, permission guidance, per-library sync controls and progress, last sync/error, and indexed/preview-only/skipped counts. Windows/Linux show Apple Photos as unavailable without an enable control. Disabling asks for confirmation that Apple media will disappear from MemoryLane until re-enabled; it does not delete the index or Photos files.

The Viewer labels preview-only assets, serves their derivative instead of a missing original, and offers **Open in Photos** with an actionable permission error if macOS Automation access is denied. Full-resolution export is not offered for a preview-only asset until a later PhotoKit download capability exists. Apple-managed assets cannot enter MemoryLane's future trash/delete flow.

## Failure handling and verification

The plugin reports helper-down, permission-denied, unsupported-schema, interrupted-sync, and per-asset mapping failures separately. A failed sync keeps the last successful index usable while the plugin remains enabled. Disabling during sync stops further writes and is safe to retry. No startup path probes the Photos package or starts Python when the plugin is off.

Tests cover off-by-default and Windows behavior; enable/disable access gates across listings and direct routes; ordinary-folder package exclusion; helper authentication and streaming against a small fixture; UUID idempotence; original/derivative selection; metadata and face-assignment precedence; interrupted sync; and no package writes. A manual macOS checklist uses a real library for permission prompts, representative counts, iCloud-preview rendering, Open in Photos, and rescan after an original becomes local. The code must pass server/client typechecks, tests, the production build, and helper tests. The deployment playbook gets a one-command setup and a later-packaging note.
