#!/usr/bin/env bash
#
# Notarizes and staples the desktop DMG, then proves the result the way
# Gatekeeper will judge it on a user's Mac.
#
# Why Tauri's own notarization is not enough: tauri-bundler notarizes and
# staples the .app and signs the DMG, but never notarizes the DMG container
# (macos/dmg/mod.rs ends at `sign`). The auto-updater never notices, because it
# pulls the .app.tar.gz, but a first-time user downloads the DMG, and a signed,
# unnotarized DMG earns the "cannot check it for malicious software" block
# that this whole pipeline exists to remove.
#
# Order matters: notarize, then staple, then anything that reads the bytes
# (stapling changes them). The lane re-uploads the DMG after this script.
#
# The script's exit status is the proof. It fails unless:
#   - the notary accepted the submission (on rejection it prints the notary
#     log, which names the offending file, and exits 1);
#   - `stapler validate` finds the ticket on the DMG and on the .app;
#   - `spctl --assess` reports the DMG as "Notarized Developer ID";
#   - `codesign --verify --deep --strict` accepts the .app; and
#   - every Mach-O inside the .app carries the signing identity
#     (macos-codesign-tree.sh verify; --deep seals Resources/ as data and would
#     not catch an ad-hoc binary in the embedded runner).
#
# Usage: macos-notarize-dmg.sh <path/to/Stigmer_x_aarch64.dmg> <path/to/Stigmer.app>
#
# Environment (the same names Tauri reads, so one vocabulary serves both):
#   APPLE_API_KEY          App Store Connect API key id
#   APPLE_API_ISSUER       App Store Connect issuer id
#   APPLE_API_KEY_PATH     path to the AuthKey_<id>.p8 file
#   APPLE_SIGNING_IDENTITY the identity every Mach-O must carry
#   NOTARY_TIMEOUT         optional, default 30m; a hung notary fails the job
#                          instead of consuming its six-hour limit

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() {
  echo "macos-notarize-dmg: $*" >&2
  exit 1
}

require_env() {
  local name
  for name in "$@"; do
    [ -n "${!name:-}" ] || fail "$name is not set"
  done
}

[ "$(uname -s)" = Darwin ] || fail "notarytool is macOS-only; nothing to do on $(uname -s)"
[ $# -eq 2 ] || { echo "usage: macos-notarize-dmg.sh <dmg> <app>" >&2; exit 2; }
DMG="$1"
APP="$2"
[ -f "$DMG" ] || fail "DMG not found: $DMG"
[ -d "$APP" ] || fail "app bundle not found: $APP"
require_env APPLE_API_KEY APPLE_API_ISSUER APPLE_API_KEY_PATH APPLE_SIGNING_IDENTITY
[ -f "$APPLE_API_KEY_PATH" ] || fail "notarization key not found: $APPLE_API_KEY_PATH"

notary_auth=(--key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER")

echo "macos-notarize-dmg: submitting $(basename "$DMG") (timeout ${NOTARY_TIMEOUT:-30m})"
# notarytool prints the submission id as soon as the upload lands and the final
# status once --wait returns; both are read back from the transcript. Its exit
# status is captured rather than trusted: a rejected submission still has a log
# worth printing, and a timeout has an id worth naming.
set +e
submit_log="$(xcrun notarytool submit "$DMG" "${notary_auth[@]}" --wait --timeout "${NOTARY_TIMEOUT:-30m}" 2>&1 | tee /dev/stderr)"
submit_exit=$?
set -e
submission_id="$(sed -nE 's/^ *id: ([0-9a-f-]+)$/\1/p' <<<"$submit_log" | head -n1)"
status="$(sed -nE 's/^ *status: (.*)$/\1/p' <<<"$submit_log" | tail -n1)"
[ -n "$submission_id" ] || fail "notarytool exited $submit_exit before a submission id was issued"

if [ "$status" != "Accepted" ] || [ "$submit_exit" -ne 0 ]; then
  echo "macos-notarize-dmg: notary status is \"${status:-unknown}\"; fetching the log for $submission_id" >&2
  xcrun notarytool log "$submission_id" "${notary_auth[@]}" >&2 || true
  fail "notarization of $(basename "$DMG") was not accepted"
fi

echo "macos-notarize-dmg: stapling"
xcrun stapler staple "$DMG"

echo "macos-notarize-dmg: verifying"
xcrun stapler validate "$DMG"
xcrun stapler validate "$APP"
assessment="$(spctl --assess --type open --context context:primary-signature -vv "$DMG" 2>&1 | tee /dev/stderr)"
grep -q 'source=Notarized Developer ID' <<<"$assessment" \
  || fail "Gatekeeper does not report the DMG as Notarized Developer ID"
codesign --verify --deep --strict --verbose=2 "$APP"
"$SCRIPT_DIR/macos-codesign-tree.sh" verify "$APP" "$APPLE_SIGNING_IDENTITY"

echo "macos-notarize-dmg: $(basename "$DMG") is notarized, stapled, and accepted by Gatekeeper"
