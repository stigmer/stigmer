# @stigmer/outbound

The rules a Stigmer process follows when it dials a URL a user supplied, shared by the control plane (`@stigmer/server`), the runner (`@stigmer/runner`) and the catalogue audit (`plugins/scripts/audit`).

Two entry points:

- `@stigmer/outbound/egress`: which addresses a process refuses to dial (`blockedReason`, two postures, `strict` for managed cloud processes and `relaxed` for a machine that belongs to the user), the check that applies a policy to a URL after resolving every address it has (`checkEgress`), and the fetch that applies it to every redirect hop (`guardedFetch`). A process composes one guarded fetch at its root and hands it to every module that dials; the modules hold no `fetch` of their own.
- `@stigmer/outbound/mcp-oauth`: how an MCP endpoint's authentication is read without a credential (`isOAuthChallenge`, the complete `initializeRequest`, `probeEndpointAuth`) and how its login server is found (`resolveAuthorizationServers` over RFC 9728, `readAuthorizationServerMetadata` over RFC 8414 with the issuer's path and OpenID's document).

## Why one library

Each rule here was first written where it was first needed: the address classification in the runner's `web_fetch` guard, the OAuth-challenge rule in the runner's failed-tool-call path, the complete handshake and the metadata walk in the catalogue audit. The control plane then needed all of them at once, to complete a URL-only server's `auth` at save time and to reach login servers on another origin, and a third copy would have let the storefront call OAuth what the runner called a bad token. So the rules moved here and every consumer imports them; the consumers keep only what is theirs (the runner its posture from its mode and its user-facing sentence, the control plane its edition driver point and its pinned validation copy, the audit its evidence and retry).

## Shape

Pure over injected `fetch` and `lookup`; the one Node-bound module is `egress/node-lookup.ts`. Every function that can fail on the network returns a value (`EgressCheck`, `EndpointAuthOutcome`, `MetadataRead`) rather than throwing, so a caller renders its own sentence; `EgressError` wraps a refusal for the guarded fetch. `OutboundFetch` is the fetch shape consumers take (`(url: string | URL, init?) => Promise<Response>`); the global `fetch` satisfies it.

Published in lockstep with the other `backend/libs/ts` libraries by `scripts/publish-libs.mjs`; the server and runner link it with `file:` and pin the release version at stamp time.

## Verify

`npm run typecheck && npm test` here. The consumers' suites when a rule changes: `make test-server`, `make test-runner`, `make test-plugins-static`.
