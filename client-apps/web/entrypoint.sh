#!/bin/sh
set -e

# Generate runtime configuration from environment variables.
# The web app fetches this file on startup to configure API URL, auth mode,
# and OIDC parameters without requiring a rebuild.
cat > /usr/share/nginx/html/config.json <<EOF
{
  "apiUrl": "${API_URL:-http://localhost:7234}",
  "authMode": "${AUTH_MODE:-disabled}",
  "oidcIssuer": "${OIDC_ISSUER:-}",
  "oidcClientId": "${OIDC_CLIENT_ID:-}",
  "oidcAudience": "${OIDC_AUDIENCE:-}"
}
EOF

exec nginx -g 'daemon off;'
