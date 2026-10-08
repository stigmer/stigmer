/**
 * The platform-filled key set (stigmer/stigmer#1446): the keys setup never
 * prompts for, because the runner fills them. `STIGMER_SERVER_ADDRESS` is
 * one; `STIGMER_API_KEY` is not, so a server that declares it asks its user
 * for a key like any other secret instead of silently receiving nothing.
 */
import { describe, it, expect } from "vitest";
import { SYSTEM_ENV_VAR_KEYS } from "../systemEnvVars";

describe("SYSTEM_ENV_VAR_KEYS", () => {
  it("holds exactly the key the platform fills", () => {
    expect([...SYSTEM_ENV_VAR_KEYS]).toEqual(["STIGMER_SERVER_ADDRESS"]);
  });

  it("leaves STIGMER_API_KEY to the user, so setup prompts for it", () => {
    expect(SYSTEM_ENV_VAR_KEYS.has("STIGMER_API_KEY")).toBe(false);
  });
});
