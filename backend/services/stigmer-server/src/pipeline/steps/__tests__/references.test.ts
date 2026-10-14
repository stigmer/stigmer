/**
 * Pins the reference rule (pipeline/steps/references.ts): the table is
 * exactly the set of kinds the contract lets a spec reference (walked from
 * the schemas of every kind whose chain runs the rule, through the
 * `reference_kind` field option); each clause on each kind — no org
 * refused, a same-organization target must exist, the floor applies to
 * the kinds the run reads as the person and to no other, a version on a
 * reference is never
 * the rule's to judge (an agent's included), a cross-organization target
 * is admitted only when the writer's own parent shares it with its child
 * organizations, with ONE sentence whether it is missing, merely not
 * shared, or another parent's (the writer's parent read from its
 * organization's row, only when a reference crosses organizations); the
 * missing-reference copy keeps the one shape every kind shares; the walk
 * reads a reference's kind from its field, not from the message, and
 * reaches an agent's plugins, which the rule then judges like any other;
 * the step over a real store
 * reads each distinct target once (by id, or by name for one still
 * written by name) and scans no kind, and under `judge: "introduced"`
 * judges only the references the stored row does not already carry,
 * loading nothing when the write introduces none; the resolver
 * (resolveReferences) turns a name into its id, fills the org and the
 * kind, refuses a kind or an id that disagrees, and leaves a name nothing
 * holds as written; and
 * the escalation door asks the floor alone — a dependency that has left is
 * not its question — and only when the level is being raised.
 */
import { create } from "@bufbuild/protobuf";
import type { DescField, DescMessage } from "@bufbuild/protobuf";
import { getOption, hasOption } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { PluginSchema } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { reference_kind } from "@stigmer/protos/ai/stigmer/commons/apiresource/field_options_pb";
import { UpdateVisibilityInputSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

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
  notViewableReferenceMessage,
  referenceRefusal,
  referenceTargetKind,
  newNormalizeReferencesStep,
  referenceDisplayName,
  resolveReferences,
} from "../references.js";
import { EXISTING_RESOURCE_KEY } from "../load-existing.js";
import { newPermissiveSingleTeamAuthorizer } from "../authorize.js";
import type { Authorizer } from "../../../extensions/authorizer.js";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import type {
  ReferenceParent,
  ReferenceTargets,
  SpecReference,
} from "../references.js";
import { namingSaves } from "../../../store/__tests__/named-saves.js";

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

/** The schemas of every kind whose create or update chain runs the rule. */
const SCHEMAS_UNDER_THE_RULE: ReadonlyArray<DescMessage> = [
  AgentSchema,
  VaultSchema,
  ScheduleSchema,
  AgentChannelSchema,
  AgentShareSchema,
  SessionSchema,
  RunSchema,
  OrganizationSchema,
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
    ).toEqual([K.skill, K.agent, K.plugin]);
    expect(
      REFERENCE_TARGET_KINDS.filter((e) => !e.readByRun).map((e) => e.kind),
    ).toEqual([K.vault, K.channel_app]);
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
  writerParentOrg = "",
): ReferenceTargets {
  return {
    writerParentOrg,
    visibilityOf(ref) {
      return rows.find(
        (row) =>
          row.kind === ref.kind && row.org === ref.org && row.slug === ref.slug,
      )?.visibility;
    },
    idOf(ref) {
      return rows.find(
        (row) =>
          row.kind === ref.kind && row.org === ref.org && row.slug === ref.slug,
      )
        ? `id_${ref.slug}`
        : undefined;
    },
    slugOf(ref) {
      return rows.find(
        (row) =>
          row.kind === ref.kind && row.org === ref.org && row.slug === ref.slug,
      )?.slug;
    },
  };
}

/** The writer the existence and floor cases are judged for: admitted everywhere. */
const ANY_WRITER = {
  authorizer: newPermissiveSingleTeamAuthorizer(),
  caller: testCallerIdentity(),
  stored: [],
} as const;

const ACME_ORG: ReferenceParent = { org: "acme", visibility: V.visibility_org };
const ACME_PRIVATE: ReferenceParent = {
  org: "acme",
  visibility: V.visibility_private,
};

const ref = (
  kind: ApiResourceKind,
  org: string,
  slug: string,
): SpecReference => ({ kind, id: "", org, slug });

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
      kind: K.plugin,
      org: "acme",
      slug: "github",
      visibility: V.visibility_org,
    },
    {
      kind: K.vault,
      org: "acme",
      slug: "personal",
      visibility: V.visibility_private,
    },
    {
      kind: K.skill,
      org: "globex",
      slug: "shared",
      visibility: V.visibility_child_orgs,
    },
    {
      kind: K.skill,
      org: "initech",
      slug: "shared",
      visibility: V.visibility_child_orgs,
    },
    {
      kind: K.skill,
      org: "globex",
      slug: "internal",
      visibility: V.visibility_org,
    },
    {
      kind: K.vault,
      org: "globex",
      slug: "theirs",
      visibility: V.visibility_org,
    },
  ], "globex");

  it("(i) a reference with no organization is refused before anything is looked up", () => {
    expect(
      checkReference(targets, ACME_ORG, ref(K.skill, "", "org-skill")),
    ).toEqual({ kind: "no-org" });
  });

  it("a version on a reference is the contract's word, never this rule's: a versioned agent reference is judged by the row it names", () => {
    const withAgent = targetsOf([
      {
        kind: K.agent,
        org: "acme",
        slug: "reviewer",
        visibility: V.visibility_org,
      },
    ]);
    for (const version of ["stable", "latest", "a".repeat(64)]) {
      expect(
        checkReference(withAgent, ACME_ORG, {
          kind: K.agent,
          id: "",
          org: "acme",
          slug: "reviewer",
          version,
        }),
        version,
      ).toEqual({ kind: "ok" });
    }
    expect(
      checkReference(withAgent, ACME_ORG, {
        kind: K.agent,
        id: "",
        org: "acme",
        slug: "ghost",
        version: "stable",
      }),
    ).toEqual({ kind: "missing" });
  });

  it("the three clauses say nothing about a version, so the escalation door still judges a versioned reference's floor", () => {
    expect(
      checkReference(targets, ACME_ORG, { kind: K.skill, id: "", org: "acme", slug: "my-skill", version: "v1" }),
    ).toEqual({ kind: "below-floor", targetVisibility: V.visibility_private });
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
    // A resource shared with child organizations needs dependencies shared as widely.
    expect(
      checkReference(
        targets,
        { org: "acme", visibility: V.visibility_child_orgs },
        ref(K.plugin, "acme", "github"),
      ),
    ).toEqual({ kind: "below-floor", targetVisibility: V.visibility_org });
  });

  it("(ii) the floor does not apply to what the server resolves on the run's behalf", () => {
    // An org-visible resource over a private vault: someone who may use
    // it attaching it, admitted (the writer clause asks the use).
    expect(
      checkReference(targets, ACME_ORG, ref(K.vault, "acme", "personal")),
    ).toEqual({ kind: "ok" });
  });

  it("(iii) another organization's target is admitted only when the writer's parent shares it with its children, with one answer for missing, not shared and another parent's", () => {
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
    // Shared with child organizations, but by another parent: acme is not initech's child.
    expect(
      checkReference(targets, ACME_ORG, ref(K.skill, "initech", "shared")),
    ).toEqual({ kind: "not-available" });
    // A writer with no parent reaches no other organization's shared row.
    expect(
      checkReference(
        targetsOf([
          {
            kind: K.skill,
            org: "globex",
            slug: "shared",
            visibility: V.visibility_child_orgs,
          },
        ]),
        ACME_ORG,
        ref(K.skill, "globex", "shared"),
      ),
    ).toEqual({ kind: "not-available" });
    // A kind that is never shared with child organizations: every cross-organization reference to it.
    expect(
      checkReference(targets, ACME_ORG, ref(K.vault, "globex", "theirs")),
    ).toEqual({ kind: "not-available" });
  });

  it("(iii) the parent's shared target is not held to the floor — the level is the sharing organization's to set", () => {
    expect(
      checkReference(
        targets,
        { org: "acme", visibility: V.visibility_child_orgs },
        ref(K.skill, "globex", "shared"),
      ),
    ).toEqual({ kind: "ok" });
  });
});

// ---------------------------------------------------------------------------
// The copy.
// ---------------------------------------------------------------------------

describe("the refusal copy", () => {
  const plugin = referenceTargetKind(K.plugin)!;
  const skill = referenceTargetKind(K.skill)!;

  it("a missing plugin names the slug, the organization and the CLI's list verb", () => {
    expect(
      missingReferencesMessage(plugin, [{ slug: "ghost", org: "acme" }]),
    ).toBe(
      "referenced plugin(s) not found: 'ghost' (org: acme). " +
        "Verify the slug and org are correct. " +
        "Use 'stigmer list plugins' to list available plugins.",
    );
  });

  it("its siblings take the same shape", () => {
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
      "referenced skill 'x' of another organization is not available to this organization; " +
        "another organization's resource can be referenced only when it is this organization's parent and shares it with its child organizations.",
    );
    // The other organization is never named: a held name and one nobody
    // holds read the same.
    expect(notAvailableReferenceMessage(skill, ref(K.skill, "org_01jbbbbbbbbbbbbbbbbbbbbbbb", "x"))).toBe(
      notAvailableReferenceMessage(skill, ref(K.skill, "nobody", "x")),
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
    store = namingSaves(temp.store);
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
        // The message says plugin; the field is skill_refs.
        skillRefs: [{ kind: K.plugin, id: "", org: "acme", slug: "s", version: "v1" }],
        plugins: [{ kind: K.plugin, id: "", org: "acme", slug: "p" }],
      },
    });
    // Field declaration order: skill_refs (5) precedes plugins (16). The
    // version a reference names is carried as written.
    expect(collectSpecReferences(AgentSchema, agent)).toEqual([
      { kind: K.skill, id: "", org: "acme", slug: "s", version: "v1" },
      { kind: K.plugin, id: "", org: "acme", slug: "p", version: "" },
    ]);
  });

  it("the walk reaches an agent's plugins, and ignores an inline hook block", () => {
    const agent = create(AgentSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { name: "Helper", org: "acme" },
      spec: {
        instructions: "help",
        plugins: [{ kind: K.plugin, id: "", org: "acme", slug: "safety" }],
        hooks: [{ source: { case: "inline", value: { groups: [] } } }],
      },
    });
    expect(collectSpecReferences(AgentSchema, agent)).toEqual([
      { kind: K.plugin, id: "", org: "acme", slug: "safety", version: "" },
    ]);
  });

  it("holds an agent's plugin reference to the rule: the target must exist, reach the floor, and be shared across organizations", async () => {
    async function seedPlugin(
      id: string,
      org: string,
      slug: string,
      visibility: ApiResourceVisibility,
    ): Promise<void> {
      await store.saveResource(
        K.plugin,
        id,
        PluginSchema,
        create(PluginSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "Plugin",
          metadata: { id, name: slug, slug, org, visibility },
        }),
      );
    }
    const listing = (refs: ReadonlyArray<{ org: string; slug: string }>) =>
      new RequestContext(
        AgentSchema,
        create(AgentSchema, {
          apiVersion: "agentic.stigmer.ai/v1",
          kind: "Agent",
          metadata: { name: "Helper", org: "acme", visibility: V.visibility_org },
          spec: {
            instructions: "help the user with their tasks",
            plugins: refs.map((r) => ({ kind: K.plugin, ...r })),
          },
        }),
        testCallerIdentity(),
        K.agent,
      );
    const run = (ctx: RequestContext<typeof AgentSchema>) =>
      failureOf(() =>
        newValidateReferencesStep<typeof AgentSchema>(
          store,
          newPermissiveSingleTeamAuthorizer(),
        ).execute(ctx),
      );
    const entry = referenceTargetKind(K.plugin)!;

    const missing = await run(listing([{ org: "acme", slug: "safety" }]));
    expect((missing as ConnectError).rawMessage).toBe(
      missingReferencesMessage(entry, [{ org: "acme", slug: "safety" }]),
    );

    await seedPlugin("plg_1", "acme", "safety", V.visibility_private);
    await seedPlugin("plg_2", "globex", "theirs", V.visibility_org);
    const refused = await run(
      listing([
        { org: "acme", slug: "safety" },
        { org: "globex", slug: "theirs" },
      ]),
    );
    expect((refused as ConnectError).rawMessage).toBe(
      belowFloorMessage(
        entry,
        ref(K.plugin, "acme", "safety"),
        V.visibility_private,
        V.visibility_org,
      ) +
        " " +
        notAvailableReferenceMessage(entry, ref(K.plugin, "globex", "theirs")),
    );

    // Another organization's plugin is admitted from the writer's parent,
    // shared with its child organizations.
    await store.saveResource(
      K.organization,
      "acme",
      OrganizationSchema,
      create(OrganizationSchema, {
        metadata: { id: "acme", name: "Acme", slug: "acme" },
        spec: { parentOrg: "globex" },
      }),
    );
    await seedPlugin("plg_1", "acme", "safety", V.visibility_org);
    await seedPlugin("plg_2", "globex", "theirs", V.visibility_child_orgs);
    await expect(
      run(
        listing([
          { org: "acme", slug: "safety" },
          { org: "globex", slug: "theirs" },
        ]),
      ),
    ).resolves.toBeUndefined();
  });

  it("reads each distinct referenced target once by name, scans no kind, and admits an existing same-organization target", async () => {
    await seedSkill("skl_1", "acme", "one", V.visibility_org);
    await seedSkill("skl_2", "acme", "two", V.visibility_org);
    let scans = 0;
    let reads = 0;
    const counting: Store = new Proxy(store, {
      get(target, property, receiver) {
        if (property === "listResources") {
          scans += 1;
        }
        if (property === "getResource") {
          reads += 1;
        }
        return Reflect.get(target, property, receiver) as unknown;
      },
    });
    const refusal = await checkReferences(
      counting,
      ACME_ORG,
      [
        ref(K.skill, "acme", "one"),
        ref(K.skill, "acme", "two"),
        ref(K.skill, "acme", "one"),
      ],
      ANY_WRITER,
    );
    expect(refusal).toBeUndefined();
    expect(scans).toBe(0);
    expect(reads).toBe(2);
  });

  it("the step refuses a missing target with the contract's code and copy, and passes when the row exists", async () => {
    const missing = new RequestContext(
      AgentSchema,
      agentWith(V.visibility_org, [{ org: "acme", slug: "ghost" }]),
      testCallerIdentity(),
      K.agent,
    );
    const error = await failureOf(() =>
      newValidateReferencesStep<typeof AgentSchema>(
        store,
        newPermissiveSingleTeamAuthorizer(),
      ).execute(missing),
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
      newValidateReferencesStep<typeof AgentSchema>(
        store,
        newPermissiveSingleTeamAuthorizer(),
      ).execute(missing),
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
      newValidateReferencesStep<typeof AgentSchema>(
        store,
        newPermissiveSingleTeamAuthorizer(),
      ).execute(ctx),
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
      newValidateReferencesStep<typeof AgentSchema>(
        store,
        newPermissiveSingleTeamAuthorizer(),
      ).execute(ctx),
    );
    expect((error as ConnectError).code).toBe(Code.InvalidArgument);
    expect((error as ConnectError).rawMessage).toBe(
      noOrgReferenceMessage(referenceTargetKind(K.skill)!, "x"),
    );
  });

  it("the step judges a resolved reference by its id, and names one whose id names nothing by that id", async () => {
    await seedSkill("skl_1", "acme", "one", V.visibility_private);
    const resolved = new RequestContext(
      AgentSchema,
      agentWith(V.visibility_org, []),
      testCallerIdentity(),
      K.agent,
    );
    resolved.newState.spec!.skillRefs = [
      create(ApiResourceReferenceSchema, { org: "acme", kind: K.skill, id: "skl_1" }),
    ];
    const below = await failureOf(() =>
      newValidateReferencesStep<typeof AgentSchema>(
        store,
        newPermissiveSingleTeamAuthorizer(),
      ).execute(resolved),
    );
    // The copy names the target by its own slug, though the reference holds none.
    expect((below as ConnectError).rawMessage).toBe(
      belowFloorMessage(
        referenceTargetKind(K.skill)!,
        ref(K.skill, "acme", "one"),
        V.visibility_private,
        V.visibility_org,
      ),
    );

    resolved.newState.spec!.skillRefs = [
      create(ApiResourceReferenceSchema, { org: "acme", kind: K.skill, id: "skl_gone" }),
    ];
    const gone = await failureOf(() =>
      newValidateReferencesStep<typeof AgentSchema>(
        store,
        newPermissiveSingleTeamAuthorizer(),
      ).execute(resolved),
    );
    expect((gone as ConnectError).rawMessage).toBe(
      missingReferencesMessage(referenceTargetKind(K.skill)!, [
        { slug: "skl_gone", org: "acme" },
      ]),
    );
  });

  it("an id that names a row of another organization than the reference names is no target of it", async () => {
    await seedSkill("skl_g", "globex", "theirs", V.visibility_org);
    const ctx = new RequestContext(
      AgentSchema,
      agentWith(V.visibility_org, []),
      testCallerIdentity(),
      K.agent,
    );
    ctx.newState.spec!.skillRefs = [
      create(ApiResourceReferenceSchema, { org: "acme", kind: K.skill, id: "skl_g" }),
    ];
    const error = await failureOf(() =>
      newValidateReferencesStep<typeof AgentSchema>(
        store,
        newPermissiveSingleTeamAuthorizer(),
      ).execute(ctx),
    );
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
  });

  describe('judge: "introduced" — only the references the stored row does not already carry', () => {
    // The stored row carries `kept` (still there) and `gone` (deleted
    // since it was written); the write echoes both and adds `added`.
    function update(added: string) {
      const ctx = new RequestContext(
        AgentSchema,
        agentWith(V.visibility_org, [
          { org: "acme", slug: "kept" },
          { org: "acme", slug: "gone" },
          { org: "acme", slug: added },
        ]),
        testCallerIdentity(),
        K.agent,
      );
      ctx.set(
        EXISTING_RESOURCE_KEY,
        agentWith(V.visibility_org, [
          { org: "acme", slug: "kept" },
          { org: "acme", slug: "gone" },
        ]),
      );
      return ctx;
    }

    beforeEach(async () => {
      await seedSkill("skl_kept", "acme", "kept", V.visibility_org);
      await seedSkill("skl_added", "acme", "added", V.visibility_org);
    });

    it("passes an echoed reference whose target has gone", async () => {
      await expect(
        newValidateReferencesStep<typeof AgentSchema>(
          store,
          newPermissiveSingleTeamAuthorizer(),
          { judge: "introduced" },
        ).execute(update("added")),
      ).resolves.toBeUndefined();
    });

    it("loads nothing when the write introduces no reference", async () => {
      const ctx = new RequestContext(
        AgentSchema,
        agentWith(V.visibility_org, [
          { org: "acme", slug: "kept" },
          { org: "acme", slug: "gone" },
        ]),
        testCallerIdentity(),
        K.agent,
      );
      ctx.set(
        EXISTING_RESOURCE_KEY,
        agentWith(V.visibility_org, [
          { org: "acme", slug: "kept" },
          { org: "acme", slug: "gone" },
        ]),
      );
      const listed: ApiResourceKind[] = [];
      const counting = new Proxy(store, {
        get(target, prop, receiver) {
          if (prop === "listResources") {
            return (kind: ApiResourceKind) => {
              listed.push(kind);
              return target.listResources(kind);
            };
          }
          return Reflect.get(target, prop, receiver) as unknown;
        },
      });
      await newValidateReferencesStep<typeof AgentSchema>(
        counting,
        newPermissiveSingleTeamAuthorizer(),
        { judge: "introduced" },
      ).execute(ctx);
      expect(listed).toEqual([]);
    });

    it("still refuses a newly added reference whose target is missing", async () => {
      const error = await failureOf(() =>
        newValidateReferencesStep<typeof AgentSchema>(
          store,
          newPermissiveSingleTeamAuthorizer(),
          { judge: "introduced" },
        ).execute(update("ghost")),
      );
      expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
      expect((error as ConnectError).rawMessage).toBe(
        missingReferencesMessage(referenceTargetKind(K.skill)!, [
          { slug: "ghost", org: "acme" },
        ]),
      );
    });

    it("the default judges every reference: the echoed one whose target has gone is refused", async () => {
      const ctx = update("added");
      const error = await failureOf(() =>
        newValidateReferencesStep<typeof AgentSchema>(
          store,
          newPermissiveSingleTeamAuthorizer(),
        ).execute(ctx),
      );
      expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
      expect((error as ConnectError).rawMessage).toBe(
        missingReferencesMessage(referenceTargetKind(K.skill)!, [
          { slug: "gone", org: "acme" },
        ]),
      );

      const passing = new RequestContext(
        AgentSchema,
        agentWith(V.visibility_org, [
          { org: "acme", slug: "kept" },
          { org: "acme", slug: "added" },
        ]),
        testCallerIdentity(),
        K.agent,
      );
      passing.set(
        EXISTING_RESOURCE_KEY,
        agentWith(V.visibility_org, [{ org: "acme", slug: "kept" }]),
      );
      await expect(
        newValidateReferencesStep<typeof AgentSchema>(
          store,
          newPermissiveSingleTeamAuthorizer(),
        ).execute(passing),
      ).resolves.toBeUndefined();
    });
  });

  it("reads the writer's parent from its organization's row only when a reference crosses organizations", async () => {
    await store.saveResource(
      K.organization,
      "acme",
      OrganizationSchema,
      create(OrganizationSchema, {
        metadata: { id: "acme", name: "Acme", slug: "acme" },
        spec: { parentOrg: "globex" },
      }),
    );
    await seedSkill("skl_s", "globex", "shared", V.visibility_child_orgs);
    const crossing = await loadReferenceTargets(
      store,
      [ref(K.skill, "globex", "shared")],
      "acme",
    );
    expect(crossing.writerParentOrg).toBe("globex");
    expect(
      checkReference(crossing, ACME_ORG, ref(K.skill, "globex", "shared")),
    ).toEqual({ kind: "ok" });
    const local = await loadReferenceTargets(
      store,
      [ref(K.skill, "acme", "x")],
      "acme",
    );
    expect(local.writerParentOrg).toBe("");
  });

  it("answers a fault reading the writer's organization INTERNAL, never a refusal", async () => {
    await seedSkill("skl_s", "globex", "shared", V.visibility_child_orgs);
    const faulty: Store = Object.create(store);
    faulty.getResource = ((kind: ApiResourceKind, ...rest: unknown[]) =>
      kind === K.organization
        ? Promise.reject(new Error("store down"))
        : (store.getResource as (...args: unknown[]) => unknown)(kind, ...rest)) as Store["getResource"];
    const error = await loadReferenceTargets(
      faulty,
      [ref(K.skill, "globex", "shared")],
      "acme",
    ).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.Internal);
    expect((error as ConnectError).rawMessage).toContain("failed to read the writing organization");
  });

  it("a reference to a kind the rule table does not hold is INTERNAL: a contract the pin test has not admitted", async () => {
    const error = await failureOf(async () => {
      await loadReferenceTargets(store, [ref(K.run, "acme", "run-1")], "acme");
    });
    expect((error as ConnectError).code).toBe(Code.Internal);
  });

  it("the loaded targets are keyed by (kind, org, slug): the same slug in another organization is another row", async () => {
    await seedSkill("skl_a", "acme", "shared-name", V.visibility_org);
    await seedSkill("skl_g", "globex", "shared-name", V.visibility_child_orgs);
    const targets = await loadReferenceTargets(
      store,
      [
        ref(K.skill, "acme", "shared-name"),
        ref(K.skill, "globex", "shared-name"),
        ref(K.skill, "acme", "none"),
      ],
      "acme",
    );
    expect(targets.visibilityOf(ref(K.skill, "acme", "shared-name"))).toBe(
      V.visibility_org,
    );
    expect(targets.visibilityOf(ref(K.skill, "globex", "shared-name"))).toBe(
      V.visibility_child_orgs,
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
    store = namingSaves(temp.store);
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

describe("the writer clause: a write may introduce only a vault its writer may use", () => {
  let store: SqliteStore;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const temp = tempStore();
    store = namingSaves(temp.store);
    cleanup = temp.cleanup;
    for (const [id, slug, visibility] of [
      ["vlt_ana_keys", "ana-keys", V.visibility_private],
      ["vlt_team_keys", "team-keys", V.visibility_org],
      ["vlt_flaky", "flaky", V.visibility_private],
      ["vlt_left", "left", V.visibility_private],
    ] as const) {
      await store.saveResource(
        K.vault,
        id,
        VaultSchema,
        create(VaultSchema, {
          metadata: { id, name: slug, slug, org: "acme", visibility },
          spec: { owner: { case: "org", value: "acme" } },
        }),
      );
    }
  });

  afterEach(async () => {
    await cleanup();
  });

  /**
   * An authorizer over the model's answer for vaults: Ana may use the
   * private shared vault she was granted, every member the org-visible
   * one, nobody else hers; one row's evaluation is down. Every check is
   * recorded.
   */
  function vaultUses(checks: string[]): Authorizer {
    return {
      authorize: async (caller, check) => {
        checks.push(
          `${caller.identityId}:${IamPermission[check.permission]}:${check.resourceId}`,
        );
        if (check.resourceId === "vlt_flaky") {
          return {
            kind: "unavailable",
            cause: new Error("authorization store offline"),
          };
        }
        if (check.resourceId === "vlt_left") {
          return { kind: "not-found" };
        }
        if (
          check.resourceId === "vlt_ana_keys" &&
          caller.identityId !== "acc_ana"
        ) {
          return { kind: "deny", reason: "may not use it" };
        }
        return { kind: "allow" };
      },
    };
  }

  function channelNaming(...slugs: string[]) {
    return create(AgentChannelSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "AgentChannel",
      metadata: {
        name: "Team helper",
        org: "acme",
        visibility: V.visibility_org,
      },
      spec: {
        vaults: slugs.map((slug) => ({
          kind: K.vault,
          org: "acme",
          slug,
        })),
      },
    });
  }

  async function write(opts: {
    readonly writer: string;
    readonly names: readonly string[];
    readonly stored?: readonly string[];
    readonly callerClass?: string;
    readonly checks?: string[];
  }): Promise<unknown> {
    const ctx = new RequestContext(
      AgentChannelSchema,
      channelNaming(...opts.names),
      testCallerIdentity({
        identityId: opts.writer,
        callerClass: opts.callerClass ?? "user",
      }),
      K.agent_channel,
    );
    if (opts.stored !== undefined) {
      ctx.set(EXISTING_RESOURCE_KEY, channelNaming(...opts.stored));
    }
    return failureOf(() =>
      newValidateReferencesStep<typeof AgentChannelSchema>(
        store,
        vaultUses(opts.checks ?? []),
      ).execute(ctx),
    );
  }

  it("refuses a vault the writer may not use PERMISSION_DENIED, naming it and what may be attached", async () => {
    const error = await write({ writer: "acc_ben", names: ["ana-keys"] });
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(Code.PermissionDenied);
    expect((error as ConnectError).rawMessage).toBe(
      notViewableReferenceMessage(
        referenceTargetKind(K.vault)!,
        ref(K.vault, "acme", "ana-keys"),
      ),
    );
  });

  it("admits a private vault its user attaches to an org-visible channel, and an org-visible one for any member", async () => {
    const checks: string[] = [];
    expect(
      await write({ writer: "acc_ana", names: ["ana-keys"], checks }),
    ).toBeUndefined();
    expect(
      await write({ writer: "acc_ben", names: ["team-keys"], checks }),
    ).toBeUndefined();
    expect(checks).toEqual([
      "acc_ana:can_use:vlt_ana_keys",
      "acc_ben:can_use:vlt_team_keys",
    ]);
  });

  it("judges only what the write introduces: an edit that keeps a teammate's attachment passes, a new one does not", async () => {
    const checks: string[] = [];
    expect(
      await write({
        writer: "acc_ben",
        names: ["ana-keys", "team-keys"],
        stored: ["ana-keys"],
        checks,
      }),
    ).toBeUndefined();
    // Only the introduced reference was asked about.
    expect(checks).toEqual(["acc_ben:can_use:vlt_team_keys"]);
    const error = await write({
      writer: "acc_ben",
      names: ["ana-keys"],
      stored: ["team-keys"],
    });
    expect((error as ConnectError).code).toBe(Code.PermissionDenied);
  });

  it("exempts the server acting as itself", async () => {
    const checks: string[] = [];
    expect(
      await write({
        writer: "system",
        names: ["ana-keys"],
        callerClass: "internal",
        checks,
      }),
    ).toBeUndefined();
    expect(checks).toEqual([]);
  });

  it("an unavailable authorizer is an internal fault, never a refusal or an admission", async () => {
    const error = await write({ writer: "acc_ben", names: ["flaky"] });
    expect((error as ConnectError).code).toBe(Code.Internal);
  });

  it("a target the Authorizer no longer finds (it left since the scan) answers the missing copy", async () => {
    const error = await write({ writer: "acc_ben", names: ["left"] });
    expect((error as ConnectError).code).toBe(Code.FailedPrecondition);
    expect((error as ConnectError).rawMessage).toBe(
      missingReferencesMessage(referenceTargetKind(K.vault)!, [
        { slug: "left", org: "acme" },
      ]),
    );
  });

  it("a malformed reference beside a refused one still answers INVALID_ARGUMENT first", async () => {
    const ctx = new RequestContext(
      AgentChannelSchema,
      create(AgentChannelSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "AgentChannel",
        metadata: { name: "No org", org: "", visibility: V.visibility_org },
        spec: {
          vaults: [{ kind: K.vault, org: "", slug: "ana-keys" }],
        },
      }),
      testCallerIdentity({ identityId: "acc_ben" }),
      K.agent_channel,
    );
    const error = await failureOf(() =>
      newValidateReferencesStep<typeof AgentChannelSchema>(
        store,
        vaultUses([]),
      ).execute(ctx),
    );
    expect((error as ConnectError).code).toBe(Code.InvalidArgument);
  });

  it("only vaults carry the clause: other kinds are judged by existence and the floor alone", () => {
    for (const entry of REFERENCE_TARGET_KINDS) {
      expect(entry.writerMust).toBe(
        entry.kind === K.vault ? IamPermission.can_use : undefined,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// The resolver: a written name becomes the id it names.
// ---------------------------------------------------------------------------

describe("resolveReferences and NormalizeReferences", () => {
  let store: SqliteStore;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const temp = tempStore();
    store = namingSaves(temp.store);
    cleanup = temp.cleanup;
    await store.saveResource(
      K.skill,
      "skl_1",
      SkillSchema,
      create(SkillSchema, { metadata: { id: "skl_1", org: "acme", slug: "web-search", name: "web-search" } }),
    );
  });

  afterEach(async () => {
    await cleanup();
  });

  function agentNaming(...refs: Array<{ org?: string; slug?: string; id?: string; kind?: ApiResourceKind }>) {
    return create(AgentSchema, {
      metadata: { name: "helper", org: "acme", visibility: V.visibility_org },
      spec: { skillRefs: refs.map((r) => create(ApiResourceReferenceSchema, r)) },
    });
  }

  it("turns a written slug into the id it names, the org defaulted and the kind filled, the slug cleared", async () => {
    const agent = agentNaming({ slug: "web-search" });
    await resolveReferences(store, AgentSchema, agent, "acme");
    expect(agent.spec!.skillRefs[0]).toMatchObject({ org: "acme", kind: K.skill, id: "skl_1", slug: "" });
  });

  it("is idempotent: a reference that holds an id is left as it is", async () => {
    const agent = agentNaming({ org: "acme", kind: K.skill, id: "skl_1" });
    await resolveReferences(store, AgentSchema, agent, "acme");
    expect(agent.spec!.skillRefs[0]).toMatchObject({ org: "acme", kind: K.skill, id: "skl_1", slug: "" });
  });

  it("accepts an id and a slug that agree, and refuses ones that do not, naming both", async () => {
    const agreeing = agentNaming({ slug: "web-search", id: "skl_1" });
    await resolveReferences(store, AgentSchema, agreeing, "acme");
    expect(agreeing.spec!.skillRefs[0]).toMatchObject({ id: "skl_1", slug: "" });

    const error = await failureOf(() =>
      resolveReferences(store, AgentSchema, agentNaming({ slug: "web-search", id: "skl_other" }), "acme"),
    );
    expect((error as ConnectError).code).toBe(Code.InvalidArgument);
    expect((error as ConnectError).rawMessage).toBe(
      "skill_refs names 'web-search' and id 'skl_other', which are not the same resource; name it by its slug, by its id, or by both when they agree.",
    );
  });

  it("keeps an id written beside a slug nothing holds: a reader writing back what it read before the target left", async () => {
    const agent = agentNaming({ slug: "deleted-since", id: "skl_gone" });
    await resolveReferences(store, AgentSchema, agent, "acme");
    expect(agent.spec!.skillRefs[0]).toMatchObject({ id: "skl_gone", slug: "" });
  });

  it("leaves a name nothing holds as written, for the rule to refuse as missing", async () => {
    const agent = agentNaming({ slug: "ghost" });
    await resolveReferences(store, AgentSchema, agent, "acme");
    expect(agent.spec!.skillRefs[0]).toMatchObject({ org: "acme", kind: K.skill, id: "", slug: "ghost" });
  });

  it("refuses a kind other than the field's, in the copy the per-field rules answered", async () => {
    const error = await failureOf(() =>
      resolveReferences(store, AgentSchema, agentNaming({ slug: "web-search", kind: K.plugin }), "acme"),
    );
    expect((error as ConnectError).code).toBe(Code.InvalidArgument);
    expect((error as ConnectError).rawMessage).toBe("skill_refs must reference resources with kind=skill");
  });

  it("a name deleted and taken again names the new resource only for a write that names it again; a stored id keeps meaning the first", async () => {
    const stored = agentNaming({ slug: "web-search" });
    await resolveReferences(store, AgentSchema, stored, "acme");
    await store.deleteResource(K.skill, "skl_1");
    await store.resourceNames.release("skill", "acme", "skl_1");
    await store.saveResource(
      K.skill,
      "skl_2",
      SkillSchema,
      create(SkillSchema, { metadata: { id: "skl_2", org: "acme", slug: "web-search", name: "web-search" } }),
    );
    await resolveReferences(store, AgentSchema, stored, "acme");
    expect(stored.spec!.skillRefs[0]!.id).toBe("skl_1");
    const rewritten = agentNaming({ slug: "web-search" });
    await resolveReferences(store, AgentSchema, rewritten, "acme");
    expect(rewritten.spec!.skillRefs[0]!.id).toBe("skl_2");
  });

  it("keeps an id the stored row holds whatever slug is echoed beside it: the runner writes back what it read at turn start", async () => {
    const stored = agentNaming({ org: "acme", kind: K.skill, id: "skl_1" });
    await store.deleteResource(K.skill, "skl_1");
    await store.resourceNames.release("skill", "acme", "skl_1");
    await store.saveResource(
      K.skill,
      "skl_2",
      SkillSchema,
      create(SkillSchema, { metadata: { id: "skl_2", org: "acme", slug: "web-search", name: "web-search" } }),
    );
    const echo = () => agentNaming({ org: "acme", kind: K.skill, id: "skl_1", slug: "web-search" });
    const kept = echo();
    await resolveReferences(store, AgentSchema, kept, "acme", new Date(), stored);
    expect(kept.spec!.skillRefs[0]).toMatchObject({ id: "skl_1", slug: "" });
    // A write the stored row does not hold is judged as written: the slug names another skill now.
    const error = await failureOf(() => resolveReferences(store, AgentSchema, echo(), "acme"));
    expect((error as ConnectError).code).toBe(Code.InvalidArgument);
  });

  it("referenceDisplayName names a reference still written by name by that name, and one held by id by its target's", async () => {
    expect(await referenceDisplayName(store, K.skill, { org: "acme", id: "", slug: "ghost" })).toBe("ghost");
    expect(await referenceDisplayName(store, K.skill, { org: "acme", id: "skl_1", slug: "" })).toBe("web-search");
    expect(await referenceDisplayName(store, K.skill, { org: "acme", id: "skl_gone", slug: "" })).toBe("skl_gone");
  });

  it("NormalizeReferences resolves the request's spec against the resource's own organization", async () => {
    const ctx = new RequestContext(AgentSchema, agentNaming({ slug: "web-search" }), testCallerIdentity(), K.agent);
    await newNormalizeReferencesStep<typeof AgentSchema>(store).execute(ctx);
    expect(ctx.newState.spec!.skillRefs[0]).toMatchObject({ org: "acme", id: "skl_1", slug: "" });
  });
});

describe("a reference into another organization tells the writer nothing that organization holds", () => {
  let store: SqliteStore;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    const temp = tempStore();
    store = namingSaves(temp.store);
    cleanup = temp.cleanup;
    await store.saveResource(
      K.organization,
      "acme",
      OrganizationSchema,
      create(OrganizationSchema, { metadata: { id: "acme", name: "Acme", slug: "acme" }, spec: { parentOrg: "globex" } }),
    );
    for (const [id, slug, visibility] of [
      ["skl_g", "theirs", V.visibility_org],
      ["skl_s", "shared", V.visibility_child_orgs],
    ] as const) {
      await store.saveResource(
        K.skill,
        id,
        SkillSchema,
        create(SkillSchema, { metadata: { id, org: "globex", slug, name: slug, visibility } }),
      );
    }
  });

  afterEach(async () => {
    await cleanup();
  });

  function agentNaming(...refs: Array<{ org: string; slug?: string; id?: string }>) {
    return create(AgentSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { name: "helper", org: "acme", visibility: V.visibility_org },
      spec: {
        instructions: "help the user with their tasks",
        skillRefs: refs.map((r) => create(ApiResourceReferenceSchema, r)),
      },
    });
  }

  /** Normalize then judge, as every write chain does; the refusal, or undefined when the write passes. */
  async function written(
    agent: ReturnType<typeof agentNaming>,
    passed: (stored: ReturnType<typeof agentNaming>) => void = () => undefined,
  ): Promise<ConnectError | undefined> {
    const ctx = new RequestContext(AgentSchema, agent, testCallerIdentity(), K.agent);
    try {
      await newNormalizeReferencesStep<typeof AgentSchema>(store).execute(ctx);
      await newValidateReferencesStep<typeof AgentSchema>(store, newPermissiveSingleTeamAuthorizer()).execute(ctx);
    } catch (error) {
      return error as ConnectError;
    }
    passed(ctx.newState);
    return undefined;
  }

  const unavailable = (written: string): string =>
    notAvailableReferenceMessage(referenceTargetKind(K.skill)!, ref(K.skill, "globex", written));

  it("an id beside a slug is held by the id there: whether the slug names something is never asked", async () => {
    const named = agentNaming({ org: "globex", slug: "theirs", id: "skl_bogus" });
    const unnamed = agentNaming({ org: "globex", slug: "nobody", id: "skl_bogus" });
    await resolveReferences(store, AgentSchema, named, "acme");
    await resolveReferences(store, AgentSchema, unnamed, "acme");
    expect(named.spec!.skillRefs[0]).toMatchObject({ id: "skl_bogus", slug: "theirs" });
    expect(unnamed.spec!.skillRefs[0]).toMatchObject({ id: "skl_bogus", slug: "nobody" });
  });

  it("a slug there takes its id and keeps the name as written until the rule admits it", async () => {
    const agent = agentNaming({ org: "globex", slug: "theirs" });
    await resolveReferences(store, AgentSchema, agent, "acme");
    expect(agent.spec!.skillRefs[0]).toMatchObject({ id: "skl_g", slug: "theirs" });
  });

  it("answers one sentence naming what the writer wrote, whether the name or id exists there or not", async () => {
    const byExistingSlug = await written(agentNaming({ org: "globex", slug: "theirs" }));
    const byMissingSlug = await written(agentNaming({ org: "globex", slug: "nobody" }));
    expect(byExistingSlug?.rawMessage).toBe(unavailable("theirs"));
    expect(byMissingSlug?.rawMessage).toBe(unavailable("nobody"));

    // By id alone: the sentence names the id, never what that organization calls it.
    const byExistingId = await written(agentNaming({ org: "globex", id: "skl_g" }));
    const byMissingId = await written(agentNaming({ org: "globex", id: "skl_none" }));
    expect(byExistingId?.rawMessage).toBe(unavailable("skl_g"));
    expect(byMissingId?.rawMessage).toBe(unavailable("skl_none"));

    // A slug beside an id that disagree: refused alike whether the slug names something.
    const disagreeing = await written(agentNaming({ org: "globex", slug: "shared", id: "skl_none" }));
    const unknown = await written(agentNaming({ org: "globex", slug: "nobody-else", id: "skl_none" }));
    expect(disagreeing?.code).toBe(Code.FailedPrecondition);
    expect(disagreeing?.rawMessage).toBe(unavailable("shared"));
    expect(unknown?.rawMessage).toBe(unavailable("nobody-else"));
  });

  it("a reference the rule admits there is stored by its id alone", async () => {
    let stored: ReturnType<typeof agentNaming> | undefined;
    expect(await written(agentNaming({ org: "globex", slug: "shared" }), (s) => (stored = s))).toBeUndefined();
    expect(stored?.spec!.skillRefs[0]).toMatchObject({ org: "globex", kind: K.skill, id: "skl_s", slug: "" });
  });
});
