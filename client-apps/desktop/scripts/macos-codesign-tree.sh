#!/usr/bin/env bash
#
# Signs, or verifies the signatures of, every Mach-O file under a directory.
#
# Why this exists: Apple's notary service inspects every Mach-O inside the
# bundle it is handed — not just the main binary — and each one must carry a
# Developer ID signature and a secure timestamp, executables the hardened
# runtime too. Tauri signs the app binary, Frameworks/ and external binaries,
# but never files under Resources/ (tauri-bundler macos/app.rs signs the
# NESTED_CODE_FOLDER set only). tauri.conf.json ships the embedded runner as a
# resource (resources/runner), and that tree carries native code: Temporal's
# core bridge (index.node), sqlite3's node_sqlite3.node, and @cursor/sdk's
# cursorsandbox and rg. Unsigned, any one of them fails the whole submission.
#
# Two verbs over the same walk:
#
#   sign <dir>                  Sign every Mach-O with $APPLE_SIGNING_IDENTITY.
#                               stage-runner-slim.sh calls this on darwin so the
#                               staged tree is signed before Tauri packs it.
#   verify <dir> <authority>    Assert every Mach-O carries <authority> (the
#                               identity string, e.g. "Developer ID Application:
#                               Name (TEAMID)"), that executables carry the
#                               runtime flag, and that each has a timestamp.
#                               macos-notarize-dmg.sh runs this over the built
#                               .app: `codesign --verify --deep --strict` seals
#                               Resources/ as data rather than verifying it as
#                               code, so it would pass an app whose rg is still
#                               ad-hoc. This is the check the notary applies.
#
# The identity "-" is codesign's ad-hoc identity. It is accepted by both verbs
# (sign uses it without --timestamp, which needs a real identity; verify then
# expects Signature=adhoc) so the walk can be tested on any Mac without a
# certificate. Nothing in the release lane passes "-".
#
# Mirrors Tauri's own discipline: --options runtime goes on executables only;
# libraries (dylibs, .node bundles) need the signature and the timestamp.
#
# Exit status is non-zero if the directory holds no Mach-O at all: a runner
# tree without native code means staging broke, and a verify over an app with
# no binaries is not a verification.

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: macos-codesign-tree.sh sign <dir>
       macos-codesign-tree.sh verify <dir> <authority>

  sign    reads the identity from APPLE_SIGNING_IDENTITY ("-" for ad-hoc)
  verify  <authority> is the identity string expected in every signature,
          or "-" to expect ad-hoc signatures
EOF
  exit 2
}

fail() {
  echo "macos-codesign-tree: $*" >&2
  exit 1
}

# Prints "executable", "library", or nothing for a non-Mach-O file. `file`
# describes universal binaries as "Mach-O universal binary ... [executable]",
# so the executable test holds for them too.
mach_o_kind() {
  local description
  description="$(file -b "$1")"
  case "$description" in
    *Mach-O*executable*) echo executable ;;
    *Mach-O*) echo library ;;
    *) ;;
  esac
}

# Invokes $1 (a function name) with (path, kind) for every Mach-O under $2.
# Returns the count through the global MACH_O_COUNT because the walk runs in
# the current shell (process substitution), not a subshell.
walk_mach_o() {
  local callback="$1" dir="$2" path kind
  MACH_O_COUNT=0
  while IFS= read -r -d '' path; do
    kind="$(mach_o_kind "$path")"
    [ -n "$kind" ] || continue
    MACH_O_COUNT=$((MACH_O_COUNT + 1))
    "$callback" "$path" "$kind"
  done < <(find "$dir" -type f -print0 | sort -z)
}

sign_one() {
  local path="$1" kind="$2"
  local -a args=(--force --sign "$IDENTITY")
  [ "$kind" = executable ] && args+=(--options runtime)
  [ "$IDENTITY" != "-" ] && args+=(--timestamp)
  echo "sign   [$kind] $path"
  codesign "${args[@]}" "$path"
  codesign --verify --strict "$path"
}

verify_one() {
  local path="$1" kind="$2" details
  # codesign -dvv writes its report to stderr.
  details="$(codesign -dvv "$path" 2>&1)" || fail "not signed: $path"
  codesign --verify --strict "$path" || fail "signature does not verify: $path"

  if [ "$AUTHORITY" = "-" ]; then
    grep -q '^Signature=adhoc$' <<<"$details" || fail "expected an ad-hoc signature: $path"
  else
    grep -qF "Authority=$AUTHORITY" <<<"$details" || fail "not signed by \"$AUTHORITY\": $path"
    grep -q '^Timestamp=' <<<"$details" || fail "no secure timestamp: $path"
  fi
  if [ "$kind" = executable ]; then
    grep -E '^CodeDirectory .*flags=.*\(.*runtime.*\)' -q <<<"$details" \
      || fail "hardened runtime not enabled on executable: $path"
  fi
  echo "verify [$kind] $path"
}

[ "$(uname -s)" = Darwin ] || fail "codesign is a macOS tool; nothing to do on $(uname -s)"
[ $# -ge 2 ] || usage
VERB="$1"
DIR="$2"
[ -d "$DIR" ] || fail "not a directory: $DIR"

case "$VERB" in
  sign)
    [ $# -eq 2 ] || usage
    IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
    [ -n "$IDENTITY" ] || fail "APPLE_SIGNING_IDENTITY is not set"
    walk_mach_o sign_one "$DIR"
    ;;
  verify)
    [ $# -eq 3 ] || usage
    AUTHORITY="$3"
    [ -n "$AUTHORITY" ] || usage
    walk_mach_o verify_one "$DIR"
    ;;
  *) usage ;;
esac

[ "$MACH_O_COUNT" -gt 0 ] || fail "no Mach-O files under $DIR"
echo "macos-codesign-tree: $VERB — $MACH_O_COUNT Mach-O file(s) under $DIR"
