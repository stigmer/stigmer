/**
 * The whole of a list, for a hook whose consumer needs every entry (a
 * picker, a lookup by id) over a set that stays small. It walks the list's
 * tokens at the largest page the server serves, and refuses past the SDK's
 * cap rather than hand a cut list to a caller that would read it as the
 * whole (`readEveryPage` in `@stigmer/sdk`).
 *
 * @internal Not part of the public `@stigmer/react` API.
 */
export { readEveryPage } from "@stigmer/sdk";

/** The largest page a list serves; a walk reads at this size. */
export const LIST_PAGE_MAX = 100;
