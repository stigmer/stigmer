/**
 * Pins the built-in model's registry: which kinds are declared — every
 * kind of the open-source tier, in `fga.mod` order, and nothing else —
 * that each declaration names its `.fga` source by its own type, that a
 * kind is reached by enum and by FGA type name alike, and that every
 * permission the wire can ask about (the IamPermission vocabulary) is
 * either a declared relation of the kind or absent from its `.fga` file —
 * never a relation the transcript forgot.
 *
 * The kind list is pinned twice on purpose: as the literal in registry
 * order (a reordering or a dropped file is a visible diff) and as
 * set-equal to the `kind_meta.tier` open-source members (a kind the
 * contract moves into or out of the tier is a visible diff here before
 * it is a silent gap in enforcement).
 */
import { describe, expect, it } from "vitest";

import {
  ApiResourceKind,
  ApiResourceKindSchema,
  ResourceTier,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermissionSchema } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import {
  getKindMeta,
  kindEnumName,
} from "../../../pipeline/apiresource-meta.js";
import { builtInModel, declarationFor } from "../index.js";

/** The open-source tier, in registry order (the `fga.mod` order of their files). */
const DECLARED_KINDS = [
  ApiResourceKind.identity_account,
  ApiResourceKind.iam_policy,
  ApiResourceKind.api_key,
  ApiResourceKind.oauth_app,
  ApiResourceKind.platform_client,
  ApiResourceKind.organization,
  ApiResourceKind.agent,
  ApiResourceKind.agent_channel,
  ApiResourceKind.agent_share,
  ApiResourceKind.channel_app,
  ApiResourceKind.agent_instance,
  ApiResourceKind.agent_execution,
  ApiResourceKind.artifact,
  ApiResourceKind.environment,
  ApiResourceKind.execution_context,
  ApiResourceKind.mcp_server,
  ApiResourceKind.memory,
  ApiResourceKind.schedule,
  ApiResourceKind.session,
  ApiResourceKind.skill,
  ApiResourceKind.workflow,
  ApiResourceKind.workflow_instance,
  ApiResourceKind.workflow_execution,
  ApiResourceKind.plugin,
] as const;

/**
 * The permissions each `.fga` file defines that the wire vocabulary also
 * names, in the file's order — derived by hand from the files at the
 * pinned commit. A relation in the file and not here, or here and not in
 * the transcript, fails. Verbs the files define outside the vocabulary
 * (`can_use`, `can_clone`, `can_rotate`, `can_revoke`) are the model's
 * own and are not listed.
 */
const WIRE_PERMISSIONS_BY_TYPE: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  identity_account: [
    "can_view",
    "can_edit",
    "can_delete",
    "can_grant_access",
    "can_view_access",
  ],
  iam_policy: [
    "can_view",
    "can_edit",
    "can_delete",
    "can_grant_access",
    "can_view_access",
  ],
  api_key: [
    "can_view",
    "can_edit",
    "can_delete",
    "can_grant_access",
    "can_view_access",
  ],
  oauth_app: [
    "can_view",
    "can_edit",
    "can_delete",
    "can_grant_access",
    "can_view_access",
  ],
  platform_client: [
    "can_view",
    "can_edit",
    "can_delete",
    "can_grant_access",
    "can_view_access",
  ],
  organization: [
    "can_view",
    "can_edit",
    "can_delete",
    "can_create_agent",
    "can_create_workflow",
    "can_create_session",
    "can_create_environment",
    "can_create_skill",
    "can_create_plugin",
    "can_create_mcp_server",
    "can_create_idp",
    "can_create_identity_account",
    "can_create_oauth_app",
    "can_create_platform_client",
    "can_create_channel_app",
    "can_create_execution_in",
    "can_create_agent_share",
    "can_create_agent_instance",
    "can_grant_access",
    "can_view_access",
    "can_view_billing",
    "can_manage_billing",
  ],
  agent: [
    "can_view",
    "can_edit",
    "can_delete",
    "can_execute",
    "can_create_instance",
    "can_grant_access",
    "can_view_access",
  ],
  agent_channel: [
    "can_view",
    "can_edit",
    "can_delete",
    "can_participate",
    "can_grant_access",
    "can_view_access",
  ],
  agent_share: [
    "can_view",
    "can_edit",
    "can_delete",
    "can_grant_access",
    "can_view_access",
  ],
  channel_app: [
    "can_view",
    "can_edit",
    "can_delete",
    "can_grant_access",
    "can_view_access",
  ],
  agent_instance: [
    "can_view",
    "can_execute",
    "can_edit",
    "can_delete",
    "can_grant_access",
    "can_view_access",
  ],
  agent_execution: ["can_view", "can_edit"],
  artifact: ["can_view", "can_edit"],
  environment: [
    "can_view",
    "can_edit",
    "can_delete",
    "can_read_secrets",
    "can_grant_access",
    "can_view_access",
  ],
  execution_context: ["can_view", "can_edit"],
  mcp_server: [
    "can_view",
    "can_edit",
    "can_delete",
    "can_connect",
    "can_grant_access",
    "can_view_access",
  ],
  memory: ["can_view", "can_edit", "can_delete"],
  schedule: [
    "can_view",
    "can_edit",
    "can_delete",
    "can_grant_access",
    "can_view_access",
  ],
  session: [
    "can_view",
    "can_edit",
    "can_delete",
    "can_create_execution_in",
    "can_grant_access",
    "can_view_access",
  ],
  skill: [
    "can_view",
    "can_edit",
    "can_delete",
    "can_grant_access",
    "can_view_access",
  ],
  workflow: [
    "can_view",
    "can_edit",
    "can_delete",
    "can_execute",
    "can_grant_access",
    "can_view_access",
  ],
  plugin: [
    "can_view",
    "can_edit",
    "can_delete",
    "can_grant_access",
    "can_view_access",
  ],
  workflow_instance: [
    "can_view",
    "can_execute",
    "can_edit",
    "can_delete",
    "can_grant_access",
    "can_view_access",
  ],
  workflow_execution: [
    "can_view",
    "can_edit",
    "can_grant_access",
    "can_view_access",
  ],
};

/** Every kind whose `kind_meta.tier` is the open-source tier, by enum number. */
function openSourceTierKinds(): ReadonlySet<ApiResourceKind> {
  const kinds = new Set<ApiResourceKind>();
  for (const value of ApiResourceKindSchema.values) {
    const kind = value.number as ApiResourceKind;
    if (
      kind !== ApiResourceKind.api_resource_kind_unknown &&
      getKindMeta(kind).tier === ResourceTier.open_source
    ) {
      kinds.add(kind);
    }
  }
  return kinds;
}

describe("the built-in model's registry", () => {
  it("declares exactly the open-source tier's kinds, in fga.mod order", () => {
    expect(builtInModel.declarations.map((d) => d.kind)).toEqual([
      ...DECLARED_KINDS,
    ]);
    expect(new Set(DECLARED_KINDS)).toEqual(openSourceTierKinds());
  });

  it("reaches a declaration by kind and by FGA type name, and answers undefined for the kinds this edition does not serve", () => {
    for (const kind of DECLARED_KINDS) {
      const byKind = declarationFor(kind);
      expect(byKind?.kind).toBe(kind);
      expect(builtInModel.byType(kindEnumName(kind))).toBe(byKind);
    }
    for (const unserved of [
      ApiResourceKind.platform,
      ApiResourceKind.identity_provider,
      ApiResourceKind.invitation,
    ]) {
      expect(declarationFor(unserved), kindEnumName(unserved)).toBeUndefined();
    }
    expect(builtInModel.byType("")).toBeUndefined();
  });

  it("names its `.fga` source by the kind's own type, under the module the fga.mod files it in", () => {
    for (const declaration of builtInModel.declarations) {
      expect(declaration.source).toMatch(
        new RegExp(
          `^fga/model/(tenancy|agentic|iam)/${declaration.type}\\.fga$`,
        ),
      );
    }
  });

  it("declares, for every kind, exactly the wire permissions its `.fga` file defines", () => {
    const wireVocabulary = new Set(
      IamPermissionSchema.values.map((value) => value.name),
    );
    expect(Object.keys(WIRE_PERMISSIONS_BY_TYPE).sort()).toEqual(
      builtInModel.declarations.map((d) => d.type).sort(),
    );
    for (const declaration of builtInModel.declarations) {
      const declaredWirePermissions = [...declaration.relations.keys()].filter(
        (relation) => wireVocabulary.has(relation),
      );
      expect(declaredWirePermissions, declaration.type).toEqual(
        WIRE_PERMISSIONS_BY_TYPE[declaration.type],
      );
    }
  });

  it("carries a derived rule only where kind_meta cannot derive the relation: default_of on the two instance kinds, execution_viewer on the workflow instance", () => {
    const derived = builtInModel.declarations
      .flatMap((d) => [...d.derived.keys()].map((r) => `${d.type}#${r}`))
      .sort();
    expect(derived).toEqual([
      "agent_instance#default_of",
      "workflow_instance#default_of",
      "workflow_instance#execution_viewer",
    ]);
  });
});
