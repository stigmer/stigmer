/**
 * Pins the built-in model's registry: which kinds are declared, that each
 * declaration names its `.fga` source by its own type, that a kind is
 * reached by enum and by FGA type name alike, and that every permission
 * the wire can ask about (the IamPermission vocabulary) is either a
 * declared relation of the kind or absent from its `.fga` file — never a
 * relation the transcript forgot.
 *
 * The kind list is what is declared so far: five (the organization and the
 * four blueprint kinds sharing the visibility axis). The remaining kinds
 * replace the pinned list with "every kind of the open-source tier", which is the
 * registry's finished shape; until then a kind added without a line here
 * is a visible diff.
 */
import { describe, expect, it } from "vitest";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamPermissionSchema } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import { kindEnumName } from "../../../pipeline/apiresource-meta.js";
import { builtInModel, declarationFor } from "../index.js";

/** The slice-1 set, in registry order (the `fga.mod` order of their modules). */
const DECLARED_KINDS = [
  ApiResourceKind.organization,
  ApiResourceKind.agent,
  ApiResourceKind.mcp_server,
  ApiResourceKind.skill,
  ApiResourceKind.workflow,
] as const;

/**
 * The permissions each `.fga` file defines that the wire vocabulary also
 * names — derived by hand from the files at the pinned commit. A relation
 * in the file and not here, or here and not in the transcript, fails.
 */
const WIRE_PERMISSIONS_BY_TYPE: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  organization: [
    "can_view",
    "can_edit",
    "can_delete",
    "can_create_project",
    "can_create_agent",
    "can_create_workflow",
    "can_create_session",
    "can_create_environment",
    "can_create_skill",
    "can_create_idp",
    "can_create_identity_account",
    "can_create_oauth_app",
    "can_create_platform_client",
    "can_create_channel_app",
    "can_create_execution_in",
    "can_create_agent_share",
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
  mcp_server: [
    "can_view",
    "can_edit",
    "can_delete",
    "can_connect",
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
};

describe("the built-in model's registry", () => {
  it("declares exactly the slice's kinds, in order", () => {
    expect(builtInModel.declarations.map((d) => d.kind)).toEqual([
      ...DECLARED_KINDS,
    ]);
  });

  it("reaches a declaration by kind and by FGA type name, and answers undefined for the rest", () => {
    for (const kind of DECLARED_KINDS) {
      const byKind = declarationFor(kind);
      expect(byKind?.kind).toBe(kind);
      expect(builtInModel.byType(kindEnumName(kind))).toBe(byKind);
    }
    expect(declarationFor(ApiResourceKind.session)).toBeUndefined();
    expect(builtInModel.byType("identity_provider")).toBeUndefined();
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
    for (const declaration of builtInModel.declarations) {
      const declaredWirePermissions = [...declaration.relations.keys()].filter(
        (relation) => wireVocabulary.has(relation),
      );
      expect(declaredWirePermissions, declaration.type).toEqual(
        WIRE_PERMISSIONS_BY_TYPE[declaration.type],
      );
    }
  });
});
