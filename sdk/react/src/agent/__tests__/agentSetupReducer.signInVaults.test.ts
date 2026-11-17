/**
 * Where owed sign-ins can be saved (`signInVaults`) travels with the
 * sign-ins through every arm that builds or keeps a waiting state, so the
 * panel never loses it: `RESOLVE_NEEDS_ENV` sets it, `SUBMIT_START` carries
 * it into `submitting`, a failed submission (`ERROR`) brings it back to
 * `needsEnvVars`, and `SIGN_IN_COMPLETED` leaves it as it was.
 */
import { describe, expect, it } from "vitest";
import { create } from "@bufbuild/protobuf";
import { McpServerEntrySchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import { agentSetupReducer, INITIAL_STATE, type SignInVaults } from "../agentSetupReducer";

const AGENT_REF = { org: "org_acme", slug: "reviewer" };
const LINEAR = {
  plugin: { org: "org_globex", slug: "linear" },
  pluginName: "linear",
  server: create(McpServerEntrySchema, { name: "linear" }),
  address: "https://mcp.linear.app/mcp",
  name: "linear",
};
const JIRA = { ...LINEAR, address: "https://mcp.jira.example/mcp", name: "jira" };
const SHARED: SignInVaults = { kind: "shared", vaults: [{ org: "org_acme", id: "vlt_team", name: "Team logins" }] };

function waiting() {
  return agentSetupReducer(INITIAL_STATE, {
    type: "RESOLVE_NEEDS_ENV",
    agentRef: AGENT_REF,
    agentId: "agt_1",
    agentName: "Reviewer",
    missingVariables: [],
    pendingSignIns: [LINEAR, JIRA],
    signInVaults: SHARED,
  });
}

describe("agentSetupReducer carries signInVaults", () => {
  it("sets it on the waiting state", () => {
    expect(waiting()).toMatchObject({ status: "needsEnvVars", signInVaults: SHARED });
  });

  it("keeps it through a submission that fails", () => {
    const submitting = agentSetupReducer(waiting(), { type: "SUBMIT_START" });
    expect(submitting).toMatchObject({ status: "submitting", signInVaults: SHARED });
    const failed = agentSetupReducer(submitting, { type: "ERROR", error: new Error("the save failed") });
    expect(failed).toMatchObject({ status: "needsEnvVars", signInVaults: SHARED, pendingSignIns: [LINEAR, JIRA] });
    expect(failed.error?.message).toBe("the save failed");
  });

  it("leaves it as it was when one sign-in completes", () => {
    const after = agentSetupReducer(waiting(), { type: "SIGN_IN_COMPLETED", address: LINEAR.address });
    expect(after).toMatchObject({ status: "needsEnvVars", pendingSignIns: [JIRA] });
    expect(after.status === "needsEnvVars" && after.signInVaults).toBe(SHARED);
  });
});
