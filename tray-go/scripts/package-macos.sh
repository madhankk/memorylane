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
(cd "$TRAY_ROOT" && go build -trimpath -ldflags "-s -w -X main.version=$VERSION -X main.updateFeedURL=${MEMORYLANE_UPDATE_FEED_URL:-} -X main.updatePublicKey=${MEMORYLANE_UPDATE_PUBLIC_KEY:-}" -o dist/MemoryLane .)
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
  while IFS= read -r file; do codesign --force --options runtime --timestamp --sign "$IDENTITY" "$file"; done < <(find "$CONTENTS/Resources/runtime" -type f \( -name '*.node' -o -name '*.dylib' -o -name 'node-runtime' \))
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
