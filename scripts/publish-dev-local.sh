#!/usr/bin/env bash
#
# Local dev-publishing: publish throwaway "dev" builds of the Stigmer
# dependencies straight from your working tree — no commit, no push, no CI
# round-trip. This is the tight-inner-loop counterpart to `make publish-dev`
# (which dispatches release.dev.yaml on GitHub and is the shareable/auditable
# path). See .github/workflows/docs/dev-publishing.md.
#
# Credentials are fetched at runtime from Planton secrets (org `stigmer`) and
# never written to disk. GitHub Actions secrets are write-only and cannot be
# read back, which is why the local path uses Planton as the readable store.
#
# Required Planton secrets (each a single-value secret under the key `value`,
# matching the org convention):
#   - npm-token               npm automation token
#   - maven-central-username  Sonatype Central user-token username
#   - maven-central-password  Sonatype Central user-token password
#   - testpypi-token          TestPyPI API token (pypi-...)
#
# Usage:
#   scripts/publish-dev-local.sh                 # all targets, auto base version
#   TARGETS=npm,maven scripts/publish-dev-local.sh
#   BASE=3.1.0 scripts/publish-dev-local.sh
#
# Prefer the `make publish-dev-local` wrapper.

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────
TARGETS="${TARGETS:-all}"
BASE="${BASE:-}"

# Planton secret slugs (single-value, key `value`).
SECRET_NPM="npm-token"
SECRET_MVN_USER="maven-central-username"
SECRET_MVN_PASS="maven-central-password"
SECRET_TESTPYPI="testpypi-token"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# ─── Logging ──────────────────────────────────────────────────────────────
log()  { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[1;31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

want() { case ",$TARGETS," in *",$1,"*) return 0 ;; *) return 1 ;; esac; }

# ─── Working-tree safety ──────────────────────────────────────────────────
# Several targets stamp versions into pom.xml / pyproject.toml. We snapshot any
# file before mutating and restore it on exit (success or failure), so a dev's
# pre-existing uncommitted edits to those files are never clobbered.
BACKUP_DIR="$(mktemp -d)"
TMP_FILES=()
TMP_DIRS=()
MUTATED=()

cleanup() {
  local f
  for f in "${MUTATED[@]:-}"; do
    [ -n "$f" ] && [ -f "$BACKUP_DIR/$f" ] && cp "$BACKUP_DIR/$f" "$ROOT/$f"
  done
  for f in "${TMP_FILES[@]:-}"; do
    [ -n "$f" ] && rm -f "$f"
  done
  for f in "${TMP_DIRS[@]:-}"; do
    [ -n "$f" ] && rm -rf "$f"
  done
  rm -rf "$BACKUP_DIR"
}
trap cleanup EXIT

snapshot() {
  local f="$1"
  mkdir -p "$BACKUP_DIR/$(dirname "$f")"
  cp "$ROOT/$f" "$BACKUP_DIR/$f"
  MUTATED+=("$f")
}

# ─── Planton secret access ────────────────────────────────────────────────
# Normalizes `planton secret get` output across CLI variants:
#   - Release CLIs (>= v0.0.25-cli) honor `-o plain` and return the raw value.
#   - Older/dev builds ignore `-o plain` and print a decorated key/value table;
#     we extract the `value` cell from it (the box auto-sizes, so even long
#     tokens come through intact).
# The whitespace guard below is the safety net: every secret we read here is a
# single token with no spaces, so a parsed value containing whitespace means the
# output format wasn't understood — we refuse rather than publish a corrupt token.
PLANTON_PARSE_PY='
import sys, re
raw = re.sub(r"\x1b\[[0-9;]*m", "", sys.stdin.read())
if "\u2502" in raw:  # decorated table (older/dev CLI)
    val = ""
    for line in raw.split("\n"):
        if "\u2502" in line:
            cells = [c.strip() for c in line.split("\u2502")]
            if len(cells) >= 3 and cells[1] == "value":
                val = cells[2]
    sys.stdout.write(val)
else:
    sys.stdout.write(raw.strip())
'

fetch_secret() {
  local slug="$1" raw val
  raw="$(planton secret get "$slug" --key value -o plain 2>/dev/null)" \
    || die "Could not read Planton secret '$slug'. Create it with: planton secret set $slug value=<TOKEN>"
  val="$(printf '%s' "$raw" | python3 -c "$PLANTON_PARSE_PY")"
  [ -n "$val" ] || die "Planton secret '$slug' resolved to an empty value (unrecognized CLI output)."
  case "$val" in
    *[[:space:]]*) die "Planton secret '$slug' parsed to a value containing whitespace — refusing (likely an unrecognized CLI output format; upgrade planton or re-check the secret)." ;;
  esac
  printf '%s' "$val"
}

# ─── Version derivation (mirrors release.dev.yaml) ────────────────────────
if [ "$TARGETS" = "all" ]; then TARGETS="npm,maven,python"; fi

command -v planton >/dev/null 2>&1 || die "planton CLI not found (needed to fetch publish credentials)."
command -v git >/dev/null 2>&1 || die "git not found."

if [ -z "$BASE" ]; then
  LATEST="$(git tag -l "v*" | sort -V | tail -n1)"; [ -z "$LATEST" ] && LATEST="v0.0.0"
  V="${LATEST#v}"
  BASE="$(echo "$V" | cut -d. -f1).$(echo "$V" | cut -d. -f2).$(( $(echo "$V" | cut -d. -f3) + 1 ))"
fi
git rev-parse "v$BASE" >/dev/null 2>&1 && die "v$BASE already exists as a release tag — pass a higher BASE=X.Y.Z."

STAMP="$(date -u +%Y%m%d%H%M%S)"
EPOCH="$(date -u +%s)"
DIRTY=""; git diff --quiet HEAD 2>/dev/null || DIRTY="-dirty"

MAVEN_VERSION="${BASE}-SNAPSHOT"
NPM_VERSION="${BASE}-dev.${STAMP}"
PY_VERSION="${BASE}.dev${EPOCH}"

log "Local dev publish — base ${BASE} (targets: ${TARGETS})"
echo "    maven  : ${MAVEN_VERSION}"
echo "    npm    : ${NPM_VERSION} (tag: dev)"
echo "    python : ${PY_VERSION} (TestPyPI)"
[ -n "$DIRTY" ] && warn "Working tree has uncommitted changes — building from your live working tree."

# Set a pyproject/poetry version in place (first version assignment only).
set_py_version() {
  local file="$1" version="$2"
  python3 - "$file" "$version" <<'PY'
import re, sys, pathlib
p = pathlib.Path(sys.argv[1]); text = p.read_text()
text = re.sub(r'version\s*=\s*"[^"]*"', f'version = "{sys.argv[2]}"', text, count=1)
p.write_text(text)
PY
}

# ─── npm ──────────────────────────────────────────────────────────────────
publish_npm() {
  log "npm: building stubs and publishing @stigmer/* under the 'dev' tag"
  local token; token="$(fetch_secret "$SECRET_NPM")"

  make -C apis ts-stubs
  [ -d node_modules ] || npm ci

  NPM_TOKEN="$token" node scripts/publish-libs.mjs --version "$NPM_VERSION" --tag dev

  log "npm: building and publishing @stigmer/runner@$NPM_VERSION"
  make build-runner

  local runner_dir="backend/services/runner"
  snapshot "$runner_dir/package.json"
  VERSION="$NPM_VERSION" node -e "
    const fs = require('node:fs');
    const path = 'backend/services/runner/package.json';
    const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
    pkg.version = process.env.VERSION;
    pkg.dependencies['@stigmer/protos'] = process.env.VERSION;
    fs.writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
  "

  # Wait for the just-published protos to be queryable (runner pins it exactly).
  log "npm: waiting for @stigmer/protos@$NPM_VERSION to be visible"
  local i
  for i in $(seq 1 30); do
    npm view "@stigmer/protos@$NPM_VERSION" version >/dev/null 2>&1 && break
    [ "$i" = 30 ] && die "@stigmer/protos@$NPM_VERSION not visible on npm after 5 minutes."
    sleep 10
  done

  # npm reads the project .npmrc from the *publish* directory and does not walk
  # up to parent directories. The fat runner and each slim sub-package live in
  # different dirs (dist-slim-pkgs/runner-slim-*/ each carry their own
  # package.json), so a single project .npmrc could never cover them all. Mirror
  # what actions/setup-node does in CI: write one auth file and point npm at it
  # via NPM_CONFIG_USERCONFIG, which npm honors from any working directory. The
  # token stays in the environment (interpolated at runtime); the file holds only
  # the ${NODE_AUTH_TOKEN} reference, and the temp file is removed on exit.
  local npmrc; npmrc="$(mktemp)"; TMP_FILES+=("$npmrc")
  printf '//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n' > "$npmrc"
  export NPM_CONFIG_USERCONFIG="$npmrc" NODE_AUTH_TOKEN="$token"
  ( cd "$runner_dir" && npm publish --access public --tag dev )

  # The slim embedding artifact (stigmer/stigmer#170): @stigmer/runner-slim plus
  # its per-platform native-bridge packages. Self-contained — its bundle does
  # not pin @stigmer/protos — so it just needs the version already stamped into
  # package.json above, which bundle-slim.mjs propagates into every manifest.
  # dist/ was produced by `make build-runner` above and carries no version, so
  # no rebuild is needed before emitting the packages.
  log "npm: building and publishing @stigmer/runner-slim@$NPM_VERSION"
  ( cd "$runner_dir" && node scripts/bundle-slim.mjs --emit-packages )
  local slim_pkgs="$runner_dir/dist-slim-pkgs"
  # Platform packages first so the meta package's optionalDependencies resolve
  # the moment it lands.
  local pkg
  for pkg in "$slim_pkgs"/runner-slim-*; do
    ( cd "$pkg" && npm publish --access public --tag dev )
  done
  ( cd "$slim_pkgs/runner-slim" && npm publish --access public --tag dev )

  ok "npm: published @stigmer/*, @stigmer/runner, and @stigmer/runner-slim at $NPM_VERSION (tag dev)"
}

# ─── Maven ─────────────────────────────────────────────────────────────────
publish_maven() {
  log "maven: deploying SNAPSHOT $MAVEN_VERSION to the Central snapshot repo"
  local mc_user mc_pass settings
  mc_user="$(fetch_secret "$SECRET_MVN_USER")"
  mc_pass="$(fetch_secret "$SECRET_MVN_PASS")"

  # Env-interpolated settings.xml: the password is passed via ${env.*} so its
  # contents can never break the XML (no manual escaping needed).
  settings="$(mktemp)"; TMP_FILES+=("$settings")
  cat > "$settings" <<'XML'
<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0">
  <servers>
    <server>
      <id>central</id>
      <username>${env.MAVEN_CENTRAL_USERNAME}</username>
      <password>${env.MAVEN_CENTRAL_PASSWORD}</password>
    </server>
  </servers>
</settings>
XML
  export MAVEN_CENTRAL_USERNAME="$mc_user" MAVEN_CENTRAL_PASSWORD="$mc_pass"

  snapshot "apis/stubs/java/pom.xml"
  ( cd apis/stubs/java \
    && mvn -B -s "$settings" versions:set -DnewVersion="$MAVEN_VERSION" -DgenerateBackupPoms=false \
    && mvn -B -s "$settings" deploy -DskipTests )

  make -C sdk/java codegen

  snapshot "sdk/java/pom.xml"
  ( cd sdk/java \
    && mvn -B -s "$settings" versions:set -DnewVersion="$MAVEN_VERSION" -DgenerateBackupPoms=false \
    && mvn -B -s "$settings" versions:set-property -Dproperty=stigmer-protos.version -DnewVersion="$MAVEN_VERSION" -DgenerateBackupPoms=false \
    && mvn -B -s "$settings" deploy -DskipTests )

  unset MAVEN_CENTRAL_USERNAME MAVEN_CENTRAL_PASSWORD
  ok "maven: deployed ai.stigmer:stigmer-java:$MAVEN_VERSION (protos pinned to same)"
}

# ─── Python (TestPyPI) ─────────────────────────────────────────────────────
publish_python() {
  log "python: building and uploading $PY_VERSION to TestPyPI"
  command -v python3 >/dev/null 2>&1 || die "python3 not found."
  local token; token="$(fetch_secret "$SECRET_TESTPYPI")"

  # Stamp versions first, then build both packages.
  make -C apis python-stubs
  snapshot "apis/stubs/python/stigmer/pyproject.toml"
  set_py_version "apis/stubs/python/stigmer/pyproject.toml" "$PY_VERSION"

  make -C sdk/python codegen
  snapshot "sdk/python/pyproject.toml"
  set_py_version "sdk/python/pyproject.toml" "$PY_VERSION"
  python3 - "sdk/python/pyproject.toml" "$PY_VERSION" <<'PY'
import re, sys, pathlib
p = pathlib.Path(sys.argv[1]); text = p.read_text()
text = re.sub(r'"stigmer-protos[^"]*"', f'"stigmer-protos=={sys.argv[2]}"', text)
p.write_text(text)
PY

  # Prefer uv: it builds via a globally cached env and uploads natively, so it
  # avoids the slow per-run "create venv + pip install build/twine" path (that
  # step alone took >80s). Fall back to a throwaway venv only when uv is absent,
  # which also keeps this working on managed interpreters (PEP 668).
  if command -v uv >/dev/null 2>&1; then
    log "python: building with uv"
    ( cd apis/stubs/python/stigmer && rm -rf dist && uv build )
    ( cd sdk/python && rm -rf dist && uv build )
    uv publish --publish-url https://test.pypi.org/legacy/ --token "$token" \
      apis/stubs/python/stigmer/dist/* sdk/python/dist/*
  else
    log "python: uv not found — provisioning build/twine in a temp venv (slower)"
    local venv py; venv="$(mktemp -d)"; TMP_DIRS+=("$venv")
    python3 -m venv "$venv"; py="$venv/bin/python"
    "$py" -m pip install --quiet --upgrade pip build twine
    ( cd apis/stubs/python/stigmer && rm -rf dist && "$py" -m build )
    ( cd sdk/python && rm -rf dist && "$py" -m build )
    TWINE_USERNAME=__token__ TWINE_PASSWORD="$token" "$py" -m twine upload \
      --repository-url https://test.pypi.org/legacy/ \
      apis/stubs/python/stigmer/dist/* sdk/python/dist/*
  fi

  ok "python: uploaded stigmer-protos and stigmer at $PY_VERSION to TestPyPI"
}

# ─── Run selected targets ──────────────────────────────────────────────────
want npm    && publish_npm
want maven  && publish_maven
want python && publish_python

# ─── Consumer coordinates ──────────────────────────────────────────────────
echo ""
log "Dev build published — consumer coordinates"
echo "Setup is one-time (see .github/workflows/docs/dev-publishing.md); switching dev<->prod is only a version-string change."
echo ""
if want maven; then
  echo "Maven (Java SDK):  ai.stigmer:stigmer-java:${MAVEN_VERSION}   (mvn -U to refresh)"
fi
if want npm; then
  echo "npm (React/TS):    npm install @stigmer/react@dev          # exact: @stigmer/react@${NPM_VERSION}"
  echo "npm (embed runner): npm install @stigmer/runner-slim@dev   # exact: @stigmer/runner-slim@${NPM_VERSION}"
fi
if want python; then
  echo "Python (TestPyPI): pip install -i https://test.pypi.org/simple/ --extra-index-url https://pypi.org/simple/ --pre 'stigmer==${PY_VERSION}'"
fi
echo "Go SDK:            go get github.com/stigmer/stigmer/sdk/go@$(git rev-parse --abbrev-ref HEAD)"
echo ""
ok "Done."
