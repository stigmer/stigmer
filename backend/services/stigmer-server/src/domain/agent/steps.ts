/**
 * Agent domain-local pipeline steps — port the inline steps of
 * pkg/domain/agent/controller/ (create.go, delete_cascade.go,
 * get_default.go, merge_mcp_env_specs.go).
 * Shared steps stay in src/pipeline/steps/; these exist because they
 * embody agent-specific contracts: the cascade rules, MCP env merging and
 * the agent's hooks.
 *
 * The agent's tool lists (spec.tools, spec.disallowed_tools and each
 * sub-agent's pair) have no step here on purpose: their shape is the
 * proto's per-item pattern, enforced by the validate step every chain
 * runs, and their names are never checked against a server's discovered
 * tools. A portable plugin agent must apply on any installation, and an
 * entry naming a tool the turn lacks is ignored at run time, as Claude
 * Code ignores it.
 */
import { ConnectError } from "@connectrpc/connect";
import { create, fromBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import {
  HOOK_CONDITION_PATTERN,
  RUN_EVENTS,
  isValidMatcher,
} from "@stigmer/plugin-package";

import { AgentStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/status_pb";
import type {
  Agent,
  AgentSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentShareSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import { EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import type { EnvVarDeclaration } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/declaration_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { HookFormat } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import type { HookConfig, HookHandler } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/hooks_pb";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import {
  goWrappedStatusError,
  internalError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import type { CallerIdentity } from "../../extensions/identity.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { cleanUpDeletedResource } from "../../pipeline/steps/authorization-tuples.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import { findResourceBySlug } from "../../pipeline/steps/helpers.js";
import type { Store } from "../../store/interface.js";
type AgentDesc = typeof AgentSchema;

// ---------------------------------------------------------------------------
// MergeMcpServerEnvSpecs — merge_mcp_env_specs.go: merges env DECLARATIONS
// from referenced MCP servers into the agent's env at create/update time,
// so the UI/CLI can show what the agent needs, a person knows which keys to
// keep in My vault, and execution-time validation has the complete schema.
//
// Merge semantics: agent-declared entries always take precedence (user
// intent is preserved); among MCP servers, first-encountered wins for
// overlapping keys; only declaration fields (description, is_secret,
// optional) are merged — actual values come from the vaults a run
// resolves at runtime (domain/vault/resolve.ts).
//
// Lenient by design: a server that cannot be found (not yet created,
// different org, …) logs a warning and is skipped. The authoritative
// fail-fast check is the run's credential resolver at execution creation.
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
// ValidateHooks — the agent's hook sources (spec.hooks), checked where the
// proto's own rules cannot reach. Each plugin is listed once by slug: the
// slug is what a run records as the deciding hook (ToolCall
// .approval_policy_hook) and what a hook's "approve all" lease is keyed by,
// so two plugins sharing one, even from two organizations, would share a
// lease. One inline block at most, so "the agent's own hooks" names one
// thing. An inline block is held to the rules a plugin's hooks are held to
// at install, from the one library that reads them (@stigmer/plugin-package),
// in either format, since both engines run both. Claude Code's: the two
// tool-call events, a matcher that is "*", an exact list or a regular
// expression, an `if` in a permission rule's shape, and no fail_closed,
// which Claude Code hooks do not honour. Cursor's: the five tool-call
// events Stigmer runs, a matcher that is "*" or a regular expression, and
// neither an `if` nor `args` nor `${user_config.*}`, which Cursor's format
// does not have. An omitted format is filled with
// Claude Code's, so an author writing a block by hand never names an enum,
// the way the env merge completes the spec; a Cursor block names its format.
//
// Pipeline position: before NormalizeReferences, so malformed hooks are
// INVALID_ARGUMENT before any reference is looked up; before the version
// hash, so the filled format is part of what is hashed.
// ---------------------------------------------------------------------------

export function newValidateHooksStep(): PipelineStep<AgentDesc> {
  return {
    name: "ValidateHooks",
    execute(ctx: RequestContext<AgentDesc>): void {
      const pluginSlugs = new Set<string>();
      let inlineBlocks = 0;
      for (const source of ctx.newState.spec?.hooks ?? []) {
        switch (source.source.case) {
          case "plugin": {
            const slug = source.source.value.slug;
            if (pluginSlugs.has(slug)) {
              throw invalidArgumentError(
                `hooks lists plugin '${slug}' more than once; list each plugin once, and never two plugins that share a slug`,
              );
            }
            pluginSlugs.add(slug);
            break;
          }
          case "inline":
            inlineBlocks++;
            if (inlineBlocks > 1) {
              throw invalidArgumentError(
                "hooks carries more than one inline block; write the agent's own hooks in one block",
              );
            }
            checkInlineHooks(source.source.value);
            break;
          case undefined:
            // An empty source is the proto's own oneof rule to refuse.
            break;
        }
      }
    },
  };
}

/** One inline block against the install rules; fills an omitted format. */
function checkInlineHooks(block: HookConfig): void {
  const format = block.format === HookFormat.CURSOR ? "cursor" : "claude-code";
  if (format === "claude-code") block.format = HookFormat.CLAUDE_CODE;
  const events = RUN_EVENTS[format];
  for (const group of block.groups) {
    if (!events.has(group.event)) {
      throw invalidArgumentError(
        `the agent's hooks block names event '${group.event}', which Stigmer does not run in ${FORMAT_NAMES[format]} format; use ${[...events].join(", ")}`,
      );
    }
    if (!isValidMatcher(group.matcher, format)) {
      throw invalidArgumentError(
        format === "cursor"
          ? `the agent's ${group.event} hook has matcher '${group.matcher}', which is not '*' or a regular expression`
          : `the agent's ${group.event} hook has matcher '${group.matcher}', which is not '*', a list of tool names or a regular expression`,
      );
    }
    for (const handler of group.handlers) {
      if (format === "cursor") {
        checkCursorHandler(group.event, handler);
        continue;
      }
      if (
        handler.condition !== "" &&
        !HOOK_CONDITION_PATTERN.test(handler.condition)
      ) {
        throw invalidArgumentError(
          `the agent's ${group.event} hook has condition '${handler.condition}', which is not a permission rule such as 'Bash' or 'Bash(git push *)'`,
        );
      }
      if (handler.failClosed) {
        throw invalidArgumentError(
          `the agent's ${group.event} hook sets fail_closed, which Claude Code hooks do not have: a Claude Code hook that fails lets the call through`,
        );
      }
      if (handler.args.length === 0 && handler.command.includes("${user_config.")) {
        throw invalidArgumentError(
          `the agent's ${group.event} hook reads \${user_config.*} in a command without args, which runs in bash where the value is not substituted; pass it in args`,
        );
      }
    }
  }
}

const FORMAT_NAMES: Readonly<Record<"claude-code" | "cursor", string>> = {
  "claude-code": "Claude Code's",
  cursor: "Cursor's",
};

/** A Cursor handler carries a command and may fail closed; it has no `if` and no exec form. */
function checkCursorHandler(event: string, handler: HookHandler): void {
  if (handler.condition !== "") {
    throw invalidArgumentError(
      `the agent's ${event} hook sets a condition, which Cursor's hook format does not have; narrow it with the matcher`,
    );
  }
  if (handler.args.length > 0) {
    throw invalidArgumentError(
      `the agent's ${event} hook sets args, which Cursor's hook format does not have; a Cursor hook's command runs in bash`,
    );
  }
  if (handler.command.includes("${user_config.")) {
    throw invalidArgumentError(
      `the agent's ${event} hook reads \${user_config.*}, which Cursor's hook format does not substitute`,
    );
  }
}

// ---------------------------------------------------------------------------
// Cascade steps — delete_cascade.go. Children before parent, so a
// mid-failure retry converges. Each child's access goes with its row: the
// composed driver hears the child's own delete event right after the row
// (cleanUpDeletedResource, best-effort as every delete chain's cleanup),
// while the agent and its organization still hold the links the child
// reaches its organization through (stigmer#1603). What deliberately
// SURVIVES an agent delete, and must never be swept into this cascade:
// sessions and agent executions (historical record, the #582 posture —
// they reference the agent by its immutable id, and a session's next turn
// fails naming the agent that is gone) and resource_audit
// rows (surviving sessions and executions render their historical state
// from them).
// ---------------------------------------------------------------------------

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
  lifecycle: ResourceAuthorizationLifecycle | undefined,
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
        await cleanUpDeletedResource(lifecycle, logger, {
          kind: ApiResourceKind.agent_share,
          resourceId: shareId,
          orgId: agentOrg,
          caller: ctx.callerIdentity,
        });
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
