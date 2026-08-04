import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { describe, expect, it } from "vitest";
import { APPLY_HANDLERS } from "../resources/apply/handlers.js";
import { DELETE_HANDLERS } from "../resources/delete.js";
import { GET_BINDINGS } from "../resources/get-bindings.js";
import { LIST_HANDLERS, SEARCH_KINDS } from "../resources/list.js";
import { defaultRegistry } from "./registry.js";
import { Verb } from "./verbs.js";

const registry = defaultRegistry();

describe("registry — alias resolution", () => {
  it.each([
    ["mcp", ApiResourceKind.mcp_server],
    ["mcp-server", ApiResourceKind.mcp_server],
    ["mcp_server", ApiResourceKind.mcp_server],
    ["McpServer", ApiResourceKind.mcp_server],
    ["mcpservers", ApiResourceKind.mcp_server],
    ["agent", ApiResourceKind.agent],
    ["agents", ApiResourceKind.agent],
    ["agt", ApiResourceKind.agent],
    ["workflow", ApiResourceKind.workflow],
    ["wfl", ApiResourceKind.workflow],
    ["org", ApiResourceKind.organization],
    ["oapp", ApiResourceKind.oauth_app],
    ["agentchannel", ApiResourceKind.agent_channel],
    ["agent-channel", ApiResourceKind.agent_channel],
    ["agent_channel", ApiResourceKind.agent_channel],
    ["AgentChannel", ApiResourceKind.agent_channel],
    ["agentchannels", ApiResourceKind.agent_channel],
    ["ach", ApiResourceKind.agent_channel],
  ])("resolves %s -> kind", (alias, kind) => {
    expect(registry.getByAlias(alias)?.kind).toBe(kind);
  });

  it("agent_channel does not steal the agent alias (multi-word first-word guard)", () => {
    expect(registry.getByAlias("agent")?.kind).toBe(ApiResourceKind.agent);
  });

  it("resolution is case-insensitive", () => {
    expect(registry.getByAlias("MCP-SERVER")?.kind).toBe(ApiResourceKind.mcp_server);
  });

  it("returns undefined for an unknown alias", () => {
    expect(registry.getByAlias("nope")).toBeUndefined();
  });

  it("does not register agent_execution as an addressable type", () => {
    expect(registry.getByKind(ApiResourceKind.agent_execution)).toBeUndefined();
  });
});

describe("registry — YAML kind resolution", () => {
  it("resolves the exact YAML kind", () => {
    expect(registry.getByYamlKind("McpServer")?.kind).toBe(ApiResourceKind.mcp_server);
    expect(registry.getByYamlKind("Workflow")?.kind).toBe(ApiResourceKind.workflow);
  });
});

describe("registry — verb support matrix", () => {
  it("agent supports read + run + search verbs", () => {
    for (const v of [Verb.Apply, Verb.Validate, Verb.Get, Verb.List, Verb.Delete, Verb.Run, Verb.Search]) {
      expect(registry.supportsVerb(ApiResourceKind.agent, v)).toBe(true);
    }
    expect(registry.supportsVerb(ApiResourceKind.agent, Verb.Push)).toBe(false);
  });

  it("skill supports push but not apply", () => {
    expect(registry.supportsVerb(ApiResourceKind.skill, Verb.Push)).toBe(true);
    expect(registry.supportsVerb(ApiResourceKind.skill, Verb.Apply)).toBe(false);
  });

  it("workflow_instance has no list verb", () => {
    expect(registry.supportsVerb(ApiResourceKind.workflow_instance, Verb.Get)).toBe(true);
    expect(registry.supportsVerb(ApiResourceKind.workflow_instance, Verb.List)).toBe(false);
  });

  it("agent_channel supports the full declarative verb set", () => {
    for (const v of [Verb.Apply, Verb.Get, Verb.List, Verb.Delete]) {
      expect(registry.supportsVerb(ApiResourceKind.agent_channel, v)).toBe(true);
    }
    // The install flow is console-driven and cloud-only — never a CLI verb.
    expect(registry.supportsVerb(ApiResourceKind.agent_channel, Verb.Run)).toBe(false);
    expect(registry.supportsVerb(ApiResourceKind.agent_channel, Verb.Search)).toBe(false);
  });

  it("schedule supports the full declarative verb set", () => {
    for (const v of [Verb.Apply, Verb.Get, Verb.List, Verb.Delete]) {
      expect(registry.supportsVerb(ApiResourceKind.schedule, v)).toBe(true);
    }
    // Firing rides `stigmer schedule trigger`, never the generic run verb.
    expect(registry.supportsVerb(ApiResourceKind.schedule, Verb.Run)).toBe(false);
  });

  it("session and agent_share promise only apply (narrowed — stigmer/stigmer#354)", () => {
    for (const kind of [ApiResourceKind.session, ApiResourceKind.agent_share]) {
      expect(registry.supportsVerb(kind, Verb.Apply)).toBe(true);
      for (const v of [Verb.Get, Verb.List, Verb.Delete]) {
        expect(registry.supportsVerb(kind, v)).toBe(false);
      }
    }
  });

  it("typesForVerb(get) includes the core read kinds", () => {
    const kinds = new Set(registry.typesForVerb(Verb.Get).map((t) => t.kind));
    expect(kinds).toContain(ApiResourceKind.agent);
    expect(kinds).toContain(ApiResourceKind.workflow);
    expect(kinds).toContain(ApiResourceKind.mcp_server);
  });
});

describe("registry — completeness", () => {
  it("registers every CLI-relevant kind with metadata", () => {
    for (const info of registry.all()) {
      expect(info.name).not.toBe("");
      expect(info.singular).toBe(info.name.toLowerCase());
      expect(info.aliases.length).toBeGreaterThan(0);
    }
  });

});

// The verb matrix is a PROMISE (`list types` prints it; the command layer
// gates on it), but each verb actually runs through its own dispatch
// registry. A pair present in the matrix but absent from its registry fails
// at the point of use with "not implemented" — the stigmer/stigmer#353 bug
// class. This suite holds the two to strict bidirectional equality so the
// drift is a red test instead of a runtime surprise. Verbs deliberately
// withheld are narrowed out of the matrix (recorded in stigmer/stigmer#354),
// never exempted here — an exemption category would legitimize exactly the
// state this suite exists to reject.
describe("registry — verb/dispatch conformance", () => {
  // Special cases are kind/verb pairs that genuinely work through bespoke
  // code instead of a registry entry; each names its dispatch site.
  const DISPATCH: ReadonlyArray<{
    label: string;
    verb: Verb;
    wired: ReadonlySet<ApiResourceKind>;
    specialCases: ReadonlyMap<ApiResourceKind, string>;
  }> = [
    {
      label: "apply",
      verb: Verb.Apply,
      wired: new Set(APPLY_HANDLERS.keys()),
      specialCases: new Map([
        [
          ApiResourceKind.project,
          "the stigmer.yaml declarative/synthesis track (resources/apply/declarative.ts); " +
            "file mode refuses with a pointer there (resolveHandlerForKind)",
        ],
      ]),
    },
    {
      label: "get",
      verb: Verb.Get,
      wired: new Set(GET_BINDINGS.keys()),
      specialCases: new Map([
        [
          ApiResourceKind.organization,
          "fetchOrganization in resources/get.ts (not org-scoped; a slug resolves via findMyOrganizations)",
        ],
      ]),
    },
    {
      label: "list",
      verb: Verb.List,
      wired: new Set([...LIST_HANDLERS.keys(), ...SEARCH_KINDS]),
      specialCases: new Map(),
    },
    {
      label: "delete",
      verb: Verb.Delete,
      wired: new Set(DELETE_HANDLERS.keys()),
      specialCases: new Map([
        [
          ApiResourceKind.organization,
          "planOrganizationDelete in resources/delete.ts (not org-scoped; resolved via memberships)",
        ],
      ]),
    },
  ];

  it.each(DISPATCH)("every kind promising '$label' has a dispatch entry", ({ verb, wired, specialCases }) => {
    for (const info of registry.all()) {
      if (!info.supportedVerbs.has(verb)) continue;
      if (specialCases.has(info.kind)) continue;
      expect(
        wired.has(info.kind),
        `${info.name} promises '${verb}' in the verb matrix but has no dispatch entry — ` +
          "wire it or narrow the matrix (stigmer/stigmer#353, #354)",
      ).toBe(true);
    }
  });

  it.each(DISPATCH)("every '$label' dispatch entry is promised in the matrix", ({ verb, wired }) => {
    for (const kind of wired) {
      expect(
        registry.supportsVerb(kind, verb),
        `${ApiResourceKind[kind]} is wired for '${verb}' but the verb matrix does not promise it — ` +
          "dead dispatch the command-layer gate blocks",
      ).toBe(true);
    }
  });

  it("special cases do not shadow a real dispatch entry", () => {
    for (const { label, wired, specialCases } of DISPATCH) {
      for (const kind of specialCases.keys()) {
        expect(
          wired.has(kind),
          `${ApiResourceKind[kind]} '${label}' is documented as a special case yet also has a registry entry — drop one`,
        ).toBe(false);
      }
    }
  });
});
