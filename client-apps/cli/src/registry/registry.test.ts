import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { describe, expect, it } from "vitest";
import { APPLY_HANDLERS } from "../resources/apply/handlers.js";
import { DELETE_HANDLERS } from "../resources/delete.js";
import { GET_BINDINGS } from "../resources/get-bindings.js";
import { isExecutionAlias } from "../resources/execution.js";
import { LIST_HANDLERS, SEARCH_KINDS } from "../resources/list.js";
import { VALIDATE_SCHEMAS } from "../resources/validate.js";
import { normalizeAlias } from "./aliases.js";
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
    // The canonical proto enum name and its kebab/plural companions
    // (stigmer/stigmer#470) plus the historical split-derived spellings,
    // which must keep working.
    ["oauth_app", ApiResourceKind.oauth_app],
    ["oauth-app", ApiResourceKind.oauth_app],
    ["oauth_apps", ApiResourceKind.oauth_app],
    ["o_auth_app", ApiResourceKind.oauth_app],
    ["o-auth-app", ApiResourceKind.oauth_app],
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

  // The runtime execution kinds are served by the pre-gate `list executions`
  // route and their dedicated controllers; registering either would put a
  // row in `list types` that the pre-gate route then shadows — the
  // stigmer/stigmer#469 class (see the alias-shadowing suite below).
  it("does not register the runtime execution kinds as addressable types", () => {
    for (const kind of [ApiResourceKind.agent_execution, ApiResourceKind.workflow_execution]) {
      expect(registry.getByKind(kind)).toBeUndefined();
    }
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

  it("agent_share promises only apply (narrowed — stigmer/stigmer#354)", () => {
    expect(registry.supportsVerb(ApiResourceKind.agent_share, Verb.Apply)).toBe(true);
    for (const v of [Verb.Get, Verb.List, Verb.Delete]) {
      expect(registry.supportsVerb(ApiResourceKind.agent_share, v)).toBe(false);
    }
  });

  it("session promises apply + list; get/delete stay narrowed (stigmer/stigmer#354, #469)", () => {
    expect(registry.supportsVerb(ApiResourceKind.session, Verb.Apply)).toBe(true);
    expect(registry.supportsVerb(ApiResourceKind.session, Verb.List)).toBe(true);
    for (const v of [Verb.Get, Verb.Delete]) {
      expect(registry.supportsVerb(ApiResourceKind.session, v)).toBe(false);
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

  // The canonical proto enum name is the spelling a proto-literate user is most
  // likely to type; it must resolve for EVERY kind by construction, not by
  // accident of PascalCase spelling. OAuthApp was the counterexample
  // (stigmer/stigmer#470): its split-derived aliases (o_auth_app) diverged from
  // the proto name (oauth_app), so only it failed.
  it("resolves every registered kind's canonical proto enum name (snake and kebab)", () => {
    for (const info of registry.all()) {
      const protoName = ApiResourceKind[info.kind];
      expect(
        registry.getByAlias(protoName)?.kind,
        `canonical proto name '${protoName}' must resolve to its own kind`,
      ).toBe(info.kind);
      const kebab = protoName.replaceAll("_", "-");
      expect(
        registry.getByAlias(kebab)?.kind,
        `kebab form '${kebab}' of the canonical proto name must resolve to its own kind`,
      ).toBe(info.kind);
    }
  });

  // buildRegistry's byAlias.set is last-wins: a collision between two kinds'
  // alias sets would silently shadow the earlier kind. The one collision found
  // by hand ("Agent Instance" nearly stealing "agent") is prevented inside
  // generateAliases; this pin makes the whole class a red test instead of a
  // hand-check as future kinds (and their derived forms) are added.
  it("no two kinds share an alias (silent last-wins shadowing guard)", () => {
    const claimedBy = new Map<string, string>();
    for (const info of registry.all()) {
      for (const alias of info.aliases) {
        const key = normalizeAlias(alias);
        const owner = claimedBy.get(key);
        expect(
          owner === undefined || owner === info.name,
          `alias '${key}' is claimed by both ${owner} and ${info.name} — the later registration silently wins`,
        ).toBe(true);
        claimedBy.set(key, info.name);
      }
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
      label: "validate",
      verb: Verb.Validate,
      wired: new Set(VALIDATE_SCHEMAS.keys()),
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

// `stigmer list` resolves a handful of aliases BEFORE consulting the
// registry (commands/list.ts): `types` (a command word, not a kind) and the
// execution family. A pre-gate alias that intercepts a REGISTERED kind hides
// that kind's registry dispatch behind bespoke behavior the verb matrix
// cannot describe — sessions shipped working-but-unadvertised for two months
// exactly this way (stigmer/stigmer#469). Every pre-gate predicate must be
// listed here; the pin holds each one away from every registered kind's
// alias set, so a future bypass for an addressable kind is a red test, not
// a silently lying `list types` row.
describe("registry — pre-gate list aliases cannot shadow registered kinds", () => {
  const PRE_GATE_PREDICATES: ReadonlyArray<{ name: string; matches: (type: string) => boolean }> = [
    { name: "executions (resources/execution.ts isExecutionAlias)", matches: isExecutionAlias },
  ];

  it("no registered kind's alias is intercepted by a pre-gate predicate", () => {
    for (const { name, matches } of PRE_GATE_PREDICATES) {
      for (const info of registry.all()) {
        for (const alias of info.aliases) {
          expect(
            matches(alias),
            `registry alias '${alias}' (${info.name}) is intercepted by the pre-gate route ${name} — ` +
              "it shadows the kind's registry dispatch (the stigmer/stigmer#469 works-but-unadvertised class)",
          ).toBe(false);
        }
      }
    }
  });
});
