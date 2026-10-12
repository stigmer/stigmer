/**
 * A purge context's row reader for a stage's tests, which inject their
 * stage's own reads: it answers one empty page for every kind, so a stage
 * that does read through it finds nothing.
 */
import type { OrganizationRows } from "@stigmer/server";

export function noRows(): OrganizationRows {
  return {
    ids: () => Promise.resolve({ ids: [], next: undefined }),
  };
}
