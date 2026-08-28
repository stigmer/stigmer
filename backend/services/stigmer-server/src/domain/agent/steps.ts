/**
 * Agent domain-local pipeline steps — port the inline steps of
 * pkg/domain/agent/controller/ (create.go, delete_cascade.go,
 * get_default.go, merge_mcp_env_specs.go, validate_enabled_tools.go).
 * Shared steps stay in src/pipeline/steps/; these exist because they
 * embody agent-specific contracts: the default-instance choreography, the
 * cascade rules, MCP env merging, and enabled-tools validation.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import { create, fromBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import { AgentStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/status_pb";
import type {
  Agent,
  AgentSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentInstance } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { AgentInstanceSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { DiscoveredCapabilities } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import {
  classify,
  isValidClassification,
  quoteJoin,
  toolNames,
} from "../mcpserver/enabledtools/enabledtools.js";
import {
  goWrappedStatusError,
  internalError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { notifyDefaultInstanceLinked } from "../../pipeline/steps/authorization-tuples.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { TARGET_RESOURCE_KEY } from "../../pipeline/steps/load-target.js";
import { findResourceBySlug } from "../../pipeline/steps/helpers.js";
import type { Store } from "../../store/interface.js";
import { buildDefaultInstanceRequest } from "../agentinstance/defaultinstance.js";
import {
  DefaultAgentNotConfiguredError,
  DefaultAgentNotPublicError,
  findDefaultAgent,
} from "./defaultagent.js";

/** Context key carrying the applied default instance's id (Go DefaultInstanceIDKey). */
const DEFAULT_INSTANCE_ID_KEY = "default_instance_id";

type AgentDesc = typeof AgentSchema;

/**
 * The narrow in-process surface the agent domain needs from agentinstance —
 * consumer-defined so the dependency reads at the domain boundary (the Go
 * twin is pkg/downstream/agentinstance.Client). Calls ride the in-process
 * router transport, traversing the full interceptor chain (DD-002).
 */
export interface AgentInstanceApplier {
  /**
   * Applies AS THE ORIGINAL CALLER (C2 Stage 3, ruling R5 — the Java
   * applyAsCaller posture): the propagated identity gives the default
   * instance real owner attribution, so its creator can manage it under
   * an enforcing Authorizer. Pre-R5 this ran as the internal class,
   * which the cloud's tuple driver deliberately never attributes.
   */
  applyAsCaller(
    instance: AgentInstance,
    caller: CallerIdentity,
  ): Promise<AgentInstance>;
}

/**
 * Lazy provider for the agent↔agentinstance true cycle — resolved at call
 * time, never at construction (the ratified DI story, D2 §2).
 */
export type AgentInstanceApplierProvider = () => AgentInstanceApplier;

// ---------------------------------------------------------------------------
// ValidateEnabledTools — validate_enabled_tools.go: rejects agent manifests
// whose McpServerUsage.enabled_tools name tools the referenced MCP server
// does not expose (issue #402). Runtime enforcement (runner
// shared/mcp-enabled-tools.ts, issue #350) is deliberately lenient — warn
// and drop — so a manifest typo silently narrows the agent's toolset; this
// step is the apply-time half of that owner decision: reject the typo where
// the operator can see it, with the server's real tool names in the error.
//
// Deliberate skips: empty enabled_tools ("use the server's
// default_enabled_tools"); referenced server not found (ValidateReferences,
// earlier in the pipeline, already rejects with its own actionable error);
// server without discovered_capabilities (not yet connected — no
// authoritative toolset; the runner's warn-and-intersect remains the safety
// net for that window).
//
// Pipeline position: AFTER ValidateReferences, BEFORE Persist.
// ---------------------------------------------------------------------------

export function newValidateEnabledToolsStep(
  store: Store,
): PipelineStep<AgentDesc> {
  return {
    name: "ValidateEnabledTools",
    async execute(ctx: RequestContext<AgentDesc>): Promise<void> {
      const agent = ctx.newState;

      for (const usage of agent.spec?.mcpServerUsages ?? []) {
        if (usage.enabledTools.length === 0) {
          continue;
        }

        const ref = usage.mcpServerRef;
        const slug = ref?.slug ?? "";
        if (slug === "") {
          continue;
        }
        let org = ref?.org ?? "";
        if (org === "") {
          org = agent.metadata?.org ?? "";
        }

        let mcpServer: McpServer | undefined;
        try {
          mcpServer = await findResourceBySlug(
            store,
            ApiResourceKind.mcp_server,
            McpServerSchema,
            slug,
            org,
          );
        } catch (error) {
          // Go wraps as a plain error → the pipeline's Internal fallback.
          throw new Error(
            `failed to look up MCP server '${slug}' (org: ${org}) for enabled_tools validation: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        if (mcpServer === undefined) {
          continue;
        }

        const caps = mcpServer.status?.discoveredCapabilities;
        if (caps === undefined) {
          continue;
        }

        const classification = classify(caps, usage.enabledTools);
        if (!isValidClassification(classification)) {
          throw invalidEnabledToolsError(slug, org, classification, caps);
        }
      }
    },
  };
}

/**
 * Go invalidEnabledToolsError: the operator-facing INVALID_ARGUMENT. It
 * names the offending entries, distinguishes resource-template names from
 * plain typos, and lists the discovered tool names so the fix is one edit
 * away. The refresh hint covers the honest failure mode where the server's
 * toolset changed after the last discovery. Byte-pinned copy.
 */
function invalidEnabledToolsError(
  slug: string,
  org: string,
  c: ReturnType<typeof classify>,
  caps: DiscoveredCapabilities,
): ConnectError {
  const problems: string[] = [];
  if (c.unknown.length > 0) {
    problems.push(
      `enabled_tools names tool(s) the server does not expose: ${quoteJoin(c.unknown)}`,
    );
  }
  if (c.resourceTemplates.length > 0) {
    problems.push(
      `enabled_tools names resource template(s): ${quoteJoin(c.resourceTemplates)} — resource templates are read-only data endpoints, not callable tools, and must not appear in enabled_tools`,
    );
  }

  return invalidArgumentError(
    `MCP server '${slug}' (org: ${org}): ${problems.join("; ")}. ` +
      `Discovered tools: ${quoteJoin(toolNames(caps))}. ` +
      "If the server's toolset changed, run 'stigmer connect' on it to refresh discovered capabilities.",
  );
}

// ---------------------------------------------------------------------------
// MergeMcpServerEnvSpecs — merge_mcp_env_specs.go: merges env DECLARATIONS
// from referenced MCP servers into the agent's env at create/update time,
// so the UI/CLI can show what the agent needs, AgentInstance configuration
// knows which vars to supply, and execution-time validation has the
// complete schema.
//
// Merge semantics: agent-declared entries always take precedence (user
// intent is preserved); among MCP servers, first-encountered wins for
// overlapping keys; only declaration fields (description, is_secret,
// optional) are merged — actual values come from
// AgentInstance.environment_refs at runtime.
//
// Lenient by design: a server that cannot be found (not yet created,
// different org, …) logs a warning and is skipped. The authoritative
// fail-fast check remains McpEnvironmentValidator at execution creation.
//
// Pipeline position: AFTER NormalizeReferences (needs resolved org),
// BEFORE Persist.
// ---------------------------------------------------------------------------

export function newMergeMcpServerEnvSpecsStep(
  store: Store,
  logger: Logger,
): PipelineStep<AgentDesc> {
  return {
    name: "MergeMcpServerEnvSpecs",
    async execute(ctx: RequestContext<AgentDesc>): Promise<void> {
      const agent = ctx.newState;

      const usages = agent.spec?.mcpServerUsages ?? [];
      if (usages.length === 0) {
        return;
      }

      const mcpEnvVars: Record<string, EnvVarDeclaration> = {};
      for (const usage of usages) {
        const ref = usage.mcpServerRef;

        const slug = ref?.slug ?? "";
        if (slug === "") {
          continue;
        }

        let org = ref?.org ?? "";
        if (org === "") {
          org = agent.metadata?.org ?? "";
        }
        if (org === "") {
          continue;
        }

        let mcpServer: McpServer | undefined;
        try {
          mcpServer = await findResourceBySlug(
            store,
            ApiResourceKind.mcp_server,
            McpServerSchema,
            slug,
            org,
          );
        } catch (error) {
          logger.warn("Failed to look up MCP server for env merge", {
            mcpServerSlug: slug,
            org,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
        if (mcpServer === undefined) {
          logger.warn(
            "MCP server not found — skipping env merge for this server",
            { mcpServerSlug: slug, org },
          );
          continue;
        }

        const serverEnv = mcpServer.spec?.env ?? {};
        for (const [varName, decl] of Object.entries(serverEnv)) {
          if (!(varName in mcpEnvVars)) {
            mcpEnvVars[varName] = create(EnvVarDeclarationSchema, {
              description: decl.description,
              isSecret: decl.isSecret,
              optional: decl.optional,
            });
          }
        }
      }

      if (Object.keys(mcpEnvVars).length === 0) {
        return;
      }

      const spec = agent.spec;
      if (spec === undefined) {
        return;
      }

      const existingEnv = spec.env;
      const merged: Record<string, EnvVarDeclaration> = { ...mcpEnvVars };
      for (const [k, v] of Object.entries(existingEnv)) {
        merged[k] = v;
      }
      spec.env = merged;

      const mergedCount =
        Object.keys(merged).length - Object.keys(existingEnv).length;
      if (mergedCount > 0) {
        logger.info("Merged MCP server env declarations into agent env", {
          injectedCount: mergedCount,
          totalCount: Object.keys(merged).length,
          agent: agent.metadata?.slug ?? "",
        });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// CreateDefaultInstance + UpdateAgentStatusWithDefaultInstance — create.go's
// post-persist choreography. Split in two so the second database persist is
// explicit in the chain (Go's stated rationale).
// ---------------------------------------------------------------------------

/**
 * Applies (not creates — idempotency) the agent's default instance through
 * the in-process client. Agent delete cascades the default instance, so
 * this normally routes to CREATE; the UPDATE route remains as self-heal for
 * pre-cascade legacy orphans (self-hosters upgrading across the T08
 * release), which Apply recovers by re-pointing agent_id at the new agent.
 *
 * Versus Go: no nil-client skip — the provider is a required dependency
 * (the staged composition root eliminates the nil-then-inject window whose
 * silent no-op the domain inventory flags).
 */
export function newCreateDefaultInstanceStep(
  applierProvider: AgentInstanceApplierProvider,
  logger: Logger,
): PipelineStep<AgentDesc> {
  return {
    name: "CreateDefaultInstance",
    async execute(ctx: RequestContext<AgentDesc>): Promise<void> {
      const agent = ctx.newState;
      const metadata = agent.metadata;
      if (metadata === undefined) {
        throw internalError(
          new Error("agent metadata is nil after persist"),
          "agent metadata is nil after persist",
        );
      }

      logger.info("Creating default instance for agent", {
        agentId: metadata.id,
        slug: metadata.slug,
        org: metadata.org,
      });

      const instanceRequest = buildDefaultInstanceRequest(metadata);

      // Go create.go:124-127 wraps the downstream error with fmt.Errorf
      // ("failed to apply default instance: %w") and PipelineError
      // .GRPCStatus's errors.As branch keeps the inner CODE but rewrites
      // the wire MESSAGE to the wrapped text — transport formatting
      // (`rpc error: code = X desc = ...`) included. Mirrored byte-for-
      // byte via goWrappedStatusError; the leak is stigmer/stigmer#852
      // (both-editions post-cutover fix). Unstatused failures fall to the
      // pipeline's Internal fallback, exactly Go's plain-error path.
      let applied: AgentInstance;
      try {
        applied = await applierProvider().applyAsCaller(
          instanceRequest,
          ctx.callerIdentity,
        );
      } catch (error) {
        if (error instanceof ConnectError) {
          throw goWrappedStatusError("failed to apply default instance", error);
        }
        throw new Error(
          `failed to apply default instance: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      logger.info("Successfully applied default instance for agent", {
        instanceId: applied.metadata?.id ?? "",
        agentId: metadata.id,
      });

      ctx.set(DEFAULT_INSTANCE_ID_KEY, applied.metadata?.id ?? "");
    },
  };
}

/**
 * Writes status.default_instance_id onto the just-persisted agent and
 * re-persists. Reads the id from context (set by CreateDefaultInstance).
 * Fires the driver's default-instance link event AFTER the pointer
 * persists (C2 Stage 3 — the default_of invariant rides the pointer).
 */
export function newUpdateAgentStatusWithDefaultInstanceStep(
  store: Store,
  logger: Logger,
  authorizationLifecycle?: ResourceAuthorizationLifecycle,
): PipelineStep<AgentDesc> {
  return {
    name: "UpdateAgentStatusWithDefaultInstance",
    async execute(ctx: RequestContext<AgentDesc>): Promise<void> {
      const agent = ctx.newState;
      const agentId = agent.metadata?.id ?? "";

      const defaultInstanceId = ctx.get(DEFAULT_INSTANCE_ID_KEY);
      if (typeof defaultInstanceId !== "string" || defaultInstanceId === "") {
        // Unreachable with the required provider (Go's skip existed for its
        // nil-client test mode); loud beats silent per the boot idiom.
        throw internalError(
          new Error(
            "no default instance id in context (CreateDefaultInstance must run first)",
          ),
          "no default instance id in context (CreateDefaultInstance must run first)",
        );
      }

      if (agent.status === undefined) {
        agent.status = create(AgentStatusSchema, {});
      }
      agent.status.defaultInstanceId = defaultInstanceId;

      try {
        await store.saveResource(
          ctx.apiResourceKind,
          agentId,
          ctx.schema,
          agent,
        );
      } catch (error) {
        logger.error("Failed to persist agent with default_instance_id", {
          agentId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error(
          `failed to persist agent with default instance: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      await notifyDefaultInstanceLinked(authorizationLifecycle, {
        instanceKind: ApiResourceKind.agent_instance,
        instanceId: defaultInstanceId,
        blueprintKind: ApiResourceKind.agent,
        blueprintId: agentId,
      });

      ctx.setNewState(agent);

      logger.info(
        "Successfully updated agent status with default_instance_id",
        {
          defaultInstanceId,
          agentId,
        },
      );
    },
  };
}

// ---------------------------------------------------------------------------
// Cascade steps — delete_cascade.go. Children before parent, so a
// mid-failure retry converges. What deliberately SURVIVES an agent delete,
// and must never be swept into this cascade: sessions and agent executions
// (historical record, the #582 posture — they reference agent and instance
// by immutable IDs) and resource_audit rows (surviving sessions and
// executions render their historical state from them).
// ---------------------------------------------------------------------------

/**
 * Deletes EVERY instance of the agent (row + search-index entry) before the
 * agent is deleted — the system-managed default AND members' personal ones
 * (owner ruling stigmer/stigmer#611, extending the workflow ruling #592:
 * instances are configuration OF the agent, meaningless without it, and an
 * orphan occupies its org-scoped slug forever with no UI left to delete
 * it). Matched by spec.agent_id — a required, validated field on every
 * instance — so a single ID sweep covers the default instance too,
 * including legacy rows that predate the status.default_instance_id
 * pointer.
 */
export function newCascadeDeleteInstancesStep<Desc extends DescMessage>(
  store: Store,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "CascadeDeleteInstances",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const agent = ctx.get(EXISTING_RESOURCE_KEY) as Agent | undefined;
      if (agent === undefined) {
        throw internalError(
          new Error(
            "agent not found in context (LoadExistingForDelete must run first)",
          ),
          "agent not found in context (LoadExistingForDelete must run first)",
        );
      }
      const agentId = agent.metadata?.id ?? "";

      let rows: Uint8Array[];
      try {
        rows = await store.listResources(ApiResourceKind.agent_instance);
      } catch (error) {
        throw internalError(
          error,
          "failed to list agent instances for cascade delete",
        );
      }

      let deleted = 0;
      for (const data of rows) {
        let instance: AgentInstance;
        try {
          instance = fromBinary(AgentInstanceSchema, data);
        } catch {
          continue;
        }
        if ((instance.spec?.agentId ?? "") !== agentId) {
          continue;
        }
        const instanceId = instance.metadata?.id ?? "";
        try {
          await store.deleteResource(
            ApiResourceKind.agent_instance,
            instanceId,
          );
        } catch (error) {
          throw internalError(
            error,
            `failed to cascade-delete instance ${instanceId} of agent ${agentId}`,
          );
        }

        // Best-effort, matching DeleteSearchIndex: a stale index entry is a
        // cosmetic search artifact, not a correctness problem.
        try {
          await store.deleteSearchIndex(
            ApiResourceKind.agent_instance,
            instanceId,
          );
        } catch (error) {
          logger.warn(
            "CascadeDeleteInstances: failed to remove search index entry (best-effort)",
            {
              instanceId,
              error: error instanceof Error ? error.message : String(error),
            },
          );
        }
        deleted++;
      }

      if (deleted > 0) {
        logger.info("Cascade-deleted instances of agent", {
          count: deleted,
          agentId,
        });
      }
    },
  };
}

/**
 * Deletes the agent's SAME-ORG AgentShares before the agent is deleted.
 * Shares reference the agent by org+slug (spec.agent_ref), so a stale share
 * would silently rebind — audience, link token, and bound credentials
 * included — to whatever agent is later created at that slug. Matching by
 * spec.agent_ref finds them all regardless of each share's own slug (a
 * renamed share stays covered). Cross-org shares (another org sharing this
 * marketplace-public agent) are NOT cascaded: they are that org's
 * resources, and deleting them here would make agent delete a
 * cross-principal destructive action — they fail closed instead, via the
 * dangling-ref check and the status.agent_id pin every share-resolution
 * gate verifies. AgentShare is not search-indexed, so there is no index
 * entry to clean.
 */
export function newCascadeDeleteSharesStep<Desc extends DescMessage>(
  store: Store,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "CascadeDeleteShares",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const agent = ctx.get(EXISTING_RESOURCE_KEY) as Agent | undefined;
      if (agent === undefined) {
        throw internalError(
          new Error(
            "agent not found in context (LoadExistingForDelete must run first)",
          ),
          "agent not found in context (LoadExistingForDelete must run first)",
        );
      }
      const agentOrg = agent.metadata?.org ?? "";
      const agentSlug = agent.metadata?.slug ?? "";

      let rows: Uint8Array[];
      try {
        rows = await store.listResources(ApiResourceKind.agent_share);
      } catch (error) {
        throw internalError(
          error,
          "failed to list agent shares for cascade delete",
        );
      }

      let deleted = 0;
      for (const data of rows) {
        let share;
        try {
          share = fromBinary(AgentShareSchema, data);
        } catch {
          continue;
        }
        const ref = share.spec?.agentRef;
        if ((ref?.org ?? "") !== agentOrg || (ref?.slug ?? "") !== agentSlug) {
          continue;
        }
        if ((share.metadata?.org ?? "") !== agentOrg) {
          // A cross-org share — another org's resource. Fails closed via
          // the agent-id pin instead of being deleted here.
          continue;
        }
        const shareId = share.metadata?.id ?? "";
        try {
          await store.deleteResource(ApiResourceKind.agent_share, shareId);
        } catch (error) {
          throw internalError(
            error,
            `failed to cascade-delete share ${shareId} of agent ${agentOrg}/${agentSlug}`,
          );
        }
        deleted++;
      }

      if (deleted > 0) {
        logger.info("Cascade-deleted shares of agent", {
          count: deleted,
          agent: `${agentOrg}/${agentSlug}`,
        });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// LoadDefaultAgent — get_default.go's step: resolve via defaultagent and
// map its sentinels to the wire contract. Go builds the wire message with
// WrapError ("%s: %v"), so the sentinel's text RIDES the message — both
// strings are cross-edition conformance surface.
// ---------------------------------------------------------------------------

export function newLoadDefaultAgentStep<Desc extends DescMessage>(
  store: Store,
  logger: Logger,
): PipelineStep<Desc> {
  return {
    name: "LoadDefaultAgent",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      logger.info("Resolving platform default agent");

      let agent: Agent;
      try {
        agent = await findDefaultAgent(store, logger);
      } catch (error) {
        if (error instanceof DefaultAgentNotConfiguredError) {
          throw new ConnectError(
            `No default agent available. Ensure an agent with label stigmer.ai/default-agent=true and visibility_public exists: ${error.message}`,
            Code.NotFound,
          );
        }
        if (error instanceof DefaultAgentNotPublicError) {
          throw new ConnectError(
            `Default agent exists but is not visibility_public: ${error.message}`,
            Code.FailedPrecondition,
          );
        }
        // Store/decode failure — an internal fault, not "no default agent".
        // InternalError keeps the cause off the wire (stigmer/stigmer#478).
        logger.error("Failed to resolve platform default agent", {
          error: error instanceof Error ? error.message : String(error),
        });
        throw internalError(
          error,
          "failed to resolve the platform default agent",
        );
      }

      logger.info("Resolved platform default agent", {
        agentId: agent.metadata?.id ?? "",
        agentName: agent.metadata?.name ?? "",
      });

      ctx.set(TARGET_RESOURCE_KEY, agent);
    },
  };
}
