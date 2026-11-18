---
type: llm
---

Judge the answer on these points alone. It passes when it makes every Must point and does nothing a FAIL-if line names. Leaving out a Welcome point never fails it, and a correct point not listed here is no fault.

**Must**

- Lays out at least one of the two documented paths: minted user tokens (their server mints a Stigmer token for each signed-in user) or identity federation (Auth0 registered as a Federation Issuer so Stigmer trusts its tokens).
- When it gives the minting path: an admin service account's key stays on the server, in a route that mints a token for the user Auth0 signed in, with accounts created on sign-in.
- When it gives the federation path: the browser passes the Auth0 token to Stigmer, and federation is served by Stigmer Cloud and the Enterprise edition, not the open-source server.
- The browser renders Stigmer's React chat (for example `AgentChat` inside `StigmerProvider`) on a client that gets its token from that path, with no Stigmer key in browser code.

**FAIL if**

- It puts an API key in browser code or a `NEXT_PUBLIC_` variable.
- It has them mint with a person's key or a non-admin service account.
- It invents an "Auth0 integration" setting, a Stigmer login widget, or SDK options the docs don't name.
- It claims federation works on the open-source server.
- It tells them to proxy every Stigmer call through their own backend as the only option, without mentioning token minting or federation.

**Welcome**

- Naming both paths, with when to pick each.
- `tokens.invalidate()` on sign-out.
- Listing the app's origin under **Allowed origins**.
- Tokens live 15 minutes.
- `stigmer app-handover --stack nextjs --agent <agent>` printing or writing the route and chat.
- A server that trusts every caller (`stigmer up`) refuses to mint tokens.
- The minting route uses a stable user id, for example the Auth0 `sub`.
- The minting route, such as `app/api/stigmer-token/route.ts`, calls `stigmer.tokens.mintUserToken({ org, userId, userEmail, userName })` with the Auth0 `sub` as `userId` and returns `{ accessToken, expiresAt }`.
- Embedding settings: **Create accounts on sign-in** on and sign-in role `member` (console **Settings → Embedding**, or `stigmer embedding set --create-accounts-on-sign-in on --sign-in-role member`).
- Federation provisions accounts JIT (with a sign-in role) or manually, and the Auth0 JWT is passed through `getAccessToken`.
- The browser client is `new Stigmer({ baseUrl, getAccessToken })` (from `createTokenCache(...)` on the minting path), from `@stigmer/react-sdk`.
