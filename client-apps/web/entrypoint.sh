#!/bin/sh
set -e

# Generate runtime configuration from NEXT_PUBLIC_* environment variables.
# Uses the same variable names as Next.js local dev (.env files) so that
# one set of names works everywhere.
cat > /usr/share/nginx/html/config.json <<EOF
{
  "apiUrl": "${NEXT_PUBLIC_API_URL:-http://localhost:7234}",
  "appUrl": "${NEXT_PUBLIC_APP_URL:-}",
  "authMode": "${NEXT_PUBLIC_AUTH_MODE:-disabled}",
  "oidcIssuer": "${NEXT_PUBLIC_OIDC_ISSUER:-}",
  "oidcClientId": "${NEXT_PUBLIC_OIDC_CLIENT_ID:-}",
  "oidcAudience": "${NEXT_PUBLIC_OIDC_AUDIENCE:-}"
}
EOF

exec nginx -g 'daemon off;'
