// Whether a request failed because Stigmer's server never answered (no
// connection, a dropped one, the server down), as opposed to answering no.
// The session view says the drawn words for that case only; any other kind
// of failure keeps the client's own sentence for it.

import { classifyError, isTransientStreamError } from "@stigmer/client";

/** Whether `error` means the server wasn't reached: unavailable, or transport noise the client couldn't classify. */
export function isUnreachable(error: unknown): boolean {
  const category = classifyError(error);
  return category === "unavailable" || (category === "unknown" && isTransientStreamError(error));
}
