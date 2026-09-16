/**
 * The one edge the plugin domain has onto the four child domains — a
 * consumer-defined, method-segregated surface the composition root
 * satisfies with in-process clients (boot/inprocess.ts), the
 * `AgentInstanceApplier` shape. Every call rides the in-process router
 * transport AS THE INSTALLING CALLER (ruling R5's `asCaller` lane): each
 * child's full chain runs — validation, the caller's own permission for
 * that kind, references, the reserved-label and managed guards (both pass
 * by origin), persist, tuples, index — so a materialised skill is a skill
 * the CLI could have pushed, attributed to the user who installed it.
 *
 * Why an interface and not the clients: the domain reads at its boundary
 * what it needs and nothing more (no update, no create, no reads), the
 * agent↔agentinstance-style cycle between routes and clients is broken at
 * the consumer with a lazy provider, and a test supplies a recording fake.
 */
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import type { PushSkillRequest } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import type { Workflow } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";

export interface PluginMaterializer {
  /** Skill push is upsert-by-slug from the frontmatter; the request carries the plugin's labels. */
  pushSkill(request: PushSkillRequest, caller: CallerIdentity): Promise<Skill>;
  /** Apply is upsert-by-slug for the three YAML kinds. */
  applyMcpServer(server: McpServer, caller: CallerIdentity): Promise<McpServer>;
  applyAgent(agent: Agent, caller: CallerIdentity): Promise<Agent>;
  applyWorkflow(workflow: Workflow, caller: CallerIdentity): Promise<Workflow>;
  /**
   * The one door for a level change (metadata.proto): an existing member
   * whose level differs from the plugin's is moved here after apply.
   */
  updateVisibility(
    kind: ApiResourceKind,
    resourceId: string,
    visibility: ApiResourceVisibility,
    caller: CallerIdentity,
  ): Promise<void>;
  /** A member the new archive dropped, or the whole set on uninstall. */
  deleteByKind(
    kind: ApiResourceKind,
    resourceId: string,
    caller: CallerIdentity,
  ): Promise<void>;
}

/** Lazy provider: the clients exist only after the routes they ride are registered. */
export type PluginMaterializerProvider = () => PluginMaterializer;
