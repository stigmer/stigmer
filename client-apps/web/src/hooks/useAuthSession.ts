export const GUEST_ROUTES: readonly string[] = [];

export interface UseAuthSessionReturn {
  session: null;
  loading: false;
  accessToken: undefined;
}

export function useAuthSession(): UseAuthSessionReturn {
  return { session: null, loading: false, accessToken: undefined };
}

export function signIn(): void {
  // no-op: auth is disabled in OSS mode. T03 will implement configurable auth.
}
