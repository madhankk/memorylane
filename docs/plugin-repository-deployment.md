# Plugin repository deployment

MemoryLane plugins are served as static HTTPS files. The production server does not need Node, Python, a database, or a registry application.

## Build and verify

CI supplies the Ed25519 private key through `MEMORYLANE_PLUGIN_SIGNING_KEY`. The value may be a PEM string or a path to a protected PEM file.

Generate the release pair once with `npm run plugins:keygen`. The private PEM is written under the gitignored `.keys/` directory; copy it into the CI secret store and retain an offline backup. Commit the generated public PEM and TypeScript public-key module.

Native plugins are prepared and signed on their target operating system before packaging (AI Runtime and Apple Photos only - metadata/RAW and video support are core dependencies now, not plugins, signed as part of the app build itself):

```bash
npm run plugins:prepare-ai-runtime
npm run plugins:prepare-apple-photos
SIGN_RELEASE=1 npm run plugins:sign-native
```

Windows uses the existing Azure Trusted Signing script for every plugin `.exe`. macOS signs executable files, `.node` modules, and dynamic libraries with the configured Developer ID. Submit the resulting macOS `.mlplugin` archives to `notarytool` before publication and retain the notarization results with the release records.

```bash
npm run build --workspace=plugin-sdk
npm run plugins:build -- stable
MEMORYLANE_PLUGIN_PUBLIC_KEY=/secure/plugin-public-key.pem \
  npm run plugins:verify -- dist/plugin-repository/v1/stable/win32-x64
MEMORYLANE_PLUGIN_PUBLIC_KEY=/secure/plugin-public-key.pem \
  npm run plugins:verify -- dist/plugin-repository/v1/stable/darwin-arm64
```

**Each platform gets its own catalog**, in its own subdirectory (`dist/plugin-repository/v1/<channel>/<platform>/catalog.json`, not one shared `catalog.json`) - `win32-x64` and `darwin-arm64` are the standard desktop set (Intel Mac is out of scope for now - see `docs/deployment-playbook.md`); pass `--platforms` to build a different set. This is a deliberate split, not just directory layout: `ai-runtime` and `apple-photos` each ship a real native executable that can only be built on its own target OS/arch (no cross-compiling a PyInstaller binary), so a release is naturally built and published one platform at a time, from that platform's own machine. Because each platform's catalog is entirely separate, that's also a fully independent, self-contained upload - see "Atomic upload" below - with no merge step and no risk of one platform's release silently dropping another's from a shared file.

For local lifecycle testing, insert `development` after the channel name. This creates a temporary keypair and writes only `development-public-key.pem` into each platform's generated directory. Never publish a development repository.

`release-manifest.json` (one per platform directory) records the length and SHA-256 digest of every file published under it.

Set `MEMORYLANE_BUNDLED_PLUGIN_REPOSITORY` to your own platform's directory (e.g. `dist/plugin-repository/v1/stable/win32-x64`) during a desktop build to embed that signed repository, letting a build install from it instead of the network catalog. Since no first-party plugin is `required` anymore (metadata/RAW/video are core dependencies), this only matters for pre-staging the optional AI plugins; leave it unset otherwise.

## Live infrastructure

The production catalog is hosted at `https://memorylaneapp.org/plugins/v1/stable/<platform>/` (and `.../beta/<platform>/`), on the same box as the `memorylaneapp.org` marketing site - see `openlaf.pem` in the deploy credentials for SSH access. `tray-go/scripts/package-windows.ps1` and `package-macos.sh` each already compile their own platform's catalog URL in as `MEMORYLANE_PLUGIN_CATALOG_URL`'s default (`.../stable/win32-x64/catalog.json`, `.../stable/darwin-$ARCH/catalog.json`), verified against the real committed `PLUGIN_RELEASE_PUBLIC_KEY` - a plain packaging run needs no extra configuration. Pass `MEMORYLANE_PLUGIN_CATALOG_URL` at packaging time to point a build at a different catalog instead (a beta channel, a self-hosted mirror); it's also overridable at launch time via the same-named environment variable for local testing (see the dev-mode local-catalog workflow below), which always wins over the compiled-in default.

Directory structure and nginx cache-control rules (below) are already live; only the actual signed catalog/artifact files still need to be uploaded there - see "Atomic upload".

## Atomic upload

Upload each platform into its own new sibling directory, independently of any other platform. Do not modify a live platform directory in place.

```bash
rsync -av --delay-updates dist/plugin-repository/v1/stable/win32-x64/ deploy@memorylaneapp.org:/var/www/memorylaneapp.org/plugins/v1/stable/win32-x64.next/
ssh deploy@memorylaneapp.org 'cd /var/www/memorylaneapp.org/plugins/v1/stable && mv win32-x64 win32-x64.previous && mv win32-x64.next win32-x64'
```

Repeat with `darwin-arm64` in place of `win32-x64` when publishing from a Mac - the two are entirely independent uploads; there's no need to do both together or to have the other platform's build on hand.

Verify the remote files against `release-manifest.json` before the rename. Retain the `.previous` directory until clients have successfully consumed the new catalog. Versioned artifacts are immutable and must never be overwritten; rollback publishes a newly signed catalog that points at a prior version.

With plain SFTP, upload `artifacts/` first, then `release-manifest.json`, and upload `catalog.json` plus `catalog.json.sig` last. Prefer a server-side directory rename because it makes the complete release visible atomically. (No `deploy` user exists yet for this - today's SSH access is the `root` key in the deploy credentials; a dedicated deploy user is future work alongside the actual upload script.)

## Static server headers

Nginx rules, live on `memorylaneapp.org` today (`/etc/nginx/sites-available/memorylaneapp.org`) - the catalog is nested under `/plugins/v1/<channel>/`, not served from the domain root, so the location patterns match on a path segment rather than anchoring to the start:

```nginx
location ~ ^/plugins/.*/(catalog\.json|catalog\.json\.sig)$ {
    root /var/www/memorylaneapp.org;
    add_header Cache-Control "no-cache";
}

location ~ ^/plugins/.*/artifacts/ {
    root /var/www/memorylaneapp.org;
    add_header Cache-Control "public, max-age=31536000, immutable";
}

location /plugins/ {
    root /var/www/memorylaneapp.org;
}
```

Serve only over HTTPS. MIME type is not security-sensitive because clients validate lengths, digests, signatures, manifests, platform, and compatibility before extraction.

## Core update feed

Packaged desktop builds use the Go tray's signed-manifest updater. Set `MEMORYLANE_UPDATE_FEED_URL` while packaging to compile the feed URL into the tray. The manifest is verified with the same Ed25519 key as the plugin catalog (`updater.go`'s `updatePublicKey` is that key's raw bytes, hardcoded - nothing to configure). Generate the platform feed with `npm run desktop:update-manifest -- <installer> <public-url> <output.json>`, which signs with `.keys/plugin-release-private.pem` automatically (override with `MEMORYLANE_PLUGIN_SIGNING_KEY`, same as the plugin catalog). Publish the signed installer before its manifest. MemoryLane verifies the manifest signature and installer SHA-256, downloads in the background, and offers installation only after scans, transcodes, Apple sync, and plugin operations are idle.

One first-party signing keypair now covers both the plugin catalog and core updates - everything MemoryLane ships is signed with the same key, since it's all first-party and a release ships everything together anyway. No feed is hosted yet, so `updater.go` still reports "not configured" until one is published. The hosting directories already exist and are ready for it (same nginx pattern as the plugin catalog - a `no-cache` manifest, an `immutable` long-cache for the versioned installer next to it): `https://memorylaneapp.org/updates/win32-x64/` and `.../darwin-arm64/` (Intel Mac is out of scope for now), each holding that platform's `manifest.json` and installer. Publishing the first real release closes this gap - see "Core update feed" in README.md for the exact commands.
