// ---------------------------------------------------------------------------
// Token store — bridge between auth providers and the transport layer
//
// Auth providers write the access token here via setAuthToken(). The
// Connect-RPC transport interceptor reads it via getAuthToken() on every
// request. This decoupling keeps transport.ts free of React context
// dependencies (Connect-RPC clients are module-level singletons).
// ---------------------------------------------------------------------------

let _token: string | null = null;

export function getAuthToken(): string | null {
  return _token;
}

export function setAuthToken(token: string | null): void {
  _token = token;
}
