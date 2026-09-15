/**
 * The built-in model — every kind declaration open source evaluates,
 * registered once in the order the cloud's `fga.mod` files them, and
 * reached by kind (the driver's `AuthzCheck.resourceKind`) or by FGA type
 * name (an object reference inside a tuple). A kind with no declaration
 * is one this edition does not evaluate: as a check TARGET that is a
 * registry gap the evaluator throws on (the driver refuses unserved kinds
 * before any evaluation, so the throw is a backstop); reached through a
 * tuple it is simply an object with no relations.
 *
 * `newModel` exists for tests that need a throwaway model (a cycle, a
 * chain past the depth bound) and for the cloud's drift test, which
 * builds a model from the live `.fga` files and compares.
 *
 * Registered so far: the organization and the four blueprint kinds that
 * share the visibility axis. The remaining open-source kinds follow, and
 * the registry test's pin then becomes "every kind of the open-source
 * tier".
 */
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { agentDeclaration } from "./agent.js";
import { mcpServerDeclaration } from "./mcp_server.js";
import { organizationDeclaration } from "./organization.js";
import type { KindDeclaration } from "./rewrite.js";
import { skillDeclaration } from "./skill.js";
import { workflowDeclaration } from "./workflow.js";

export interface Model {
  /** In registry order. */
  readonly declarations: ReadonlyArray<KindDeclaration>;
  byKind(kind: ApiResourceKind): KindDeclaration | undefined;
  byType(type: string): KindDeclaration | undefined;
}

export function newModel(declarations: ReadonlyArray<KindDeclaration>): Model {
  const byKind = new Map<ApiResourceKind, KindDeclaration>();
  const byType = new Map<string, KindDeclaration>();
  for (const declaration of declarations) {
    if (byKind.has(declaration.kind)) {
      throw new Error(`${declaration.type} is declared twice in the model`);
    }
    byKind.set(declaration.kind, declaration);
    byType.set(declaration.type, declaration);
  }
  return {
    declarations,
    byKind: (kind) => byKind.get(kind),
    byType: (type) => byType.get(type),
  };
}

/** The declarations this edition evaluates, in `fga.mod` order. */
export const builtInModel: Model = newModel([
  organizationDeclaration,
  agentDeclaration,
  mcpServerDeclaration,
  skillDeclaration,
  workflowDeclaration,
]);

/** The built-in model's declaration for a kind, or undefined for a kind it does not evaluate. */
export function declarationFor(
  kind: ApiResourceKind,
): KindDeclaration | undefined {
  return builtInModel.byKind(kind);
}
