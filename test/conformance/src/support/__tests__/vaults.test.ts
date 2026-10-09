// Unit arms for the vault support seams the suites build requests with.
// - The vault builders: a shared vault's create shape (its organization,
//   an empty entry set, the external id), the two entry-write targets (the
//   caller's own My vault by `mine`, a vault by id), and each entry write's
//   input carrying its target and its names, values or addresses.
// - The `vaults` option of every surface builder (share, schedule,
//   session) names each vault by slug with the vault kind, and a builder
//   given none sets no list; a session's includeMyVault is set only when
//   given.
// - A schedule's repository carries the token a fixture gives it, and a
//   run's first-turn My vault choice rides its new session, refused beside
//   an existing session id.
// Pure: hand-built shapes, no target.
// Domain: conformance support (vaults).
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { describe, expect, it } from "vitest";

import { makeAgentShare } from "../agentshares";
import { makeAgentExecution } from "../runs";
import { makeSchedule } from "../schedules";
import { makeSessionSpec } from "../sessions";
import {
  makeSharedVault,
  myVaultTarget,
  removeConnectionsInput,
  removeSecretsInput,
  setConnectionInput,
  setSecretsInput,
  vaultTarget,
} from "../vaults";

const VAULT_REFS = [
  { slug: "support-tools", kind: ApiResourceKind.vault },
  { slug: "handbook", kind: ApiResourceKind.vault },
];

describe("vault builders", () => {
  it("shapes a shared vault for create: its organization, no entries, the external id", () => {
    const vault = makeSharedVault({ org: "acme", name: "Support tools", externalId: "cust-1" });
    expect(vault.metadata).toEqual({ name: "Support tools", org: "acme" });
    expect(vault.spec).toEqual({ description: "conformance fixture", externalId: "cust-1" });
    expect(makeSharedVault({ org: "acme", name: "x", description: "d" }).spec).toEqual({
      description: "d",
      externalId: "",
    });
  });

  it("names the caller's own My vault by mine and any other vault by id", () => {
    expect(myVaultTarget("acme")).toEqual({ org: "acme", vault: { case: "mine", value: true } });
    expect(vaultTarget("acme", "vlt_1")).toEqual({ org: "acme", vault: { case: "id", value: "vlt_1" } });
  });

  it("carries the target and the entries on every entry write", () => {
    const target = myVaultTarget("acme");
    expect(setSecretsInput(target, { OPENAI_API_KEY: "sk-1" })).toEqual({
      vault: target,
      secrets: { OPENAI_API_KEY: { value: "sk-1", description: "" } },
    });
    expect(removeSecretsInput(target, ["OPENAI_API_KEY"])).toEqual({ vault: target, names: ["OPENAI_API_KEY"] });
    expect(setConnectionInput(target, "github.com", "ghp-1")).toEqual({
      vault: target,
      address: "github.com",
      token: "ghp-1",
      description: "",
    });
    expect(removeConnectionsInput(target, ["github.com"])).toEqual({ vault: target, addresses: ["github.com"] });
  });
});

describe("the vaults option of the surface builders", () => {
  const slugs = ["support-tools", "handbook"];

  it("names each vault by slug with the vault kind, and sets no list when none is given", () => {
    expect(makeAgentShare("acme", "bot", { vaults: slugs }).spec?.vaults).toEqual(VAULT_REFS);
    expect(makeAgentShare("acme", "bot").spec?.vaults).toBeUndefined();

    expect(makeSessionSpec({ vaults: slugs, includeMyVault: true })).toMatchObject({
      vaults: VAULT_REFS,
      includeMyVault: true,
    });
    expect(makeSessionSpec({}).includeMyVault).toBeUndefined();

    const schedule = makeSchedule("acme", "nightly", "bot", {
      vaults: slugs,
      repositories: [{ name: "app", url: "https://github.com/acme/app", token: "ghp-1" }],
    });
    const target = schedule.spec?.target;
    expect(target?.case).toBe("agent");
    const invocation = target?.case === "agent" ? target.value : undefined;
    expect(invocation?.vaults).toEqual(VAULT_REFS);
    expect(invocation?.workspaceEntries?.[0]?.source?.source).toEqual({
      case: "gitRepo",
      value: { url: "https://github.com/acme/app", token: "ghp-1" },
    });
    const tokenless = makeSchedule("acme", "n", "bot", {
      repositories: [{ name: "app", url: "https://github.com/acme/app" }],
    }).spec?.target;
    expect(tokenless?.case === "agent" ? tokenless.value.workspaceEntries?.[0]?.source?.source : undefined).toEqual({
      case: "gitRepo",
      value: { url: "https://github.com/acme/app", token: "" },
    });
  });

  it("puts a run's first-turn My vault choice on its new session and refuses it beside a session id", () => {
    const run = makeAgentExecution({ org: "acme", name: "r", includeMyVault: true });
    const target = run.spec?.target;
    expect(target?.case).toBe("sessionSpec");
    expect(target?.case === "sessionSpec" ? target.value.includeMyVault : undefined).toBe(true);
    expect(() =>
      makeAgentExecution({ org: "acme", name: "r", sessionId: "ses_1", includeMyVault: true }),
    ).toThrow(/sessionId excludes/);
  });
});
