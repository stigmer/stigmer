# @stigmer/outbound

The rules a Stigmer process follows when it dials a URL a user supplied, and the variables a sandbox's processes trust its egress gateway by, shared by the control plane (`@stigmer/server`), the runner (`@stigmer/runner`) and the catalogue audit (`plugins/scripts/audit`).

Three entry points:

- `@stigmer/outbound/egress`: which addresses a process refuses to dial (`blockedReason`, two postures, `strict` for managed cloud processes and `relaxed` for a machine that belongs to the user), the check that applies a policy to a URL after resolving every address it has (`checkEgress`), and the fetch that applies it to every redirect hop and bounds every response body (`guardedFetch`). A process composes one guarded fetch at its root and hands it to every module that dials; the modules hold no `fetch` of their own. And the names a sandbox's tools read their CA file from (`GATEWAY_TRUST_VARIABLES`): the control plane's sandbox template points each at the egress gateway's CA, and the runner passes each to the agent's host, the Environment install and every local MCP server, from this one list (stigmer#3392).
- `@stigmer/outbound/dial`: the pinned dialer (`pinnedFetch`), whose every socket opens to an address the policy judged at connect time, and `nodeGuardedFetch`, the guarded fetch over it that a server composes at its root. The check alone would leave a window: a name can resolve to a public address for the check and a private one for the socket. This entry stands apart because importing it loads undici, which registers itself as the process's dispatcher; a server already carries undici, while a process that does not would change every `fetch` it makes by importing the egress rules. undici is an optional peer of this library: a process that imports `/dial` installs `undici` beside it, at the version this package's `peerDependencies` names, and runs on Node 22.19 or newer on 22.x, or 23.8 or newer (the entry refuses an older Node at load, with one sentence naming the version). The other entries need only the family floor in `package.json` (Node 22.13, or 23.4), so a process that never imports `/dial` (the runner) installs no undici and meets no undici floor.
- `@stigmer/outbound/mcp-oauth`: how an MCP endpoint's authentication is read without a credential (`isOAuthChallenge`, the complete `initializeRequest`, `probeEndpointAuth`) and how its login server is found (`resolveAuthorizationServers` over RFC 9728, `readAuthorizationServerMetadata` over RFC 8414 with the issuer's path and OpenID's document).

## Why one library

Each rule here was first written where it was first needed: the address classification in the runner's `web_fetch` guard, the OAuth-challenge rule in the runner's failed-tool-call path, the complete handshake and the metadata walk in the catalogue audit. The control plane then needed all of them at once, to complete a URL-only server's `auth` at save time and to reach login servers on another origin, and a third copy would have let the storefront call OAuth what the runner called a bad token. So the rules moved here and every consumer imports them; the consumers keep only what is theirs (the runner its posture from its mode and its user-facing sentence, the control plane its edition driver point and its pinned validation copy, the audit its evidence and retry).

## Shape

Pure over injected `fetch` and `lookup`; the Node-bound modules are `egress/node-lookup.ts` and the dialer, `dial/pinned-fetch.ts`, which is the only module that loads undici (an optional peer, pinned to the exact version the server declares) and the library's one module with side effects. Every function that can fail on the network returns a value (`EgressCheck`, `EndpointAuthOutcome`, `MetadataRead`) rather than throwing, so a caller renders its own sentence; `EgressError` wraps a refusal for the guarded fetch. `OutboundFetch` is the fetch shape consumers take (`(url: string | URL, init?) => Promise<Response>`); the global `fetch` satisfies it.

Published in lockstep with the other `backend/libs/ts` libraries by `scripts/publish-libs.mjs`; the server and runner link it with `file:` and pin the release version at stamp time.

## Verify

`npm run typecheck && npm test` here. The consumers' suites when a rule changes: `make test-server`, `make test-runner`, `make test-plugins-static`.
