/**
 * Pins the reference rule (pipeline/steps/references.ts): the table is
 * exactly the set of kinds the contract lets a spec reference (walked from
 * the schemas of every kind whose chain runs the rule, plus the agent_call
 * task config, through the `reference_kind` field option); each clause on
 * each kind — no org refused, a same-organization target must exist, the
 * floor applies to the kinds the run reads as the person and to no other,
 * a cross-organization target is admitted only at platform visibility with
 * ONE sentence whether it is missing or merely not shared; the MCP-server
 * copy that predates the rule is byte-identical and its siblings take its
 * shape; the walk reads a reference's kind from its field, not from the
 * message; the step over a real store loads each referenced kind once; and
 * the escalation door asks the floor alone — a dependency that has left is
 * not its question — and only when the level is being raised.
 */
import { create } from "@bufbuild/protobuf";
import type { DescField, DescMessage } from "@bufbuild/protobuf";
import { getOption, hasOption } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { ExecutionContextSchema } from "@stigmer/protos/ai/stigmer/agentic/executioncontext/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { AgentCallTaskConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/tasks/agent_call_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowinstance/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { reference_kind } from "@stigmer/protos/ai/stigmer/commons/apiresource/field_options_pb";
import { UpdateVisibilityInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import type { Store } from "../../../store/interface.js";
import { SqliteStore } from "../../../store/sqlite/store.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import { RequestContext } from "../../request-context.js";
import { testCallerIdentity } from "../../__tests__/support.js";
import {
  REFERENCE_TARGET_KINDS,
  belowFloorMessage,
  checkReference,
  checkReferences,
  collectSpecReferences,
  loadReferenceTargets,
  missingReferencesMessage,
  newGuardReferenceFloorOnEscalationStep,
  newValidateReferencesStep,
  noOrgReferenceMessage,
  notAvailableReferenceMessage,
  referenceTargetKind,
} from "../references.js";
import type {
  ReferenceParent,
  ReferenceTargets,
  SpecReference,
} from "../references.js";

const V = ApiResourceVisibility;
const K = ApiResourceKind;

/** The error a step throws, awaited whether the step is sync or async. */
async function failureOf(run: () => void | Promise<void>): Promise<unknown> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return error;
  }
}

// ---------------------------------------------------------------------------
// The table against the contract.
// ---------------------------------------------------------------------------

/** The schemas of every kind whose create or update chain runs the rule, plus the Struct-borne task config. */
const SCHEMAS_UNDER_THE_RULE: ReadonlyArray<DescMessage> = [
  AgentSchema,
  McpServerSchema,
  WorkflowSchema,
  AgentInstanceSchema,
  WorkflowInstanceSchema,
  EnvironmentSchema,
  ScheduleSchema,
  AgentChannelSchema,
  AgentShareSchema,
  SessionSchema,
  AgentExecutionSchema,
  WorkflowExecutionSchema,
  ExecutionContextSchema,
  AgentCallTaskConfigSchema,
];

/** Every `reference_kind` declared on a field reachable from `schema`, recursively. */
function declaredReferenceKinds(
  schema: DescMessage,
  seen = new Set<string>(),
  out = new Set<ApiResourceKind>(),
): Set<ApiResourceKind> {
  if (seen.has(schema.typeName)) {
    return out;
  }
  seen.add(schema.typeName);
  for (const field of schema.fields) {
    if (hasOption(field, reference_kind)) {
      out.add(getOption(field, reference_kind));
    }
    const nested = messageOf(field);
    if (nested !== undefined) {
      declaredReferenceKinds(nested, seen, out);
    }
  }
  return out;
}

function messageOf(field: DescField): DescMessage | undefined {
  switch (field.fieldKind) {
    case "message":
      return field.message;
    case "list":
      return field.listKind === "message" ? field.message : undefined;
    case "map":
      return field.mapKind === "message" ? field.message : undefined;
    case "scalar":
    case "enum":
      return undefined;
    default: {
      const exhaustive: never = field;
      throw new Error(`unknown field kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

describe("REFERENCE_TARGET_KINDS against the contract", () => {
  it("is exactly the set of reference_kind values a spec under the rule can carry", () => {
    const declared = new Set<ApiResourceKind>();
    for (const schema of SCHEMAS_UNDER_THE_RULE) {
      for (const kind of declaredReferenceKinds(schema)) {
        declared.add(kind);
      }
    }
    expect([...declared].sort()).toEqual(
      REFERENCE_TARGET_KINDS.map((entry) => entry.kind).sort(),
    );
  });

  it("names the kinds the run reads as the person, and no other", () => {
    expect(
      REFERENCE_TARGET_KINDS.filter((e) => e.readByRun).map((e) => e.kind),
    ).toEqual([K.skill, K.mcp_server, K.agent]);
    expect(
      REFERENCE_TARGET_KINDS.filter((e) => !e.readByRun).map((e) => e.kind),
    ).toEqual([K.environment, K.channel_app, K.oauth_app]);
  });
});

// ---------------------------------------------------------------------------
// The clauses, over a fixture of targets.
// ---------------------------------------------------------------------------

function targetsOf(
  rows: ReadonlyArray<{
    kind: ApiResourceKind;
    org: string;
    slug: string;
    visibility: ApiResourceVisibility;
  }>,
): ReferenceTargets {
  return {
    visibilityOf(ref) {
      return rows.find(
        (row) =>
          row.kind === ref.kind && row.org === ref.org && row.slug === ref.slug,
      )?.visibility;
    },
  };
}

const ACME_ORG: ReferenceParent = { org: "acme", visibility: V.visibility_org };
const ACME_PRIVATE: ReferenceParent = {
  org: "acme",
  visibility: V.visibility_private,
};

const ref = (
  kind: ApiResourceKind,
  org: string,
  slug: string,
): SpecReference => ({ kind, org, slug });

describe("checkReference", () => {
  const targets = targetsOf([
    {
      kind: K.skill,
      org: "acme",
      slug: "org-skill",
      visibility: V.visibility_org,
    },
    {
      kind: K.skill,
      org: "acme",
      slug: "my-skill",
      visibility: V.visibility_private,
    },
    {
      kind: K.mcp_server,
      org: "acme",
      slug: "github",
      visibility: V.visibility_org,
    },
    {
      kind: K.environment,
      org: "acme",
      slug: "personal",
      visibility: V.visibility_private,
    },
    {
      kind: K.skill,
      org: "globex",
      slug: "shared",
      visibility: V.visibility_platform,
    },
    {
      kind: K.skill,
      org: "globex",
      slug: "internal",
      visibility: V.visibility_org,
    },
    {
      kind: K.environment,
      org: "globex",
      slug: "theirs",
      visibility: V.visibility_org,
    },
  ]);

  it("(i) a reference with no organization is refused before anything is looked up", () => {
    expect(
      checkReference(targets, ACME_ORG, ref(K.skill, "", "org-skill")),
    ).toEqual({ kind: "no-org" });
  });

  it("(ii) a same-organization target must exist, for every kind", () => {
    expect(
      checkReference(targets, ACME_ORG, ref(K.skill, "acme", "org-skill")),
    ).toEqual({ kind: "ok" });
    for (const entry of REFERENCE_TARGET_KINDS) {
      expect(
        checkReference(targets, ACME_ORG, ref(entry.kind, "acme", "ghost")),
        entry.label,
      ).toEqual({ kind: "missing" });
    }
  });

  it("(ii) the floor: a run-read dependency may not be less visible than the resource", () => {
    expect(
      checkReference(targets, ACME_ORG, ref(K.skill, "acme", "my-skill")),
    ).toEqual({
      kind: "below-floor",
      targetVisibility: V.visibility_private,
    });
    // A private resource sits at the floor's bottom: anything it references clears it.
    expect(
      checkReference(targets, ACME_PRIVATE, ref(K.skill, "acme", "my-skill")),
    ).toEqual({ kind: "ok" });
    // An unset level reads as private.
    expect(
      checkReference(
        targets,
        { org: "acme", visibility: V.api_resource_visibility_unspecified },
        ref(K.skill, "acme", "my-skill"),
      ),
    ).toEqual({ kind: "ok" });
    // A platform-visible resource needs platform-visible dependencies.
    expect(
      checkReference(
        targets,
        { org: "acme", visibility: V.visibility_platform },
        ref(K.mcp_server, "acme", "github"),
      ),
    ).toEqual({ kind: "below-floor", targetVisibility: V.visibility_org });
  });

  it("(ii) the floor does not apply to what the server resolves on the run's behalf", () => {
    // An org-visible instance over a private personal environment: the
    // ordinary shape of a personal instance, admitted.
    expect(
      checkReference(targets, ACME_ORG, ref(K.environment, "acme", "personal")),
    ).toEqual({ kind: "ok" });
  });

  it("(iii) another organization's target is admitted only at platform visibility, with one answer for missing and for not shared", () => {
    expect(
      checkReference(targets, ACME_ORG, ref(K.skill, "globex", "shared")),
    ).toEqual({ kind: "ok" });
    const notShared = checkReference(
      targets,
      ACME_ORG,
      ref(K.skill, "globex", "internal"),
    );
    const missing = checkReference(
      targets,
      ACME_ORG,
      ref(K.skill, "globex", "nothing"),
    );
    expect(notShared).toEqual({ kind: "not-available" });
    expect(missing).toEqual(notShared);
    // A kind that is never platform-visible: every cross-organization reference to it.
    expect(
      checkReference(targets, ACME_ORG, ref(K.environment, "globex", "theirs")),
    ).toEqual({ kind: "not-available" });
  });

  it("(iii) a platform-visible cross-organization target is not held to the floor — the level is the sharing organization's to set", () => {
    expect(
      checkReference(
        targets,
        { org: "acme", visibility: V.visibility_platform },
        ref(K.skill, "globex", "shared"),
      ),
    ).toEqual({ kind: "ok" });
  });
});

// ---------------------------------------------------------------------------
// The copy.
// ---------------------------------------------------------------------------

describe("the refusal copy", () => {
  const mcp = referenceTargetKind(K.mcp_server)!;
  const skill = referenceTargetKind(K.skill)!;
  const oauth = referenceTargetKind(K.oauth_app)!;

  it("the MCP-server sentence is byte-identical to the contract that predates the rule", () => {
    expect(
      missingReferencesMessage(mcp, [{ slug: "ghost", org: "acme" }]),
    ).toBe(
      "referenced MCP server(s) not found: 'ghost' (org: acme). " +
        "Verify the slug and org are correct. " +
        "Use 'stigmer get mcp-servers' to list available MCP servers.",
    );
  });

  it("its siblings take the same shape, and a kind with no CLI verb ends without the hint", () => {
    expect(
      missingReferencesMessage(skill, [
        { slug: "a", org: "acme" },
        { slug: "b", org: "acme" },
      ]),
    ).toBe(
      "referenced skill(s) not found: 'a' (org: acme), 'b' (org: acme). " +
        "Verify the slug and org are correct. " +
        "Use 'stigmer list skills' to list available skills.",
    );
    expect(
      missingReferencesMessage(oauth, [{ slug: "vendor", org: "acme" }]),
    ).toBe(
      "referenced OAuth app(s) not found: 'vendor' (org: acme). " +
        "Verify the slug and org are correct.",
    );
  });

  it("the floor names the dependency and both levels; the cross-organization sentence names neither existence nor level", () => {
    expect(
      belowFloorMessage(
        skill,
        ref(K.skill, "acme", "my-skill"),
        V.visibility_private,
        V.visibility_org,
      ),
    ).toBe(
      "referenced skill 'acme/my-skill' is visibility_private while this resource is visibility_org; " +
        "a resource may not be more visible than the skills it runs with. " +
        "Widen the referenced resource's visibility or narrow this one.",
    );
    expect(
      notAvailableReferenceMessage(skill, ref(K.skill, "globex", "x")),
    ).toBe(
      "referenced skill 'globex/x' is not available to this organization; " +
        "another organization's resource can be referenced only when that organization shares it at platform visibility.",
    );
    expect(noOrgReferenceMessage(skill, "x")).toBe(
      "referenced skill(s) 'x' names no organization; a reference is 'org/slug', or 'slug' for a resource of this organization.",
    );
  });
});

// ---------------------------------------------------------------------------
// The walk and the step, over a real store.
// ---------------------------------------------------------------------------

describe("the step over a store", () => {
  let store: SqliteStore;
  let cleanup: () => Promise<void>;

  beforeEach(() => {
    const temp = tempStore();
    store = temp.store;
    cleanup = temp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  async function seedSkill(
    id: string,
    org: string,
    slug: string,
    visibility: ApiResourceVisibility,
  ): Promise<void> {
    await store.saveResource(
      K.skill,
      id,
      SkillSchema,
      create(SkillSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Skill",
        metadata: { id, name: slug, slug, org, visibility },
      }),
    );
  }

  function agentWith(
    visibility: ApiResourceVisibility,
    skillRefs: ReadonlyArray<{ org: string; slug: string }>,
  ) {
    return create(AgentSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { name: "Helper", org: "acme", visibility },
      spec: {
        instructions: "help the user with their tasks",
        skillRefs: skillRefs.map((r) => ({ ...r })),
      },
    });
  }

  it("the walk reads a reference's kind from its field's declaration, not from the message", () => {
    const agent = create(AgentSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { name: "Helper", org: "acme" },
      spec: {
        instructions: "help",
        // The message says mcp_server; the field is skill_refs.
        skillRefs: [{ kind: K.mcp_server, org: "acme", slug: "s" }],
        mcpServerUsages: [{ mcpServerRef: { org: "acme", slug: "m" } }],
      },
    });
    // Field declaration order: mcp_server_usages precedes skill_refs.
    expect(collectSpecReferences(AgentSchema, agent)).toEqual([
      { kind: K.mcp_server, org: "acme", slug: "m" },
      { kind: K.skill, org: "acme", slug: "s" },
    ]);
  });

  it("loads each referenced kind once and admits an existing same-organization target", async () => {
    await seedSkill("skl_1", "acme", "one", V.visibility_org);
    await seedSkill("skl_2", "acme", "two", V.visibility_org);
    let scans = 0;
    const counting: Store = new Proxy(store, {
      get(target, property, receiver) {
        if (property === "listResources") {
          scans += 1;
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const refusal = await checkReferences(counting, ACME_ORG, [
      ref(K.skill, "acme", "one"),
      ref(K.skill, "acme", "two"),
    ]);
    expect(refusal).toBeUndefined();
    expect(scans).toBe(1);
  });

  it("the step refuses a missing target with the contract's code and copy, and passes when the row exists", async () => {
    const missing = new RequestContext(
      AgentSchema,
      agentWith(V.visibility_org, [{ org: "acme", slug: "ghost" }]),
      testCallerIdentity(),
      K.agent,
    );
    const error = await failureOf(() =>
      newValidateReferencesStep<typeof AgentSchema>(store).execute(missing),
    );
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((error as ConnectError).rawMessage).toBe(
      "referenced skill(s) not found: 'ghost' (org: acme). " +
        "Verify the slug and org are correct. " +
        "Use 'stigmer list skills' to list available skills.",
    );

    await seedSkill("skl_1", "acme", "ghost", V.visibility_org);
    await expect(
      newValidateReferencesStep<typeof AgentSchema>(store).execute(missing),
    ).resolves.toBeUndefined();
  });

  it("the step refuses the floor at the spec door and a cross-organization reference to a row it will not describe", async () => {
    await seedSkill("skl_1", "acme", "mine", V.visibility_private);
    await seedSkill("skl_2", "globex", "theirs", V.visibility_org);
    const ctx = new RequestContext(
      AgentSchema,
      agentWith(V.visibility_org, [
        { org: "acme", slug: "mine" },
        { org: "globex", slug: "theirs" },
      ]),
      testCallerIdentity(),
      K.agent,
    );
    const error = await failureOf(() =>
      newValidateReferencesStep<typeof AgentSchema>(store).execute(ctx),
    );
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((error as ConnectError).rawMessage).toBe(
      belowFloorMessage(
        referenceTargetKind(K.skill)!,
        ref(K.skill, "acme", "mine"),
        V.visibility_private,
        V.visibility_org,
      ) +
        " " +
        notAvailableReferenceMessage(
          referenceTargetKind(K.skill)!,
          ref(K.skill, "globex", "theirs"),
        ),
    );
  });

  it("a reference left without an organization is malformed input", async () => {
    const ctx = new RequestContext(
      AgentSchema,
      agentWith(V.visibility_org, [{ org: "", slug: "x" }]),
      testCallerIdentity(),
      K.agent,
    );
    const error = await failureOf(() =>
      newValidateReferencesStep<typeof AgentSchema>(store).execute(ctx),
    );
    expect((error as ConnectError).code).toBe(Code.InvalidArgument);
    expect((error as ConnectError).rawMessage).toBe(
      noOrgReferenceMessage(referenceTargetKind(K.skill)!, "x"),
    );
  });

  it("the loaded targets are indexed by (org, slug): the same slug in another organization is another row", async () => {
    await seedSkill("skl_a", "acme", "shared-name", V.visibility_org);
    await seedSkill("skl_g", "globex", "shared-name", V.visibility_platform);
    const targets = await loadReferenceTargets(store, [
      ref(K.skill, "acme", "shared-name"),
    ]);
    expect(targets.visibilityOf(ref(K.skill, "acme", "shared-name"))).toBe(
      V.visibility_org,
    );
    expect(targets.visibilityOf(ref(K.skill, "globex", "shared-name"))).toBe(
      V.visibility_platform,
    );
    expect(targets.visibilityOf(ref(K.skill, "acme", "none"))).toBeUndefined();
  });
});

describe("GuardReferenceFloorOnEscalation", () => {
  let store: SqliteStore;
  let cleanup: () => Promise<void>;
  const TARGET = "loadedAgent";

  beforeEach(() => {
    const temp = tempStore();
    store = temp.store;
    cleanup = temp.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  async function seedSkill(
    id: string,
    slug: string,
    visibility: ApiResourceVisibility,
  ): Promise<void> {
    await store.saveResource(
      K.skill,
      id,
      SkillSchema,
      create(SkillSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Skill",
        metadata: { id, name: slug, slug, org: "acme", visibility },
      }),
    );
  }

  function storedAgent(
    visibility: ApiResourceVisibility,
    skillSlugs: ReadonlyArray<string>,
  ) {
    return create(AgentSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { id: "agt_1", name: "Helper", org: "acme", visibility },
      spec: {
        instructions: "help",
        skillRefs: skillSlugs.map((slug) => ({ org: "acme", slug })),
      },
    });
  }

  async function escalate(
    stored: ReturnType<typeof storedAgent>,
    requested: ApiResourceVisibility,
  ): Promise<unknown> {
    const ctx = new RequestContext(
      UpdateVisibilityInputSchema,
      create(UpdateVisibilityInputSchema, {
        resourceId: "agt_1",
        visibility: requested,
      }),
      testCallerIdentity(),
      K.agent,
    );
    ctx.set(TARGET, stored);
    return failureOf(() =>
      newGuardReferenceFloorOnEscalationStep(store, TARGET, [
        (row) => collectSpecReferences(AgentSchema, row),
      ]).execute(ctx),
    );
  }

  it("refuses raising a level above a run-read dependency, naming it", async () => {
    await seedSkill("skl_1", "mine", V.visibility_private);
    const error = await escalate(
      storedAgent(V.visibility_private, ["mine"]),
      V.visibility_org,
    );
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((error as ConnectError).rawMessage).toBe(
      belowFloorMessage(
        referenceTargetKind(K.skill)!,
        ref(K.skill, "acme", "mine"),
        V.visibility_private,
        V.visibility_org,
      ),
    );
  });

  it("passes when every dependency clears the requested level, and is silent on a lowering or a same-level write", async () => {
    await seedSkill("skl_1", "shared", V.visibility_org);
    expect(
      await escalate(
        storedAgent(V.visibility_private, ["shared"]),
        V.visibility_org,
      ),
    ).toBeUndefined();
    // Lowering never asks; the dependency below the OLD level is not the door's question.
    await seedSkill("skl_2", "mine", V.visibility_private);
    expect(
      await escalate(
        storedAgent(V.visibility_org, ["mine"]),
        V.visibility_private,
      ),
    ).toBeUndefined();
    expect(
      await escalate(storedAgent(V.visibility_org, ["mine"]), V.visibility_org),
    ).toBeUndefined();
  });

  it("asks the floor alone: a dependency that has left since the write does not block an escalation", async () => {
    expect(
      await escalate(
        storedAgent(V.visibility_private, ["gone"]),
        V.visibility_org,
      ),
    ).toBeUndefined();
  });

  it("is a wiring fault without a loaded target", async () => {
    const ctx = new RequestContext(
      UpdateVisibilityInputSchema,
      create(UpdateVisibilityInputSchema, {
        resourceId: "agt_1",
        visibility: V.visibility_org,
      }),
      testCallerIdentity(),
      K.agent,
    );
    const error = await failureOf(() =>
      newGuardReferenceFloorOnEscalationStep(store, TARGET, []).execute(ctx),
    );
    expect((error as ConnectError).code).toBe(Code.Internal);
  });
});
