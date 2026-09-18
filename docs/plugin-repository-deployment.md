# Plugin repository deployment

MemoryLane plugins are served as static HTTPS files. The production server does not need Node, Python, a database, or a registry application.

## Build and verify

CI supplies the Ed25519 private key through `MEMORYLANE_PLUGIN_SIGNING_KEY`. The value may be a PEM string or a path to a protected PEM file.

Generate the release pair once with `npm run plugins:keygen`. The private PEM is written under the gitignored `.keys/` directory; copy it into the CI secret store and retain an offline backup. Commit the generated public PEM and TypeScript public-key module.

Native plugins are prepared and signed on their target operating system before packaging:

```bash
npm run plugins:prepare-required
npm run plugins:prepare-ai-runtime
npm run plugins:prepare-apple-photos
SIGN_RELEASE=1 npm run plugins:sign-required
```

Windows uses the existing Azure Trusted Signing script for every plugin `.exe`. macOS signs executable files, `.node` modules, and dynamic libraries with the configured Developer ID. Submit the resulting macOS `.mlplugin` archives to `notarytool` before publication and retain the notarization results with the release records.

```bash
npm run build --workspace=plugin-sdk
npm run plugins:build -- stable
MEMORYLANE_PLUGIN_PUBLIC_KEY=/secure/plugin-public-key.pem \
  npm run plugins:verify -- dist/plugin-repository/v1/stable
```

The npm command builds the standard desktop set: Windows x64, macOS x64, and macOS arm64. Invoke `node scripts/build-plugin-repository.mjs` directly with platform names to build a different supported set.

For local lifecycle testing, insert `development` after the channel name. This creates a temporary keypair and writes only `development-public-key.pem` into the generated directory. Never publish a development repository.

The shippable directory is `dist/plugin-repository/v1/<channel>/`. `release-manifest.json` records the length and SHA-256 digest of every published file.

Set `MEMORYLANE_BUNDLED_PLUGINS_DIR` to that channel directory during a desktop build to embed the same signed repository. On first startup, core verifies its catalog and artifacts, installs missing required plugins, and then continues to use normal plugin updates. Leave it unset for the small downloader build.

## Atomic upload

Upload into a new sibling directory. Do not modify the live channel in place.

```bash
rsync -av --delay-updates dist/plugin-repository/v1/stable/ deploy@example:/srv/memorylane/plugins/v1/stable.next/
ssh deploy@example 'cd /srv/memorylane/plugins/v1 && mv stable stable.previous && mv stable.next stable'
```

Verify the remote files against `release-manifest.json` before the rename. Retain `stable.previous` until clients have successfully consumed the new catalog. Versioned artifacts are immutable and must never be overwritten; rollback publishes a newly signed catalog that points at a prior version.

With plain SFTP, upload `artifacts/` first, then `release-manifest.json`, and upload `catalog.json` plus `catalog.json.sig` last. Prefer a server-side directory rename because it makes the complete release visible atomically.

## Static server headers

Example nginx rules:

```nginx
location ~ /catalog\.json(\.sig)?$ {
    add_header Cache-Control "no-cache";
}

location /artifacts/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
}
```

Serve only over HTTPS. MIME type is not security-sensitive because clients validate lengths, digests, signatures, manifests, platform, and compatibility before extraction.

## Core update feed

Packaged desktop builds use the Go tray's signed-manifest updater. Set `MEMORYLANE_UPDATE_FEED_URL` and `MEMORYLANE_UPDATE_PUBLIC_KEY` while packaging to compile the feed and Ed25519 public key into the tray. Generate the platform feed with `MEMORYLANE_UPDATE_PRIVATE_KEY=<pem> npm run desktop:update-manifest -- <installer> <public-url> <output.json>`. Publish the signed installer before its manifest. MemoryLane verifies the manifest signature and installer SHA-256, downloads in the background, and offers installation only after scans, transcodes, Apple sync, and plugin operations are idle.
