#!/bin/bash
# Build Didja for other people: Release build, signed with Developer ID and the hardened
# runtime, notarised by Apple, stapled, in a .dmg. Signing settings in the Xcode project are not
# touched; the app is re-signed here.
#
#   scripts/release.sh            # the real thing: Developer ID, notarised
#   scripts/release.sh --local    # sign with any identity (IDENTITY=...), skip notarising: to test signing
#
# Needs: a "Developer ID Application" certificate in the keychain, and notarytool credentials
# stored under the profile name "scrolledaway" (kept from before the rename; xcrun notarytool store-credentials scrolledaway ...).
#
# Updates (SCR-33): the app's SUPublicEDKey (app/Didja-Info.plist) must be the real public key,
# made once with Sparkle's generate_keys (the private key stays in the login keychain). After
# notarising, the update is signed with that key and added to site/public/appcast.xml when
# APPCAST_DOWNLOAD_BASE is set, e.g. https://github.com/didja-dev/releases/releases/download
# (the DMG is then uploaded there as v<version>/Didja.dmg, and the site deployed).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL=0; [[ "${1:-}" == "--local" ]] && LOCAL=1
IDENTITY="${IDENTITY:-Developer ID Application}"
PROFILE="${NOTARY_PROFILE:-scrolledaway}"
BUILD="$ROOT/app/build-release"
OUT="$ROOT/dist"
APP="$BUILD/Build/Products/Release/Didja.app"

log() { printf '\n==> %s\n' "$*"; }

if ! security find-identity -v -p codesigning | grep -q "$IDENTITY"; then
  echo "No signing identity matching \"$IDENTITY\" in the keychain." >&2
  echo "Xcode → Settings → Accounts → your team → Manage Certificates → + → Developer ID Application." >&2
  exit 1
fi
# Sign by hash: the keychain can hold two copies of the same certificate, which codesign calls ambiguous.
HASH=$(security find-identity -v -p codesigning | grep "$IDENTITY" | head -1 | awk '{print $2}')
SIGN_AS="$IDENTITY"
IDENTITY="$HASH"

log "Building Release"
# Signed ad hoc here, as in CI's tests: every part is re-signed with Developer ID below, so the
# build needs no Apple Development certificate (GitHub's machines have none).
xcodebuild -project "$ROOT/app/Didja.xcodeproj" -scheme Didja -configuration Release \
  -derivedDataPath "$BUILD" CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Automatic DEVELOPMENT_TEAM= \
  clean build > "$BUILD.log" 2>&1 || { grep -E "error:" "$BUILD.log" | head; echo "Build failed; see $BUILD.log" >&2; exit 1; }
rm -f "$ROOT"/engine/.*.bun-build
[[ -x "$APP/Contents/Helpers/didja" ]] || { echo "The engine was not bundled (is bun installed?)" >&2; exit 1; }

if /usr/libexec/PlistBuddy -c "Print SUPublicEDKey" "$APP/Contents/Info.plist" | grep -q PLACEHOLDER; then
  echo "SUPublicEDKey in app/Didja-Info.plist is still the placeholder." >&2
  echo "Run once: app/build-release/SourcePackages/artifacts/sparkle/Sparkle/bin/generate_keys" >&2
  echo "and put the public key it prints into app/Didja-Info.plist. Without it, no update can be trusted." >&2
  exit 1
fi
SPARKLE_BIN="$BUILD/SourcePackages/artifacts/sparkle/Sparkle/bin"

VERSION=$(/usr/libexec/PlistBuddy -c "Print CFBundleShortVersionString" "$APP/Contents/Info.plist")
BUILDNO=$(/usr/libexec/PlistBuddy -c "Print CFBundleVersion" "$APP/Contents/Info.plist")
NAME="Didja-$VERSION-$BUILDNO"

log "Signing with \"$SIGN_AS\" and the hardened runtime"
# Inside out: the engine first, with the entitlements a JavaScript engine needs, then the app.
# The app gets no entitlements: in particular not get-task-allow, which notarisation refuses.
codesign --force --timestamp --options runtime --sign "$IDENTITY" \
  --entitlements "$ROOT/scripts/engine.entitlements" "$APP/Contents/Helpers/didja"
# Sparkle's helpers, inside out, as Sparkle documents for Developer ID (the downloader keeps its entitlements).
SPARKLE="$APP/Contents/Frameworks/Sparkle.framework"
if [[ -d "$SPARKLE" ]]; then
  codesign --force --timestamp --options runtime --sign "$IDENTITY" "$SPARKLE/Versions/B/XPCServices/Installer.xpc"
  codesign --force --timestamp --options runtime --sign "$IDENTITY" --preserve-metadata=entitlements "$SPARKLE/Versions/B/XPCServices/Downloader.xpc"
  codesign --force --timestamp --options runtime --sign "$IDENTITY" "$SPARKLE/Versions/B/Autoupdate"
  codesign --force --timestamp --options runtime --sign "$IDENTITY" "$SPARKLE/Versions/B/Updater.app"
  codesign --force --timestamp --options runtime --sign "$IDENTITY" "$SPARKLE"
fi
codesign --force --timestamp --options runtime --sign "$IDENTITY" "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

log "Checking the signed engine still runs"
"$APP/Contents/Helpers/didja" --help > /dev/null 2>&1 || "$APP/Contents/Helpers/didja" status > /dev/null

log "Making the disk image"
mkdir -p "$OUT"
STAGE=$(mktemp -d)
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
rm -f "$OUT/$NAME.dmg"
hdiutil create -volname "Didja" -srcfolder "$STAGE" -ov -format UDZO "$OUT/$NAME.dmg" > /dev/null
rm -rf "$STAGE"
codesign --force --timestamp --sign "$IDENTITY" "$OUT/$NAME.dmg"

if [[ $LOCAL == 1 ]]; then
  log "Local build (not notarised): $OUT/$NAME.dmg"
  exit 0
fi

log "Sending to Apple to be notarised (usually a few minutes)"
xcrun notarytool submit "$OUT/$NAME.dmg" --keychain-profile "$PROFILE" --wait --output-format json > "$OUT/$NAME.notary.json" || true
STATUS=$(/usr/bin/python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1])).get("status",""))' "$OUT/$NAME.notary.json" 2>/dev/null || true)
if [[ "$STATUS" != "Accepted" ]]; then
  echo "Notarisation: ${STATUS:-failed}. Apple's log:" >&2
  ID=$(/usr/bin/python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1])).get("id",""))' "$OUT/$NAME.notary.json" 2>/dev/null || true)
  [[ -n "$ID" ]] && xcrun notarytool log "$ID" --keychain-profile "$PROFILE" >&2
  exit 1
fi

log "Stapling the ticket"
xcrun stapler staple "$OUT/$NAME.dmg"
xcrun stapler validate "$OUT/$NAME.dmg"

log "Checking Gatekeeper accepts it"
spctl --assess --type open --context context:primary-signature --verbose=2 "$OUT/$NAME.dmg"
MOUNT=$(mktemp -d)
hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT" "$OUT/$NAME.dmg" > /dev/null
spctl --assess --type execute --verbose=2 "$MOUNT/Didja.app"
hdiutil detach "$MOUNT" > /dev/null

# The same file under the stable name the site and the appcast link to.
cp "$OUT/$NAME.dmg" "$OUT/Didja.dmg"

if [[ -n "${APPCAST_DOWNLOAD_BASE:-}" ]]; then
  log "Signing the update and adding it to site/public/appcast.xml"
  # sparkle:edSignature="…" length="…". The key comes from the login keychain, or from SPARKLE_KEY_FILE (CI).
  SIGNATURE=$("$SPARKLE_BIN/sign_update" ${SPARKLE_KEY_FILE:+--ed-key-file "$SPARKLE_KEY_FILE"} "$OUT/Didja.dmg")
  /usr/bin/python3 -I "$ROOT/scripts/appcast.py" "$ROOT/site/public/appcast.xml" "$VERSION" "$BUILDNO" \
    "$APPCAST_DOWNLOAD_BASE/v$VERSION/Didja.dmg" "$SIGNATURE" "${RELEASE_NOTES:-}"
  echo "Upload $OUT/Didja.dmg to the v$VERSION release, then deploy the site (cd site && bun run deploy)."
else
  echo "APPCAST_DOWNLOAD_BASE not set: the appcast was not updated, so installed copies will not be offered this version."
fi

log "Ready to send: $OUT/$NAME.dmg"
