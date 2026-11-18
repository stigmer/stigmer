What a good answer may also say. Never graded: leaving any of it out fails nothing.

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
