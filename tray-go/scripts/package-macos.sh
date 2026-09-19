#!/usr/bin/env bash
set -euo pipefail
TRAY_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$TRAY_ROOT/.." && pwd)"
VERSION="$(node -p "require('$REPO_ROOT/package.json').version")"
ARCH="$(uname -m)"
RELEASE="$TRAY_ROOT/release/$VERSION"
APP="$RELEASE/MemoryLane.app"
CONTENTS="$APP/Contents"

node "$TRAY_ROOT/scripts/prepare-runtime.mjs"
mkdir -p "$TRAY_ROOT/dist"
# The real, signed catalog this verifies against is already hosted - see
# docs/plugin-repository-deployment.md. Each platform has its own catalog
# (scripts/build-plugin-repository.mjs writes one per platform subdirectory,
# uploaded and updated independently of any other platform's) - ARCH is
# "arm64" on Apple Silicon, matching that subdirectory's name directly (Intel
# Mac/darwin-x64 isn't a supported release target for now). Override for a
# build that should point at a different catalog (e.g. a beta channel or a
# self-hosted mirror).
PLUGIN_CATALOG_URL="${MEMORYLANE_PLUGIN_CATALOG_URL:-https://memorylaneapp.org/plugins/v1/stable/darwin-$ARCH/catalog.json}"
# The update manifest is verified with the same first-party key that signs
# the plugin catalog (tray-go/updater.go's updatePublicKey), so there's
# nothing to bake in here. MEMORYLANE_UPDATE_FEED_URL still has no default:
# updater.go treats updates as "not configured" unless it's set, and no feed
# is hosted yet - see docs/plugin-repository-deployment.md.
(cd "$TRAY_ROOT" && go build -trimpath -ldflags "-s -w -X main.version=$VERSION -X main.updateFeedURL=${MEMORYLANE_UPDATE_FEED_URL:-} -X main.pluginCatalogURL=$PLUGIN_CATALOG_URL" -o dist/MemoryLane .)
rm -rf "$APP"
mkdir -p "$CONTENTS/MacOS" "$CONTENTS/Resources"
cp "$TRAY_ROOT/dist/MemoryLane" "$CONTENTS/MacOS/MemoryLane"
cp "$TRAY_ROOT/assets/icon.icns" "$CONTENTS/Resources/MemoryLane.icns"
cp -R "$TRAY_ROOT/runtime" "$CONTENTS/Resources/runtime"
cat > "$CONTENTS/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.memorylane.desktop</string><key>CFBundleName</key><string>MemoryLane</string><key>CFBundleDisplayName</key><string>MemoryLane</string><key>CFBundleExecutable</key><string>MemoryLane</string><key>CFBundleIconFile</key><string>MemoryLane.icns</string><key>CFBundleShortVersionString</key><string>$VERSION</string><key>CFBundleVersion</key><string>$VERSION</string><key>LSUIElement</key><true/></dict></plist>
EOF

if [[ "${SIGN_RELEASE:-}" == "1" ]]; then
  IDENTITY="${MACOS_SIGNING_IDENTITY:-Developer ID Application: Humanly Incorporated (RNTVBNC62M)}"
  # -perm -u+x picks up exiftool-vendored/ffmpeg-static/ffprobe-static's own
  # extensionless executables too - core dependencies now (see
  # server/src/media/exiftool-client.ts, video-client.ts), not a
  # separately-signed plugin anymore, so their binaries need coverage here.
  while IFS= read -r file; do codesign --force --options runtime --timestamp --sign "$IDENTITY" "$file"; done < <(find "$CONTENTS/Resources/runtime" -type f \( -name '*.node' -o -name '*.dylib' -o -name 'node-runtime' -o -perm -u+x \))
  codesign --force --deep --options runtime --timestamp --sign "$IDENTITY" "$APP"
  codesign --verify --deep --strict "$APP"
fi

DMG="$RELEASE/MemoryLane-$ARCH.dmg"
rm -f "$DMG"
hdiutil create -volname MemoryLane -srcfolder "$APP" -ov -format ULFO "$DMG"
if [[ "${SIGN_RELEASE:-}" == "1" ]]; then
  : "${APPLE_NOTARY_KEYCHAIN_PROFILE:?APPLE_NOTARY_KEYCHAIN_PROFILE is required}"
  codesign --force --sign "$IDENTITY" --timestamp "$DMG"
  xcrun notarytool submit "$DMG" --keychain-profile "$APPLE_NOTARY_KEYCHAIN_PROFILE" --wait
  xcrun stapler staple -v "$DMG"
fi
echo "MemoryLane desktop package: $RELEASE"
