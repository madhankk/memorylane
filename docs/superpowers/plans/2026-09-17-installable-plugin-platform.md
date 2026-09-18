# MemoryLane Small Core and First-Party Plugin Plan

**Status:** Approved for phased implementation. Phases 1 and 2 are complete. Stop after every phase for review.

## Goals

1. Keep each signed core desktop installer below **200 MiB**.
2. Make the first download small while retaining account setup, standard-image browsing, and plugin installation in core.
3. After the first login, install the required Metadata & RAW and Video Tools components before entering the normal application.
4. Let users install only the optional AI Search & Similar, People, and Apple Photos features they want.
5. Install, start, stop, restart, update, roll back, and remove plugins without teaching the desktop installer about individual plugins.
6. Auto-update core and plugins independently, subject to compatibility and safe job boundaries.
7. Produce a complete static plugin repository directory that can be copied by SFTP or rsync to a Linux HTTPS server.

This is a first-party component system used to split a monolithic application. It is not a public extension marketplace or an untrusted-code sandbox.

## Current baseline

Windows x64 measurements from 2026-09-17:

- `MemoryLane-Setup.exe`: 431.8 MiB compressed.
- Prepared server runtime: 932.5 MiB unpacked.
- `app.asar`: 3.8 MiB after removing a duplicate runtime copy.
- Major removable payloads include LanceDB 274.1 MiB, ONNX Runtime Node 183.6 MiB, ONNX Runtime Web 92.3 MiB, FFmpeg 79.1 MiB, FFprobe 60.1 MiB, Hugging Face packages 37.2 MiB, and ExifTool 31.2 MiB.
- Electron contributes roughly 228 MiB unpacked on the measured Windows build.

The plugin split removes the largest feature-specific payloads. Phase 10 measures Electron against a native Go tray because the desktop shell only needs to supervise the server and open the browser; it does not need a webview.

## Agreed product split

| Component | Availability | Contents | Behavior when absent |
| --- | --- | --- | --- |
| Core / Media Essentials | Always installed | Authentication, catalog, filesystem scan, standard JPEG/PNG/WebP/BMP processing, orientation, thumbnails, pHash, browsing, plugin manager | Application can set up an account and manage plugins |
| Metadata & RAW | Required after login | ExifTool, full metadata extraction, RAW previews, metadata analysis used by Reports | Onboarding cannot complete; originals remain untouched |
| Video Tools | Required after login | FFmpeg, FFprobe, poster extraction, duration probing, modernization/transcoding | Onboarding cannot complete; originals remain untouched |
| AI Search & Similar | Optional | CLIP image/text embeddings, semantic search, similarity, optional stack refinement | Normal browsing, reports, and time/hash stacks continue |
| People | Optional | Face detection, embeddings, grouping, and People analysis | No People navigation or biometric processing |
| Apple Photos | Optional, macOS only | Catalog helper, sync, Apple person suggestions, Open in Photos | Ordinary folder libraries continue |
| AI Runtime | Internal dependency | Shared inference runtime used by AI Search and People | Installed automatically when either dependent feature is selected |

Metadata & RAW and Video Tools are required components, but they are downloaded after login rather than shipped in the core installer. AI Search, People, and Apple Photos remain optional.

Media Essentials stays in core because standard image browsing is the useful baseline and moving it would make the initial application little more than an installer.

## Architecture decisions

### Core ownership

Core owns:

- Account setup, authentication, sessions, and browser-facing `/api/*` routes.
- The main `memorylane.sqlite` connection and every write to that database.
- Media identity, scan roots, folders, engagement, existing feature tables, and original-file safety rules.
- Standard image processing and basic scanning.
- Plugin catalog loading, verification, installation, activation, supervision, updates, rollback, and removal.
- The plugin SDK, capability registry, onboarding, and Plugins settings UI.
- Core update coordination and desktop/tray lifecycle.

The browser never receives a plugin URL or launch token and never calls a plugin process directly. It continues to call stable core APIs.

### Database boundary: no schema change now

The plugin architecture introduces **no core SQLite migration at this time**.

- Plugins never open `memorylane.sqlite` directly.
- Plugins send validated results to versioned, scoped core APIs.
- Core repositories apply those results to existing tables inside core-owned transactions.
- Existing `plugin_settings`, `apple_photos_*`, `media_embeddings`, `persons`, and `faces` tables remain unchanged during extraction.
- Existing People names, assignments, dismissals, and corrections remain durable core data.
- Existing Apple Photos asset and sync records remain in the main database because core features join them to media, tags, locations, and People.
- AI and face vectors may move to private plugin storage in a later, separately reviewed optimization. They do not move as part of the initial extraction.

If a future feature needs a new main-database table, a normal core release owns that migration. Plugin packages do not ship migrations for the main database. A plugin may independently migrate its own private SQLite database.

### Durable plugin state

Installed versions, active-version pointers, desired enabled state, last errors, and onboarding completion live in a versioned JSON state file under the fixed plugin-support directory. Writes use temporary files and atomic replacement. At startup, the manager reconciles this state with immutable version directories and ignores incomplete or invalid folders.

Process IDs, ports, bearer tokens, restart counts, progress, and health timestamps are observed state kept only in memory. Interrupted downloads and staging folders are disposable and cleaned during recovery.

### Execution modes

The generic host supports three package entry types:

1. **Module:** Bundled JavaScript loaded into one separate shared module-host process and called over process IPC. TypeScript plugins ship compiled bundles, not source trees.
2. **Service:** A self-contained persistent executable managed by core and reached through authenticated loopback HTTP. AI and Apple Photos fit this mode.
3. **Command:** A self-contained executable launched for one operation. FFmpeg, FFprobe, and ExifTool adapters fit this mode.

First-party TypeScript modules bundle their production dependencies into their plugin artifact. They do not ship an ordinary development `node_modules` tree and do not rely on undeclared packages from core. The small SDK contract is the only shared code-level dependency.

### Managed localhost service security

For every service launch, the supervisor:

- Allocates a random port bound strictly to `127.0.0.1`.
- Generates a new cryptographically random 256-bit bearer token.
- Passes the port, token, plugin ID/version, plugin API version, data directory, log directory, and core version through the child environment.
- Starts the executable directly with an argument array and `shell: false`.
- Requires the token on health, work, and shutdown requests.
- Accepts readiness only when health returns the matching plugin ID, version, and protocol version.
- Captures stdout/stderr, applies request limits and timeouts, and uses bounded restart backoff.
- Attempts graceful shutdown and then terminates the owned process tree.
- Never places tokens in URLs, browser responses, logs, or durable state.

Random ports and tokens prevent websites and unrelated localhost applications from calling a plugin. Software already executing as the same OS user remains inside the operating system account’s trust boundary.

### Installation locations

Plugin code and mutable data remain separate:

- Windows code/state: `%LOCALAPPDATA%\MemoryLane\Plugins\...`
- macOS code/state: `~/Library/Application Support/MemoryLane/Plugins/...`
- Mutable data: `<configured-data-dir>/plugin-data/<plugin-id>/`
- Plugin logs: `<configured-data-dir>/logs/plugins/<plugin-id>/`

Immutable code uses `<plugin-id>/<version>/` directories. Models, indexes, caches, and private plugin databases use the movable data directory when they are mutable or rebuildable. Removing a plugin preserves its data by default; “remove plugin and data” is a separate explicit action.

The application itself stays in the normal platform location. A Windows per-user installer under `%LOCALAPPDATA%` is acceptable. macOS uses `/Applications` or `~/Applications`. Plugins never modify the signed application bundle.

### Package and catalog format

Each `.mlplugin` file is an immutable, platform-specific archive produced by CI. Installation never runs `npm install`, `pip install`, or another package manager on the user’s machine.

```text
manifest.json
dist/                  # bundled JavaScript, when applicable
bin/                   # service or command executables
licenses/              # notices for this artifact
package-signature.json # optional human-readable signature metadata
```

The manifest declares plugin identity and version, plugin API and compatible core versions, platform and architecture, required status, entry type, capabilities, dependencies, health/restart rules, and license files. Every declared package path is normalized and relative.

The catalog maps each plugin/version/platform to a relative artifact URL, compressed and installed sizes, SHA-256 digest, Ed25519 signature, release notes, mandatory-update status, and compatibility metadata.

Catalog signatures cover the exact `catalog.json` bytes. Artifact signatures cover the raw SHA-256 digest bytes so large packages can be verified as streams. Production embeds the release public key in core. A separately configured key and HTTP loopback catalog are permitted only for development.

### Static plugin repository

The repository build creates a complete directory suitable for SFTP/rsync publication:

```text
dist/plugin-repository/
└── v1/
    ├── stable/
    │   ├── catalog.json
    │   ├── catalog.json.sig
    │   ├── release-manifest.json
    │   └── artifacts/
    │       └── <plugin-id>/<version>/<platform>.mlplugin
    └── beta/
        └── ...
```

`release-manifest.json` records every relative path, byte length, and SHA-256 digest. Catalog files use `Cache-Control: no-cache`; versioned artifacts are immutable and receive long-lived cache headers.

Publishing uploads artifacts and metadata to a sibling staging directory, verifies remote sizes and hashes, and atomically renames the finished directory. The catalog and its detached signature become visible last. The Linux server needs only HTTPS-capable static hosting; it has no registry application or database. The private Ed25519 signing key stays in CI secrets and is never uploaded.

## User flows

### First login and required components

1. Core starts and allows initial administrator creation and login without plugins.
2. After the first successful login, incomplete onboarding redirects to `/welcome/plugins`.
3. The screen shows Metadata & RAW and Video Tools as required and selected.
4. It offers AI Search & Similar, People, and Apple Photos where supported. Selecting AI or People adds AI Runtime automatically.
5. It shows individual and total download sizes, installed sizes, disk requirements, license notes, and feature summaries.
6. It reports download, verification, installation, start, and health progress.
7. Continue becomes available only when both required plugins are healthy. Optional failures can be retried or skipped.
8. Completion is written to the JSON plugin state. Settings → Plugins remains the permanent management screen.

The first release may require internet access during onboarding. If the catalog is unavailable, the screen explains the requirement and offers Retry. Offline `.mlplugin` import remains compatible but is not required unless selected as a release policy below.

### Install and activation transaction

1. Resolve the release and dependency graph from the already verified catalog.
2. Stream to the fixed plugin-support download directory as a unique `.partial` file with a byte limit, cancellation, and progress.
3. Verify expected length, SHA-256, artifact signature, platform, architecture, plugin API, core range, and dependencies.
4. Extract into a unique staging directory while rejecting traversal paths, symlinks, and expansion beyond declared installed size.
5. Parse the embedded manifest and require it to match the signed catalog entry.
6. Atomically rename staging to the immutable version directory.
7. Start the module/service or validate command entries. A service must pass its authenticated identity health check.
8. Atomically switch desired and active state only after activation succeeds.
9. On update failure, stop the failed version and reactivate the previous healthy version. Plugin-private data is backed up by that plugin before an incompatible private-schema change.

There is no main SQLite migration step in this transaction.

### Updates

**Core:** Download a signed update in the background, show release notes, and apply after an explicit Restart and Update or according to the selected exit policy. Unsigned development builds do not update.

**Plugins:** Check the signed catalog after startup and daily. Download compatible updates in the background. Wait for active plugin jobs to reach a persisted safe boundary, stop the old version, activate the new one, and roll back after failed health. Ordinary updates follow the chosen user policy; required security updates may be marked mandatory.

Before applying a core update, resolve compatibility against installed plugins. Install compatible plugin updates first. Hold a core update if a required plugin has no compatible version. Disable an incompatible optional plugin only after warning the user.

## Desktop shell decision

The production implementation is a pure-Go native tray and process supervisor. MemoryLane's browser UI remains browser-served, so neither an embedded Chromium runtime nor a system webview is required.

After required and optional payloads leave core:

1. Measure the signed Electron core installer, startup time, and idle memory.
2. Build a Go proof of concept that launches the existing Node core, manages the tray, opens the browser UI, and shuts down the process tree.
3. Compare Windows and macOS behavior, signing/notarization, updater support, size, and memory.
4. Migrate only if the measured saving justifies completing native update and launch-at-login integration.

Rewriting the Node server in Rust is out of scope.

## Phased implementation

### Phase 0 — Reproducible size baseline *(complete; final gate activates after extraction)*

- [x] Remove the duplicate runtime from `app.asar` and measure the current Windows package.
- [x] Add a package-size report covering installer, unpacked app, desktop shell, core runtime, and largest dependencies.
- [x] Check in the measured Windows x64 baseline; macOS measurements are emitted as CI artifacts because they require native runners.
- [x] Add CI size artifacts, a 180 MiB warning classification, and a 200 MiB enforcement mode. The blocking invocation is enabled after Phase 6 removes the remaining AI/Lance payload.
- [x] Use versioned/overridable release output and exclude release, runtime duplication, and generated plugin repositories from packaged application contents.

**Exit:** Anyone can reproduce and compare a clean core package measurement.

### Phase 1 — SDK and contracts *(complete)*

- [x] Add `@memorylane/plugin-sdk` with strict manifest/catalog schemas, lifecycle types, capability types, compatibility helpers, and safe package-path rules.
- [x] Add SHA-256 and Ed25519 verification helpers.
- [x] Test malformed manifests, version/platform incompatibility, duplicate releases, traversal paths, digests, and signatures.

**Exit:** Core and first-party plugins compile against one implementation-independent contract.

### Phase 2 — Generic installer and process runtime *(complete)*

- [x] Add atomic JSON state and filesystem reconciliation without a database migration.
- [x] Add signed catalog loading with configurable development keys.
- [x] Add bounded streaming download, cleanup, verification, safe extraction, staging, activation, uninstall, and rollback primitives.
- [x] Add shared module-host IPC, command execution, and managed authenticated HTTP services.
- [x] Add random ports/tokens, health identity checks, logs, timeouts, graceful shutdown, process-tree cleanup, restart backoff, and operation exclusion.
- [x] Add authenticated generic inventory/install/enable/disable endpoints alongside the legacy Apple endpoint.
- [x] Test state recovery, signed catalogs, package installation, module calls, command execution, and a real authenticated child service.

**Exit:** Generic infrastructure can install and run signed first-party packages without changing the desktop installer or core schema.

### Phase 3 — Repository builder and release-size measurement *(complete)*

- [x] Add a package-size reporter, checked-in Windows baseline, CI artifacts, 180 MiB warning threshold, and dormant 200 MiB enforcement switch. Activate the blocking switch after Phase 6 removes the remaining AI/Lance payload.
- [x] Add a portable module fixture for every declared target platform; command and real child-service lifecycle fixtures remain covered by Phase 2 runtime tests.
- [x] Add `plugins:build -- <channel> [development]` for the standard Windows/macOS release set, with direct-builder platform overrides, to assemble deterministic immutable artifacts, catalog, detached signature, and release manifest.
- [x] Add `plugins:verify <repository-dir>` using only the public key, including complete-file, digest, signature, embedded-manifest, archive-safety, and installed-size checks.
- [x] Generate the production Ed25519 keypair locally, gitignore the private key, and embed/commit only the public key. Copying the private PEM into the CI secret store is an external release-administration step.
- [x] Produce `dist/plugin-repository/v1/{stable,beta}` as the shippable layout; generated output remains gitignored.
- [x] Add the SFTP/rsync deployment and static-server cache configuration runbook.
- [x] Add CI construction and verification of a development-signed Windows/macOS fixture repository, and verify that artifact tampering is rejected.

**Exit:** A clean static repository can be built, verified, uploaded to Linux, and consumed by core without access to source registries.

### Phase 4 — Capability APIs and extraction boundaries *(complete)*

- [x] Define versioned core↔plugin contracts for metadata, RAW preview, video probe/poster, transcode, embeddings, faces, vector operations, and external scan sources.
- [x] Define scoped core write APIs for existing tables. Validate ownership, media IDs, batch size, dimensions, and request schemas in core.
- [x] Keep original-file lookup, scan-root containment, opaque source authorization, archive authorization, conflict checks, and rescan decisions in core.
- [x] Refactor scanner, media processing, transcode work, and analysis queues to call capability/provider interfaces without moving implementations yet.
- [x] Return queued work to pending while a capability is stopped or updating instead of marking it failed.
- [x] Add behavior-equivalence, contract, ownership, token-isolation, and stopped-capability fixtures before extracting code.
- [x] Add a core dependency denylist for feature-specific native packages and run it with typechecking.

**Exit:** Current in-core implementations run through the same capability boundaries future plugins will use.

### Phase 5 — Required Metadata & RAW and Video Tools plugins *(complete)*

- [x] Package ExifTool, full metadata extraction, RAW embedded previews, and metadata analysis as Metadata & RAW.
- [x] Preserve existing Reports DTOs and behavior through core-owned tables and promotion APIs.
- [x] Package FFmpeg, FFprobe, poster/duration probing, and transcode execution as Video Tools.
- [x] Preserve the modernization safety invariant: core validates the source and destination, and archiving only moves the reviewed original into `_MemoryLane-Archived-Originals`.
- [x] Add target-native Windows/macOS signing and macOS notarization release steps for plugin executables and artifacts; execution requires the release credentials on each platform runner.
- [x] Remove ExifTool, FFmpeg, and FFprobe from the core production dependency/runtime build.
- [x] Publish both plugins as required signed catalog components, with target-platform CI builds and optional bundling of the identical repository artifacts.

**Exit:** Required artifacts restore current metadata, RAW, video, Reports, and modernization behavior while those binaries are absent from core.

### Phase 6 — Optional AI Search & Similar and People

- [x] Package the shared internal AI Runtime once per platform.
- [x] Package AI Search & Similar and People as separate optional feature plugins depending on AI Runtime.
- [x] Move LanceDB, ONNX runtimes, Hugging Face packages, models, and vector-index files out of core.
- [x] Extend the AI service contract to own vector upsert/delete/search/count/rebuild.
- [x] Retain current `media_embeddings`, `persons`, `faces`, assignments, names, dismissals, and corrections in core for this extraction.
- [x] Keep rebuildable vector indexes and model caches in plugin-private storage.
- [x] Remove direct `LanceVectorIndex` construction and all AI native dependencies from core.
- [x] Hide or offer installation for AI and People UI when capabilities are unavailable.

Windows verification: the unpacked core package is 505.7 MiB, including a 141.3 MiB server runtime and Electron/Chromium. The optional compressed AI Runtime artifact is 59.3 MiB. Squirrel was intentionally not run; installer-size enforcement remains pending an installer build.

**Exit:** Core contains no AI runtime, model, LanceDB, or face-inference payload; installing either feature restores its behavior.

### Phase 7 — Optional Apple Photos

- [x] Package the former helper as a signed, self-contained macOS service with no user-managed Python, virtual environment, or pip step.
- [x] Move detection, catalog reads, and Open in Photos implementation into the plugin; core retains validated sync writes.
- [x] Keep existing Apple tables in core and write them only through scoped core APIs.
- [x] Preserve read-only behavior toward the Photos library and the existing visibility rules when disabled.
- [x] Keep existing `scan_roots.kind = 'apple-photos'` compatibility; do not generalize the database constraint during this extraction.
- [x] Remove the standalone helper command, token file, fixed port, virtual environment, and Apple detection/automation implementation from core.

**Exit:** Apple code and dependencies exist only in the optional macOS artifact, with existing indexed data preserved.

### Phase 8 — First-login onboarding and Plugins settings

- [x] Add onboarding state to authenticated bootstrap and redirect incomplete first-login sessions to `/welcome/plugins`.
- [x] Build required/optional selection, disk checks, license notes, progress, retry, and optional-skip behavior.
- [x] Require healthy Metadata & RAW and Video Tools before Continue.
- [x] Offer the now-published AI Search, People, and Apple Photos artifacts during initial selection on supported platforms.
- [x] Build generic Settings → Plugins cards, install/update/disable/remove actions, logs, and error recovery.
- [x] Keep theme controls quickly accessible and preserve the existing tabbed Settings organization.
- [x] Add capability-aware navigation for People.
- [x] Ensure only authenticated users can mutate plugins while clients can observe inventory and progress.
- [x] Retire the legacy Apple-only plugin toggle from the UI after equivalent generic behavior exists.

**Exit:** A clean user can create an account, install required components, choose optional components, and enter the application without terminal commands.

### Phase 9 — Independent updates and recovery

- [x] Download core installers from an Ed25519-signed manifest, verify their digest, and launch them only at a safe update boundary.
- [x] Add daily plugin catalog checks, compatibility resolution, background download, safe-boundary activation, health rollback, and update history.
- [x] Prevent core update application while plugin installation, scans, transcodes, or Apple Photos sync are active.
- [x] Retain active and prior plugin versions for rollback; core updates remain installer-managed and independently signed.
- [x] Test offline startup, interrupted download cleanup, bad/revoked signatures, downgrade attempts, incompatibility, and health rollback.

**Exit:** Core and plugins update independently without manual downloads or terminal commands.

### Phase 10 — Desktop shell measurement and decision

- [x] Measure the final extracted Electron core.
- [x] Build the narrow Go native-tray proof of concept described above.
- [x] Compare package size, startup, idle memory, Windows/macOS behavior, updater behavior, signing, and notarization requirements.
- [x] Record the decision: proceed toward Go after native update, launch-at-login, signing, and macOS validation are complete.

Windows result: Electron is 505.7 MiB unpacked versus 144.6 MiB for the same runtime with the Go tray, a 361.1 MiB (71.4%) reduction. The Go application ZIP is 52.6 MiB, its tray becomes ready in 92 ms, and it idles at 12.0 MiB working set. See `docs/phase10-desktop-shell-decision.md` for the complete comparison and migration gates.

**Exit:** The desktop shell choice is supported by measurements from the extracted application.

### Phase 11 — Release hardening

- [ ] Test core-only setup, required-only setup, each optional plugin, and all plugins.
- [ ] Run clean-machine Windows and macOS install, login, onboarding, scan, reboot, crash/restart, update, rollback, and uninstall tests.
- [ ] Verify signatures/notarization for core and every executable in every artifact.
- [ ] Generate separate third-party notices for core and each plugin.
- [ ] Reconstruct and serve the repository from CI artifacts without npm, Python, or source-tree access.
- [ ] Block release unless every signed core installer is below 200 MiB and clean onboarding downloads only the two required components plus their declared dependencies.
- [ ] Update user and deployment documentation.

## Testing strategy

- **SDK:** Schema, path, compatibility, digest, signature, and duplicate-release tests.
- **Runtime:** Atomic state, reconciliation, cancellation, safe extraction, expansion limits, authentication, health identity, restart, shutdown, and operation locking.
- **Contracts:** Every first-party plugin runs against the published SDK and core API version.
- **Behavior equivalence:** Existing EXIF/RAW, video, Reports, AI, People, and Apple Photos fixtures pass before and after extraction.
- **Packaging:** Assert forbidden packages and binaries are absent from core, launch packaged artifacts, and exercise native bindings.
- **Failure injection:** Terminate core or plugins during download, extraction, activation, update, and health check; the next startup must converge to the prior or new valid version.
- **Release repository:** Verify every path, size, digest, signature, compatibility declaration, and platform artifact from the static output.

## Core dependency denylist after extraction

The final core package must not contain:

- `@lancedb/*`, `onnxruntime-*`, `@huggingface/*`, or AI model weights.
- FFmpeg or FFprobe executables.
- ExifTool or its Perl distribution.
- `osxphotos`, a Python virtual environment, or the Apple Photos helper.
- Installed plugin packages, download staging, or plugin-private data.

Sharp and BMP support remain allowed as Media Essentials.

## Material risks

- **Required second download:** Show exact totals, disk needs, resumable progress, and actionable retries.
- **Catalog unavailable during first login:** Preserve account access and present Retry without corrupting onboarding state.
- **Plugin update interrupts work:** Stop at persisted batch boundaries and requeue unfinished analysis.
- **Localhost access:** Require per-launch tokens and identity checks; never rely on loopback binding alone.
- **Core API coupling:** Version contracts and keep extraction tests against existing behavior.
- **Native release matrix:** Build and sign one immutable artifact per supported OS and architecture.
- **Core/plugin incompatibility:** Resolve compatibility before core application and retain rollback versions.
- **Native tray variation:** Test tray behavior, signing, notarization, and launch-at-login on supported Windows and macOS versions before migration.

## Deferred

- Third-party/community plugins and public marketplace publishing.
- Arbitrary untrusted-plugin sandboxing.
- Multiple marketplaces.
- Generic dependency deduplication beyond the explicit first-party AI Runtime package.
- User-authored permissions and approval prompts.
- Delta plugin updates.
- Moving current canonical Apple or People relational tables into private plugin databases.
- Moving embedding BLOBs out of core until a separate measured migration justifies it.
- Offline `.mlplugin` import unless selected for the first release.
- Rewriting the Node server in Rust.

## Remaining release-policy decisions

1. Should core updates download automatically and wait for Restart and Update, while plugin updates activate automatically at safe job boundaries?
2. Must first onboarding support offline `.mlplugin` import, or may it require internet access?
