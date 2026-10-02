#!/usr/bin/env bash
#
# Installs the Linux packages Tauri compiles against, with the archives served
# from an Actions cache when they are there. The package list lives here, once:
# action.yml (the reader every Tauri lane calls) and
# ci.tauri-linux-deps-cache.yaml (the one writer, on main) both run this file.
#
# Why a cache: the install fetches about 75 MB from azure.archive.ubuntu.com,
# and that mirror is sometimes slow without failing. On 2026-09-30 one gate
# run logged `Fetched 74.8 MB in 20min 17s (61.5 kB/s)` and four of seven
# runs spent 9 to 20 minutes on this step (#1529). The runner image fails over
# only when a transfer stalls for 15 s (actions/runner-images#14594), which a
# slow trickle never does.
#
# Why the hashes are checked here: apt accepts a file already in
# /var/cache/apt/archives when its size matches, without hashing it
# (pkgAcqArchive::QueueNext in apt-pkg/acquire-item.cc). So `seed` copies a
# cached archive in only when its SHA256 equals the one the package index
# names, the index `resolve` has just fetched and apt has verified against the
# archive's signature. A cached file is therefore either byte-identical to what
# the mirror would serve, or unused and downloaded again. `--print-uris` prints
# MD5 unless told otherwise (it sets Acquire::ForceHash only when unset), hence
# the explicit SHA256.
#
# Why `apt-get update` has a deadline: the index refresh (about 12.6 MB, 1 to
# 2 s on a healthy mirror) is a wait on Ubuntu's mirror that nothing else here
# bounds. A composite action's step cannot carry `timeout-minutes`, and apt's
# own timeouts catch a dead connection, not a slow one, so a trickling or
# half-stalled refresh runs until the calling job's cap. The same command, run by
# Playwright's installer at the time, sat silent for 27 minutes before its
# job's cap stopped it and a good change was ejected from the merge queue
# (#1663, #1702). So `resolve` gives it TAURI_APT_UPDATE_DEADLINE_S seconds
# (default 300: about 40 times a healthy refresh, and enough for the whole
# index at the 61.5 kB/s trickle #1529 measured), then stops it with its
# whole process group and fails with a message that says so. No retry: a
# mirror that keeps stalling should show, not hide behind a second try. The
# variable exists for apt-cache.test.mjs. `install`'s download is not bounded
# here: on a cache miss it has taken 20 minutes and still finished, and the
# calling job's cap bounds it.
#
# Subcommands, in the order a lane runs them:
#   resolve  apt-get update, under its deadline, then write the manifest of
#            archives the install will fetch (`file size sha256`, sorted) and
#            print the cache key, content-addressed from that manifest, and its
#            prefix.
#   seed     copy each cached archive whose hash matches the manifest into
#            apt's archive directory.
#   install  apt-get install the list, exactly as before the cache existed.
#   stage    (the writer only) copy the manifest's archives, hash-checked
#            again, into a fresh cache directory for actions/cache/save.
#
# Paths are absolute, so a job's default working directory does not matter.
# Outside a runner (a local check in an ubuntu container) the key goes to
# stdout and the manifest to /tmp.

set -euo pipefail

PACKAGES=(libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf)

ARCHIVES=/var/cache/apt/archives
CACHE_DIR="${HOME}/.cache/tauri-apt"
WORK_DIR="${RUNNER_TEMP:-/tmp}/tauri-apt"
MANIFEST="${WORK_DIR}/manifest"
UPDATE_DEADLINE_S="${TAURI_APT_UPDATE_DEADLINE_S:-300}"

SUDO=()
if [[ $(id -u) -ne 0 ]]; then
  SUDO=(sudo)
fi

say() { echo "tauri-linux-deps: $*"; }
die() { echo "tauri-linux-deps: $*" >&2; exit 1; }

megabytes() { awk -v b="$1" 'BEGIN { printf "%.1f", b / 1048576 }'; }

sha256_of() { sha256sum "$1" | cut -d' ' -f1; }

# Under sudo, timeout runs as root and can stop apt's root-owned fetch
# methods. It signals its whole process group, and KILLs whatever outlives the
# TERM by 15 s (exit 137 rather than 124).
update_index() {
  local status=0
  "${SUDO[@]}" timeout --kill-after=15 "$UPDATE_DEADLINE_S" apt-get update || status=$?
  case $status in
    0) ;;
    124 | 137) die "resolve: apt-get update did not finish in ${UPDATE_DEADLINE_S} s: Ubuntu's mirror stalled (#1702). Nothing was installed; rerun the job." ;;
    *) exit "$status" ;;
  esac
}

resolve() {
  update_index
  mkdir -p "$WORK_DIR"

  local uris="${WORK_DIR}/uris"
  "${SUDO[@]}" apt-get install --print-uris -qq -y -o Acquire::ForceHash=SHA256 "${PACKAGES[@]}" > "$uris"

  : > "$MANIFEST"
  local file size hash bytes=0
  while read -r _ file size hash; do
    [[ $hash == SHA256:* ]] || die "resolve: apt printed '${hash}' for ${file}, not a SHA256; refusing to trust the cache on it"
    printf '%s %s %s\n' "$file" "$size" "${hash#SHA256:}" >> "$MANIFEST"
    bytes=$((bytes + size))
  done < <(grep "^'" "$uris" | sort -k2,2)

  local version_id arch prefix key
  version_id=$(awk -F= '$1 == "VERSION_ID" { gsub(/"/, "", $2); print $2 }' /etc/os-release)
  arch=$(dpkg --print-architecture)
  prefix="tauri-apt-ubuntu${version_id}-${arch}-"
  key="${prefix}$(awk '{ print $1, $3 }' "$MANIFEST" | sha256sum | cut -c1-64)"

  say "$(wc -l < "$MANIFEST") archives to fetch ($(megabytes "$bytes") MB); cache key ${key}"
  if [[ -n ${GITHUB_OUTPUT:-} ]]; then
    {
      echo "key=${key}"
      echo "prefix=${prefix}"
    } >> "$GITHUB_OUTPUT"
  fi
}

seed() {
  [[ -f $MANIFEST ]] || die "seed: no manifest at ${MANIFEST}; run resolve first"
  local file size sha total=0 hits=0 bytes=0
  while read -r file size sha; do
    total=$((total + 1))
    [[ -f ${CACHE_DIR}/${file} ]] || continue
    if [[ $(sha256_of "${CACHE_DIR}/${file}") != "$sha" ]]; then
      say "seed: ${file} does not match the index; it will be downloaded"
      continue
    fi
    "${SUDO[@]}" cp "${CACHE_DIR}/${file}" "${ARCHIVES}/${file}"
    hits=$((hits + 1))
    bytes=$((bytes + size))
  done < "$MANIFEST"
  say "${hits} of ${total} archives from cache ($(megabytes "$bytes") MB); $((total - hits)) to download"
}

install() {
  "${SUDO[@]}" apt-get install -y "${PACKAGES[@]}"
}

stage() {
  [[ -f $MANIFEST ]] || die "stage: no manifest at ${MANIFEST}; run resolve first"
  # Emptied rather than removed: the directory can be a mount point.
  mkdir -p "$CACHE_DIR"
  find "$CACHE_DIR" -mindepth 1 -delete
  local file size sha count=0 bytes=0
  while read -r file size sha; do
    [[ -f ${ARCHIVES}/${file} ]] || die "stage: ${file} is not in ${ARCHIVES}; refusing to save a partial cache"
    [[ $(sha256_of "${ARCHIVES}/${file}") == "$sha" ]] || die "stage: ${ARCHIVES}/${file} does not match the index; refusing to save it"
    cp "${ARCHIVES}/${file}" "${CACHE_DIR}/${file}"
    count=$((count + 1))
    bytes=$((bytes + size))
  done < "$MANIFEST"
  say "staged ${count} archives ($(megabytes "$bytes") MB) in ${CACHE_DIR}"
}

case "${1:-}" in
  resolve | seed | install | stage) "$1" ;;
  *)
    echo "usage: $0 resolve|seed|install|stage" >&2
    exit 2
    ;;
esac
