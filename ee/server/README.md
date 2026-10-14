# @stigmer/enterprise

Stigmer Enterprise: the Stigmer server with many organizations, federation with the platforms whose tokens it trusts, teams and invitations, turned on by a license key.

This package is the Enterprise half of one server. It runs on `@stigmer/server`, the open-source control plane, and adds to it through the library's own extension points; it changes none of the library's behaviour. Its source is published under the Stigmer Enterprise License (see `LICENSE` in this folder), not under the Apache License that covers the rest of this repository.

## What a key turns on

The server reads one license key at boot and decides its edition once:

- **No key**: the server is the open-source server exactly, one organization and all. No Enterprise code path runs.
- **A key that does not verify**: the boot is refused with the reason (an unknown key, a signature that does not match, contents that do not read, or a ticket that is not one), and the process exits 1. It never falls back to open source silently, because that would sign every single-sign-on person out over a typo.
- **A verified key**: the Enterprise edition, on Postgres. Its tables live in their own `ee` schema beside the library's, created and migrated by the server at start.

A license is verified offline, against the public keys compiled into this package; there is no setting that adds a key. When a license and its grace period have ended, the server keeps running and keeps every person, organization and record: it refuses only growth (a new organization, a new team, a new or changed identity provider) until a renewed key is pasted. How long production use in that mode stays licensed is the license's to say (see `LICENSE`), not the code's: the server never locks anyone out.

## Running it

The package's process entry is `main.js` at the root of its build output, a one-line shim that loads the entry proper, `src/editions/enterprise-entry.ts`: it reads the key and boots the edition it decides through the library's own process body. Everything the open-source server reads (the database, the operator's sign-in issuer, the ports, Temporal) is read the same way. Beside that, the Enterprise server reads:

| Variable | Meaning |
|---|---|
| `STIGMER_LICENSE_KEY` | The license key. Unset or blank: the server runs as open source. |
| `STIGMER_OUTBOUND_EGRESS` | Which addresses a licensed server may dial when it reaches a URL a person wrote (an identity provider's documents, an MCP or plugin install probe, a vault sign-in). Unset, blank or `strict`: public addresses only, the default. `relaxed`: private and loopback addresses too, link-local still refused. Read only when a license key is set: without one the server is the open-source edition exactly and ignores this variable. With a key, any other value refuses the boot. |
| `STIGMER_ACCESS_HISTORY_RETENTION_DAYS` | How many days a licensed server keeps the access history (who gave whom access to what). Unset or blank: every entry is kept. A whole number of days, at least 1 (for example `365`): once an hour the server removes the entries older than that, in every organization, deleted ones included; the numbering continues, and every page of the history says how long it is kept and the oldest entry it still holds. Read only when a license key is set. With a key, any other value (`0`, `365d`, `1y`) refuses the boot. |
| `DATABASE_URL` | Required with a key: Stigmer Enterprise runs on Postgres. |
| `STIGMER_PLATFORM_TOKEN_KEY` | The key the server signs its own tokens with. Unset, the server generates one and keeps it under its home directory; a server run as several replicas sets it so they share one key. |

## The server image

Every release also publishes this server as a container image, `ghcr.io/stigmer/stigmer-server-ee`, for linux/amd64 and linux/arm64. It is the open-source `stigmer-server` image built from the same Dockerfile (`backend/services/stigmer-server/README.md`, "Docker image": the same `/data` volume, ports and health check, the web console included) plus this package: its `/app` is the server's slim bundle with this package's `main.js` as the entry. The npm package ships no console, so the image is how a self-hosted Enterprise server gets one.

```bash
# No key: the open-source server exactly.
docker run -d -p 7234:7234 -p 7235:7235 -v stigmer-data:/data \
  ghcr.io/stigmer/stigmer-server-ee:latest

# A license key, on Postgres.
docker run -d -p 7234:7234 -p 7235:7235 -v stigmer-data:/data \
  -e STIGMER_LICENSE_KEY="<the key>" \
  -e DATABASE_URL="postgres://<user>:<password>@<host>:5432/<database>" \
  ghcr.io/stigmer/stigmer-server-ee:latest
```

The image reads the variables in the table above, and everything the open-source image reads. A key it cannot verify stops the container with exit code 1 and one `boot failed:` line saying why. An image only trusts the signing keys compiled into its release, and none is compiled in yet: until a release carries the production key, every image refuses every key, and runs as open source without one.

Its labels say what it holds: `org.opencontainers.image.title` is `stigmer-server-ee`, and `org.opencontainers.image.licenses` is `LicenseRef-Stigmer-Enterprise AND Apache-2.0`, this package under `LICENSE` (which sits beside `main.js` in `/app`) and the open-source server under the Apache License 2.0.

Tags: `vX.Y.Z` for each release; `latest` moves only to a stable release, after the pushed image has passed its smoke on native runners of both architectures. Local build and smoke: `make smoke-ee-image`, which bundles the tree (`make bundle-ee-slim`) and runs `scripts/smoke-image.mjs`: the labels, the open-source server's own image smoke with no key, and two keys it cannot verify refused.

## Using it as a library

A host that composes the Enterprise identity unit beside units of its own imports it from the package's one entry, `@stigmer/enterprise`: the unit's builder and its ports, the Postgres side built over the host's pool and its schema chain, the license verifier and the state a verified license is in, the growth gate, and the contract kits an adapter of the unit's ports must pass. The server's own composition from a license verdict, the license status it reports and the growth freeze it builds are not exported: a server that runs Stigmer Enterprise runs this package's entry, whose trusted keys are compiled in.

## Building and testing

```bash
npm install
npm run build
npm run typecheck
npm test
```

The suites that need Postgres read `TEST_DATABASE_URL` and skip by name without it; `STIGMER_TEST_GATE=1` makes a missing database a failure instead. `docs/enterprise-authorization-coverage.md` is the authorization inventory of the RPCs the unit serves, held to the served methods by the unit's own test.
