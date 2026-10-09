/**
 * The per-server setup reducer ignores what it does not know: an action
 * outside its union (a caller compiled against another version of it) and a
 * transition from the wrong phase both leave the state untouched, so a stray
 * dispatch can never drop or corrupt an attached server.
 */
import { describe, it, expect } from "vitest";
import {
  mcpServerSetupReducer,
  type McpServerSetupAction,
  type McpServerSetupState,
} from "../mcpServerSetupReducer";

const LOADING: McpServerSetupState = {
  "acme/zendesk": { status: "loading", error: null },
};

describe("mcpServerSetupReducer", () => {
  it("returns the same state for an action outside its union", () => {
    const unknown = { type: "SET_ENABLED_TOOLS", key: "acme/zendesk" } as unknown as McpServerSetupAction;
    expect(mcpServerSetupReducer(LOADING, unknown)).toBe(LOADING);
  });

  it("returns the same state for a transition from the wrong phase", () => {
    expect(mcpServerSetupReducer(LOADING, { type: "SUBMIT_DONE", key: "acme/zendesk" })).toBe(LOADING);
    expect(mcpServerSetupReducer(LOADING, { type: "SUBMIT_UNREAD", key: "acme/zendesk" })).toBe(LOADING);
  });
});
