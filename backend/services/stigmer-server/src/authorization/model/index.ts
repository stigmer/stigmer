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
 * Registered: every kind of the open-source tier — the twenty-four
 * `kind_meta.tier: open_source` members — and nothing else. The three
 * files `fga.mod` lists that have no declaration here (`platform`,
 * `identity_provider`, `invitation`) are kinds this edition does not
 * serve: a check that targets one is refused by the
 * driver, and a tuple that names one (`identity_provider#platform_user`)
 * resolves to nobody. The registry test pins the list against the tier.
 */
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { agentDeclaration } from "./agent.js";
import { agentChannelDeclaration } from "./agent_channel.js";
import { agentExecutionDeclaration } from "./agent_execution.js";
import { agentInstanceDeclaration } from "./agent_instance.js";
import { agentShareDeclaration } from "./agent_share.js";
import { apiKeyDeclaration } from "./api_key.js";
import { artifactDeclaration } from "./artifact.js";
import { channelAppDeclaration } from "./channel_app.js";
import { environmentDeclaration } from "./environment.js";
import { executionContextDeclaration } from "./execution_context.js";
import { iamPolicyDeclaration } from "./iam_policy.js";
import { identityAccountDeclaration } from "./identity_account.js";
import { mcpServerDeclaration } from "./mcp_server.js";
import { memoryDeclaration } from "./memory.js";
import { oauthAppDeclaration } from "./oauth_app.js";
import { organizationDeclaration } from "./organization.js";
import { platformClientDeclaration } from "./platform_client.js";
import { pluginDeclaration } from "./plugin.js";
import type { KindDeclaration } from "./rewrite.js";
import { scheduleDeclaration } from "./schedule.js";
import { sessionDeclaration } from "./session.js";
import { skillDeclaration } from "./skill.js";
import { workflowDeclaration } from "./workflow.js";
import { workflowExecutionDeclaration } from "./workflow_execution.js";
import { workflowInstanceDeclaration } from "./workflow_instance.js";

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
  identityAccountDeclaration,
  iamPolicyDeclaration,
  apiKeyDeclaration,
  oauthAppDeclaration,
  platformClientDeclaration,
  organizationDeclaration,
  agentDeclaration,
  agentChannelDeclaration,
  agentShareDeclaration,
  channelAppDeclaration,
  agentInstanceDeclaration,
  agentExecutionDeclaration,
  artifactDeclaration,
  environmentDeclaration,
  executionContextDeclaration,
  mcpServerDeclaration,
  memoryDeclaration,
  scheduleDeclaration,
  sessionDeclaration,
  skillDeclaration,
  workflowDeclaration,
  workflowInstanceDeclaration,
  workflowExecutionDeclaration,
  pluginDeclaration,
]);

/** The built-in model's declaration for a kind, or undefined for a kind it does not evaluate. */
export function declarationFor(
  kind: ApiResourceKind,
): KindDeclaration | undefined {
  return builtInModel.byKind(kind);
}
