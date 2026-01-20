#!/bin/bash
# Stigmer installation script
# Downloads and installs both stigmer CLI and stigmer-server

set -e

# Configuration
REPO="stigmer/stigmer"
INSTALL_DIR="${INSTALL_DIR:-$HOME/bin}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Functions
error() {
    echo -e "${RED}Error: $1${NC}" >&2
    exit 1
}

info() {
    echo -e "${GREEN}$1${NC}"
}

warn() {
    echo -e "${YELLOW}$1${NC}"
}

# Detect OS and architecture
detect_platform() {
    OS=$(uname -s | tr '[:upper:]' '[:lower:]')
    ARCH=$(uname -m)
    
    case "$ARCH" in
        x86_64) ARCH="amd64" ;;
        aarch64|arm64) ARCH="arm64" ;;
        *) error "Unsupported architecture: $ARCH" ;;
    esac
    
    case "$OS" in
        linux|darwin) ;;
        *) error "Unsupported OS: $OS" ;;
    esac
    
    info "Detected platform: $OS/$ARCH"
}

# Get latest release version
get_latest_version() {
    VERSION=$(curl -s "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
    if [ -z "$VERSION" ]; then
        error "Failed to get latest version"
    fi
    info "Latest version: $VERSION"
}

# Download and extract
download_and_install() {
    FILENAME="stigmer_${VERSION#v}_${OS}_${ARCH}.tar.gz"
    URL="https://github.com/$REPO/releases/download/$VERSION/$FILENAME"
    
    info "Downloading from: $URL"
    
    # Create temp directory
    TMP_DIR=$(mktemp -d)
    trap "rm -rf $TMP_DIR" EXIT
    
    # Download
    if ! curl -fsSL "$URL" -o "$TMP_DIR/$FILENAME"; then
        error "Failed to download $URL"
    fi
    
    # Extract
    info "Extracting..."
    tar -xzf "$TMP_DIR/$FILENAME" -C "$TMP_DIR"
    
    # Create install directory
    mkdir -p "$INSTALL_DIR"
    
    # Install binaries
    info "Installing to $INSTALL_DIR..."
    mv "$TMP_DIR/stigmer" "$INSTALL_DIR/stigmer"
    mv "$TMP_DIR/stigmer-server" "$INSTALL_DIR/stigmer-server"
    chmod +x "$INSTALL_DIR/stigmer" "$INSTALL_DIR/stigmer-server"
    
    info "✓ Installed stigmer to $INSTALL_DIR/stigmer"
    info "✓ Installed stigmer-server to $INSTALL_DIR/stigmer-server"
}

# Check if install directory is in PATH
check_path() {
    if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
        warn "\n⚠️  $INSTALL_DIR is not in your PATH"
        warn "Add it to your shell profile:\n"
        echo "  export PATH=\"\$PATH:$INSTALL_DIR\""
        echo ""
    fi
}

# Main
main() {
    echo "============================================"
    echo "Stigmer Installer"
    echo "============================================"
    echo ""
    
    detect_platform
    get_latest_version
    download_and_install
    check_path
    
    echo ""
    echo "============================================"
    info "✓ Installation complete!"
    echo "============================================"
    echo ""
    info "Get started:"
    echo "  stigmer --help"
    echo "  stigmer local    # Start local mode"
    echo ""
}

main "$@"
