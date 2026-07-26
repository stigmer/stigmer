#!/bin/sh
# =============================================================================
# Stigmer CLI installer
# =============================================================================
# Published at https://stigmer.ai/install.sh — this file lives in site/public/
# and is served verbatim by the GitHub Pages deploy of the website
# (.github/workflows/release.website.yaml), so it goes live on merge to main.
#
#   curl -fsSL https://stigmer.ai/install.sh | sh
#
# Design notes:
#   - The CLI ships as the @stigmer/cli npm package (pure JS, engines
#     node >= 22.13). There is no standalone binary, so this installer
#     provides the runtime: it always vendors a pinned Node under
#     $STIGMER_HOME/node rather than detecting a system Node. One code path,
#     byte-identical installs, and the CLI keeps working if the user later
#     upgrades or removes their own Node. Homebrew works the same way: the
#     formula declares `depends_on "node"` and never uses the user's Node.
#   - Nothing global is touched: everything lands under $STIGMER_HOME plus a
#     single launcher in $STIGMER_BIN_DIR. No sudo required.
#   - Re-running the script upgrades in place; it is also the upgrade path.
#   - .tar.gz is used on every platform (nodejs.org publishes it for both
#     darwin and linux) so only `tar` + `gzip` are needed — never `xz`,
#     which minimal containers often lack.
#   - Everything runs from main() at the bottom, so a truncated
#     `curl | sh` download executes nothing.
#
# Environment overrides:
#   STIGMER_VERSION   @stigmer/cli version to install    (default: latest)
#   STIGMER_HOME      install root                       (default: ~/.stigmer)
#   STIGMER_BIN_DIR   where the launcher goes            (default: ~/.local/bin)
# =============================================================================

set -eu

# Pinned Node runtime. Bump to the current LTS as needed; must satisfy the
# `engines` range declared in @stigmer/cli's package.json.
NODE_VERSION="22.20.0"

STIGMER_HOME="${STIGMER_HOME:-$HOME/.stigmer}"
STIGMER_BIN_DIR="${STIGMER_BIN_DIR:-$HOME/.local/bin}"
STIGMER_VERSION="${STIGMER_VERSION:-latest}"

# Colors only when stdout is a terminal (the script is often piped or logged).
if [ -t 1 ]; then
  BOLD="$(printf '\033[1m')"
  GREEN="$(printf '\033[0;32m')"
  YELLOW="$(printf '\033[1;33m')"
  RED="$(printf '\033[0;31m')"
  RESET="$(printf '\033[0m')"
else
  BOLD="" GREEN="" YELLOW="" RED="" RESET=""
fi

info() { printf '%s%s%s\n' "$GREEN" "$1" "$RESET"; }
warn() { printf '%s%s%s\n' "$YELLOW" "$1" "$RESET"; }
error() {
  printf '%serror:%s %s\n' "$RED" "$RESET" "$1" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || error "required command not found: $1"
}

# Sets OS to darwin|linux and ARCH to x64|arm64 (nodejs.org tarball naming).
detect_platform() {
  OS="$(uname -s)"
  case "$OS" in
    Darwin) OS="darwin" ;;
    Linux) OS="linux" ;;
    *) error "unsupported operating system: $OS (Stigmer supports macOS and Linux)" ;;
  esac

  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64 | amd64) ARCH="x64" ;;
    aarch64 | arm64) ARCH="arm64" ;;
    *) error "unsupported architecture: $ARCH" ;;
  esac
}

# Reads "checksum  filename" lines on stdin and verifies the named files,
# using whichever sha-256 tool the platform provides (linux: sha256sum,
# macOS: shasum).
sha256_check() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c - >/dev/null
  else
    shasum -a 256 -c - >/dev/null
  fi
}

# Downloads the pinned Node runtime into $STIGMER_HOME/node, verifying the
# tarball against nodejs.org's signed checksum manifest. Skipped when the
# pinned version is already present (fast path for upgrades of the CLI only).
install_node() {
  node_dir="$STIGMER_HOME/node"

  if [ -x "$node_dir/bin/node" ] &&
    [ "$("$node_dir/bin/node" --version 2>/dev/null || true)" = "v$NODE_VERSION" ]; then
    info "Node v$NODE_VERSION already installed at $node_dir — skipping download."
    return 0
  fi

  tarball="node-v$NODE_VERSION-$OS-$ARCH.tar.gz"
  info "Downloading Node v$NODE_VERSION ($OS-$ARCH)..."
  curl -fsSL -o "$TMP_DIR/$tarball" "https://nodejs.org/dist/v$NODE_VERSION/$tarball"
  curl -fsSL -o "$TMP_DIR/SHASUMS256.txt" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt"

  (
    cd "$TMP_DIR"
    grep " $tarball\$" SHASUMS256.txt | sha256_check
  ) || error "checksum verification failed for $tarball"

  rm -rf "$node_dir"
  mkdir -p "$node_dir"
  tar -xzf "$TMP_DIR/$tarball" -C "$node_dir" --strip-components=1
  info "Node v$NODE_VERSION installed to $node_dir."
}

# Installs @stigmer/cli into its own npm prefix using only the vendored Node.
# npm places the bin link at $STIGMER_HOME/cli/bin/stigmer and the package
# under $STIGMER_HOME/cli/lib/node_modules/.
install_cli() {
  info "Installing @stigmer/cli@$STIGMER_VERSION (downloading packages — this can take a minute or two)..."
  PATH="$STIGMER_HOME/node/bin:$PATH" "$STIGMER_HOME/node/bin/npm" install -g \
    --prefix "$STIGMER_HOME/cli" \
    --no-fund --no-audit --loglevel=error \
    "@stigmer/cli@$STIGMER_VERSION"
}

# Writes the `stigmer` launcher. It execs the npm-created bin link (never a
# hardcoded JS path — the package layout is npm's concern) with the vendored
# Node runtime prepended to PATH, because the bin link's shebang is
# `#!/usr/bin/env node`.
write_launcher() {
  mkdir -p "$STIGMER_BIN_DIR"
  cat >"$STIGMER_BIN_DIR/stigmer" <<EOF
#!/bin/sh
# Stigmer CLI launcher, written by the installer at https://stigmer.ai/install.sh.
# Pins the CLI to its private Node runtime regardless of the user's PATH.
PATH="$STIGMER_HOME/node/bin:\$PATH" exec "$STIGMER_HOME/cli/bin/stigmer" "\$@"
EOF
  chmod +x "$STIGMER_BIN_DIR/stigmer"
}

print_next_steps() {
  installed_version="$("$STIGMER_BIN_DIR/stigmer" version)" ||
    error "installation verification failed: could not run '$STIGMER_BIN_DIR/stigmer version'"

  printf '\n'
  info "Stigmer CLI v$installed_version installed to $STIGMER_BIN_DIR/stigmer"

  case ":$PATH:" in
    *":$STIGMER_BIN_DIR:"*) ;;
    *)
      printf '\n'
      warn "$STIGMER_BIN_DIR is not in your PATH. Add it to your shell profile:"
      # The literal $PATH is intended: this line is printed for the user to
      # paste into their shell profile.
      # shellcheck disable=SC2016
      printf '\n  export PATH="%s:$PATH"\n' "$STIGMER_BIN_DIR"
      ;;
  esac

  printf '\n%sGet started:%s\n' "$BOLD" "$RESET"
  printf '  1. Provide a model API key:   export ANTHROPIC_API_KEY=sk-ant-...\n'
  printf '     (or OPENAI_API_KEY, or a local model via Ollama)\n'
  printf '  2. Start the local stack:     stigmer up\n'
  printf '\n'
  printf 'Upgrade any time by re-running this installer.\n'
  printf 'Uninstall with:  rm -rf %s %s/stigmer\n' "$STIGMER_HOME" "$STIGMER_BIN_DIR"
}

main() {
  printf '%sStigmer CLI installer%s\n\n' "$BOLD" "$RESET"

  need_cmd curl
  need_cmd tar
  command -v sha256sum >/dev/null 2>&1 || command -v shasum >/dev/null 2>&1 ||
    error "required command not found: sha256sum or shasum"

  detect_platform

  TMP_DIR="$(mktemp -d)"
  trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

  install_node
  install_cli
  write_launcher
  print_next_steps
}

main "$@"
