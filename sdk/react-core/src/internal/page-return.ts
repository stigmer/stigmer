/**
 * The moment a person comes back to a page: the tab is shown again, or the
 * network returns. A follow waiting out a reconnect backoff re-opens then
 * instead of tens of seconds later.
 *
 * Outside a browser (the Ink CLI runs the session hooks under Node) there is
 * nothing to listen to, and the returned unsubscribe does nothing.
 *
 * @internal Not part of the public `@stigmer/react-sdk` API.
 */

/** Calls `onReturn` each time the tab is shown or the network returns; returns the unsubscribe. */
export function onPageReturn(onReturn: () => void): () => void {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  const onVisible = () => {
    if (document.visibilityState === "visible") onReturn();
  };
  window.addEventListener("online", onReturn);
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    window.removeEventListener("online", onReturn);
    document.removeEventListener("visibilitychange", onVisible);
  };
}
