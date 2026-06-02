#!/usr/bin/env bash
#
# Generate a self-signed TLS certificate for the local dev runner proxy.
#
# The Cursor SDK's connect-node transport requires TLS for HTTP/2 (ALPN
# negotiation). Without TLS the SDK falls back to HTTP/1.1, and the
# HTTP/2 interceptor (which injects x-stigmer-auth) never fires.
#
# This script generates an ECDSA P-256 cert for localhost/127.0.0.1 and
# stores it in scripts/.certs/. It is idempotent: if a valid cert exists
# with >24 hours remaining, generation is skipped.
#
# Usage: ./scripts/gen-dev-certs.sh
#   Called automatically by `make desktop-dev` / `make launch-desktop`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERTS_DIR="$SCRIPT_DIR/.certs"

CERT_FILE="$CERTS_DIR/localhost.pem"
KEY_FILE="$CERTS_DIR/localhost-key.pem"

mkdir -p "$CERTS_DIR"

# Skip if cert exists and has >24h of validity remaining.
if [ -f "$CERT_FILE" ] && \
   openssl x509 -in "$CERT_FILE" -checkend 86400 -noout 2>/dev/null; then
  echo "Dev TLS cert valid, skipping generation"
  exit 0
fi

echo "Generating dev TLS certificate for localhost..."

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 \
  -keyout "$KEY_FILE" -out "$CERT_FILE" \
  -days 825 -nodes -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

chmod 600 "$KEY_FILE"

echo "Generated dev TLS cert at $CERTS_DIR/"
