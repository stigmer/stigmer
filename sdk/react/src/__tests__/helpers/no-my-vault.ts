/**
 * The vault client a composer test hands its mock Stigmer when the person
 * has saved nothing yet: `getMine` answers the server's NOT_FOUND, which
 * `useMyVault` reads as "no My vault" (an empty pool), never as a failure,
 * so the composer's My vault read settles as it does for a new person.
 */
import { vi } from "vitest";
import { Code } from "@connectrpc/connect";
import { StigmerError } from "@stigmer/sdk";

/** A `vault` client whose `getMine` answers NOT_FOUND. */
export function noMyVaultClient(): { getMine: ReturnType<typeof vi.fn> } {
  return {
    getMine: vi
      .fn()
      .mockRejectedValue(new StigmerError("not-found", "no My vault yet", Code.NotFound)),
  };
}
