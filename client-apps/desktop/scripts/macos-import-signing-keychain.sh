#!/usr/bin/env bash
#
# Imports the Developer ID Application certificate into a dedicated keychain
# that codesign can use without prompting, on a CI runner or a laptop alike.
#
# What it does, in order:
#   1. Checks the vendored Apple CA certificates (apple-ca/) against the SHA-256
#      fingerprints pinned below and refuses a mismatch.
#   2. Creates the keychain at <keychain-path> with a random password, imports
#      the CA chain and then the .p12, grants codesign access to the key
#      without a UI prompt, and adds the keychain to the user search list
#      (keeping whatever was there).
#   3. Asserts the keychain now holds exactly one code-signing identity, that it
#      equals $APPLE_SIGNING_IDENTITY when that is set, and prints the
#      certificate's expiry (a warning under 90 days).
#
# Why we import ourselves instead of handing APPLE_CERTIFICATE to Tauri: Tauri's
# tauri_macos_sign::Keychain::with_certificate imports only the leaf into a
# throwaway keychain, and the .p12 carries only the leaf. codesign must build a
# chain from the leaf to Apple's root before it signs anything; without the
# Developer ID G2 intermediate in some keychain on the search list it fails
# with "unable to build chain to self-signed root certificate". So the lane
# imports chain and leaf here and passes Tauri only APPLE_SIGNING_IDENTITY,
# which makes it look the identity up on the search list (with_signing_identity).
#
# Usage: macos-import-signing-keychain.sh <certificate.p12> <keychain-path>
#
# Environment:
#   APPLE_CERTIFICATE_PASSWORD   the .p12 password; prompted for when unset and
#                                stdin is a terminal (laptop use)
#   APPLE_SIGNING_IDENTITY       optional; when set, the imported identity must
#                                equal it (a paste error fails here in seconds,
#                                not after a thirty-minute build)
#
# The .p12 password is passed to `security import -P`. Inside a script it never
# reaches a shell history; it is briefly visible in the process list on the
# machine running the import, which on CI is an ephemeral runner. Tauri's own
# import does the same.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CA_DIR="$SCRIPT_DIR/apple-ca"

# Pinned in apple-ca/README.md beside the source URLs. Update both together.
DEVELOPER_ID_G2_CA_SHA256="F1:6C:D3:C5:4C:7F:83:CE:A4:BF:1A:3E:6A:08:19:C8:AA:A8:E4:A1:52:8F:D1:44:71:5F:35:06:43:D2:DF:3A"
APPLE_ROOT_CA_SHA256="B0:B1:73:0E:CB:C7:FF:45:05:14:2C:49:F1:29:5E:6E:DA:6B:CA:ED:7E:2C:68:C5:BE:91:B5:A1:10:01:F0:24"

EXPIRY_WARNING_DAYS=90

fail() {
  echo "macos-import-signing-keychain: $*" >&2
  exit 1
}

usage() {
  echo "usage: macos-import-signing-keychain.sh <certificate.p12> <keychain-path>" >&2
  exit 2
}

# Fingerprint of a DER certificate, in openssl's colon-separated upper-case form.
der_fingerprint() {
  openssl x509 -inform der -in "$1" -noout -fingerprint -sha256 | sed 's/^.*Fingerprint=//'
}

assert_fingerprint() {
  local file="$1" expected="$2" actual
  actual="$(der_fingerprint "$file")"
  [ "$actual" = "$expected" ] \
    || fail "$(basename "$file") fingerprint $actual does not match the pinned $expected; see apple-ca/README.md"
}

[ "$(uname -s)" = Darwin ] || fail "the security tool is macOS-only; nothing to do on $(uname -s)"
[ $# -eq 2 ] || usage
P12_PATH="$1"
KEYCHAIN_PATH="$2"
[ -f "$P12_PATH" ] || fail "certificate not found: $P12_PATH"
[ ! -e "$KEYCHAIN_PATH" ] || fail "keychain already exists: $KEYCHAIN_PATH (delete it with 'security delete-keychain' to redo the import)"

if [ -z "${APPLE_CERTIFICATE_PASSWORD:-}" ]; then
  [ -t 0 ] || fail "APPLE_CERTIFICATE_PASSWORD is not set and stdin is not a terminal"
  read -rs -p "Password for $(basename "$P12_PATH"): " APPLE_CERTIFICATE_PASSWORD
  echo
fi

assert_fingerprint "$CA_DIR/DeveloperIDG2CA.cer" "$DEVELOPER_ID_G2_CA_SHA256"
assert_fingerprint "$CA_DIR/AppleIncRootCertificate.cer" "$APPLE_ROOT_CA_SHA256"

KEYCHAIN_PASSWORD="$(openssl rand -base64 32)"
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
# Auto-lock after six hours; long enough for a build and a notarization wait.
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

# Chain first, so the leaf's issuer is resolvable the moment it lands.
security import "$CA_DIR/AppleIncRootCertificate.cer" -k "$KEYCHAIN_PATH" -T /usr/bin/codesign >/dev/null
security import "$CA_DIR/DeveloperIDG2CA.cer" -k "$KEYCHAIN_PATH" -T /usr/bin/codesign >/dev/null
security import "$P12_PATH" -k "$KEYCHAIN_PATH" -f pkcs12 -P "$APPLE_CERTIFICATE_PASSWORD" \
  -T /usr/bin/codesign -T /usr/bin/security >/dev/null

# Lets codesign use the private key without a keychain prompt.
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH" >/dev/null

# Append to the search list rather than replacing it, so the login keychain's
# contents stay reachable on a laptop.
existing_keychains=()
while IFS= read -r line; do
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line%\"}"
  line="${line#\"}"
  [ -n "$line" ] && existing_keychains+=("$line")
done < <(security list-keychains -d user)
security list-keychains -d user -s "${existing_keychains[@]}" "$KEYCHAIN_PATH"

# Exactly one identity, and it is the one the lane was told to expect.
identities="$(security find-identity -v -p codesigning "$KEYCHAIN_PATH" | grep -E '^ *[0-9]+\)' || true)"
identity_count="$(grep -c . <<<"$identities" || true)"
[ "$identity_count" -eq 1 ] || fail "expected exactly one code-signing identity in $KEYCHAIN_PATH, found $identity_count:
$identities"
identity="$(sed -E 's/^ *[0-9]+\) [0-9A-F]+ "(.*)".*$/\1/' <<<"$identities")"
if [ -n "${APPLE_SIGNING_IDENTITY:-}" ] && [ "$identity" != "$APPLE_SIGNING_IDENTITY" ]; then
  fail "the imported identity is \"$identity\" but APPLE_SIGNING_IDENTITY is \"$APPLE_SIGNING_IDENTITY\""
fi

# The leaf's expiry. Renewal is the certificate owner's job; the warning is so
# the lane's run summary carries the reminder in the months before it lapses.
not_after="$(security find-certificate -c "$identity" -p "$KEYCHAIN_PATH" | openssl x509 -noout -enddate | sed 's/^notAfter=//')"
expiry_epoch="$(date -j -f '%b %e %T %Y %Z' "$not_after" '+%s')"
days_left=$(( (expiry_epoch - $(date '+%s')) / 86400 ))

echo "macos-import-signing-keychain: imported \"$identity\" into $KEYCHAIN_PATH"
echo "macos-import-signing-keychain: certificate expires $not_after ($days_left days)"
if [ "$days_left" -lt "$EXPIRY_WARNING_DAYS" ]; then
  echo "::warning::Developer ID Application certificate \"$identity\" expires in $days_left days ($not_after)"
fi
