---
type: llm
---

PASS if the answer lays out one of the two documented paths correctly, and ideally names both with when to pick each:
- **Minted user tokens**: an admin service account's API key on the server only; a Next.js route (such as `app/api/stigmer-token/route.ts`, `GET /api/stigmer-token`) that, for the user Auth0 says is signed in, calls `stigmer.tokens.mintUserToken({ org, userId, userEmail, userName })` with a stable `userId` (for example the Auth0 `sub`) and returns `{ accessToken, expiresAt }`; the Organization's embedding settings with **Create accounts on sign-in** on and the sign-in role `member` (console Settings → Embedding, or `stigmer embedding set --create-accounts-on-sign-in on --sign-in-role member`); the browser builds `new Stigmer({ baseUrl, getAccessToken: tokens.getAccessToken })` from `createTokenCache(...)`, wraps the page in `StigmerProvider`, and renders `AgentChat` from `@stigmer/react-sdk`; `tokens.invalidate()` on sign-out.
- **Identity federation**: register Auth0 as a Federation Issuer so Stigmer trusts its tokens, with JIT provisioning (a sign-in role) or manual provisioning, and pass the Auth0 JWT through `getAccessToken`; and it says federation is served by Stigmer Cloud and the Enterprise edition, not the open-source server.
Welcome but optional: listing the app's origin under **Allowed origins**; tokens living 15 minutes; `stigmer app-handover --stack nextjs --agent <agent>` printing or writing the route and chat; a server that trusts every caller (`stigmer up`) refusing to mint tokens.

FAIL if the answer puts an API key in browser code or a `NEXT_PUBLIC_` variable; has them mint with a person's key or a non-admin service account; invents an "Auth0 integration" setting, a Stigmer login widget, or SDK options the docs don't name; claims federation works on the open-source server; or tells them to proxy every Stigmer call through their own backend as the only option without mentioning token minting or federation.
