/**
 * Agent domain-local pipeline steps. Shared steps stay in src/pipeline/steps/; these exist because they
 * embody agent-specific contracts: the cascade rules, the agent's hooks and its computer.
 *
 * The agent's tool lists (spec.tools, spec.disallowed_tools and each
 * sub-agent's pair) have no step here on purpose: their shape is the
 * proto's per-item pattern, enforced by the validate step every chain
 * runs, and their names are never checked against a server's discovered
 * tools. A portable plugin agent must apply on any installation, and an
 * entry naming a tool the turn lacks is ignored at run time, as Claude
 * Code ignores it.
 */
import { create, fromBinary } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";

import {
  HOOK_CONDITION_PATTERN,
  PLACEHOLDER_PATTERN,
  RUN_EVENTS,
  findPluginRootPlaceholder,
  isAcceptableServerUrl,
  isValidMatcher,
} from "@stigmer/plugin-package";
import { isReservedMcpServerName } from "@stigmer/tool-vocabulary";
import { Computer } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

import type {
  Agent,
  AgentSchema,
} from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { AgentSpec } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import { HookFormat } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/hooks_pb";
import type { HookConfig, HookHandler } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/hooks_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { Logger } from "../../boot/logger.js";
import {
  internalError,
  invalidArgumentError,
} from "../../pipeline/errors.js";
import type { ResourceAuthorizationLifecycle } from "../../extensions/resource-authorization.js";
import { cleanUpDeletedResource } from "../../pipeline/steps/authorization-tuples.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { Store } from "../../store/interface.js";
import { releaseNamesOfDeleted } from "../../pipeline/steps/names.js";
import { referenceDisplayNames } from "../../pipeline/steps/references.js";
import { refuseAgentWithoutComputer, whyAgentNeedsComputer } from "../run/computer.js";
import { loadRunPlugins, runPluginReferences } from "../run/run-plugins.js";
import { runSubagents } from "../run/run-subagents.js";
import type { RunSubagent } from "../run/run-subagents.js";
import type { RunPlugin } from "../vault/resolve.js";
type AgentDesc = typeof AgentSchema;

// ---------------------------------------------------------------------------
// ValidatePluginList — each plugin is listed once by slug (spec.plugins):
// the slug is what a run records as the deciding hook
// (ToolCall.approval_policy_hook) and what a hook's "approve all" lease is
// keyed by, and the name a turn gives its skills, agents and tools, so two
// plugins sharing one, even from two organizations, would share them. The
// plugins are compared by the names they hold now: NormalizeReferences ran
// first and left each one its id, so a plugin listed twice is one id and
// two plugins sharing a slug are two ids of one current name, read in one
// batch from the name table. INVALID_ARGUMENT, directly after
// ValidateReferences admitted every one of them, so the copy never names a
// plugin of another organization the writer has no standing to learn
// about (pipeline/steps/references.ts, clause iii).
// ---------------------------------------------------------------------------

export function newValidatePluginListStep(
  store: Store,
): PipelineStep<AgentDesc> {
  return {
    name: "ValidatePluginList",
    async execute(ctx: RequestContext<AgentDesc>): Promise<void> {
      const pluginSlugs = new Set<string>();
      for (const slug of await referenceDisplayNames(
        store,
        ApiResourceKind.plugin,
        ctx.newState.spec?.plugins ?? [],
      )) {
        if (pluginSlugs.has(slug)) {
          throw invalidArgumentError(
            `plugins lists '${slug}' more than once; list each plugin once, and never two plugins that share a slug`,
          );
        }
        pluginSlugs.add(slug);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// ValidateMcpServers — the agent's own MCP servers, checked where the
// proto's per-field rules cannot reach: across entries, and against the
// rules a plugin's HTTP server is held to at install, so a server written
// in an agent starts in a run exactly when the same server in a plugin
// would. A name is used once, and never one of the platform's, any name
// starting "stigmer", or "plugin" (`isReservedMcpServerName`), so
// `mcp__<name>__<tool>` always names one server, never a plugin's. The
// address is the plugin reader's (https, or http on a loopback host; no
// credentials or fragment) and holds no `${...}`: where a run dials is
// fixed when the agent is saved. A header is named once in any letter case,
// as HTTP reads it. A header value's `${...}` is a run value only in the
// runner's own grammar (`${NAME}`); anything else, a plugin's
// `${user_config.x}`, would reach the server as literal text, so it is
// refused here instead. A plugin's own directory (`${CLAUDE_PLUGIN_ROOT}`
// and its spellings) fits the grammar but names nothing an agent has: a
// header pasted from a plugin's .mcp.json that reads it is refused too.
//
// Pipeline position: right after ValidateHooks, before the version hash.
// ---------------------------------------------------------------------------

export function newValidateMcpServersStep(): PipelineStep<AgentDesc> {
  return {
    name: "ValidateMcpServers",
    execute(ctx: RequestContext<AgentDesc>): void {
      const names = new Set<string>();
      for (const server of ctx.newState.spec?.mcpServers ?? []) {
        const refuse = (why: string): never => {
          throw invalidArgumentError(`mcp_servers: server '${server.name}' ${why}`);
        };
        if (names.has(server.name)) refuse("is listed more than once; give each server its own name");
        names.add(server.name);
        if (isReservedMcpServerName(server.name)) {
          refuse("takes a reserved name: names starting with stigmer are the platform's, and plugin names a plugin's servers");
        }
        if (server.url.includes("${")) {
          refuse("names a variable in its url; the address is fixed when the agent is saved, so write it out");
        }
        if (!isAcceptableServerUrl(server.url)) {
          refuse(`has an address that is not https (or http on this machine), or holds credentials or a fragment: ${server.url}`);
        }
        const headers = new Set<string>();
        for (const [header, value] of Object.entries(server.headers)) {
          const key = header.toLowerCase();
          if (headers.has(key)) refuse(`names header '${header}' more than once`);
          headers.add(key);
          const root = findPluginRootPlaceholder(value);
          if (root !== undefined) {
            refuse(`header '${header}' reads ${root}, a plugin's own directory, which an agent has none of`);
          }
          if (value.replace(PLACEHOLDER_PATTERN, "").includes("${")) {
            refuse(`header '${header}' holds a \${...} that is not a run value; write \${NAME} with letters, digits and _`);
          }
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// ResolveAgentComputer — fills spec.computer where the write leaves it
// unset, so what is hashed is what the agent runs with. On create, unset
// becomes COMPUTER_REQUIRED when the agent names anything that needs a
// computer (whyAgentNeedsComputer, domain/run/computer.ts: the Claude
// harness, the shell, its own hooks, an Environment, an MCP server on this
// machine, a plugin or subagent that needs one) and COMPUTER_NONE when it
// names nothing that does: a new agent starts without a computer unless it
// needs one. The list is the one RefuseWhatNeedsAComputer refuses by, so
// the default never gives an agent a setting its own save would refuse.
// Its plugins and subagents are read here once, as that step reads them,
// and kept on the request for it. An explicit value is never changed.
//
// On update (apply's update arm included, which masks every path), unset
// keeps the stored value, as a conversation's update that names no engine
// keeps the stored one: a YAML file written before the setting, or an SDK
// that leaves it out, never changes it, and an agent that gains something
// needing a computer is refused rather than given one. An agent saved
// before the setting stays unset, so its version hash is the one it had.
//
// Pipeline position: directly before RefuseWhatNeedsAComputer, after
// PinSubagents, whose pins it reads, and before the version hash.
// ---------------------------------------------------------------------------

/** What ResolveAgentComputer read for the new agent, kept for RefuseWhatNeedsAComputer. */
interface ComputerReads {
  readonly plugins: readonly RunPlugin[];
  readonly subagents: readonly RunSubagent[];
}

/** The request-context key ResolveAgentComputer keeps its ComputerReads under. */
const COMPUTER_READS_KEY = "agentComputerReads";

/** The agent's plugins, at the version a turn reads them, and its subagents at their pins. */
async function readWhatNeedsAComputer(store: Store, spec: AgentSpec, org: string): Promise<ComputerReads> {
  const subagents = await runSubagents(store, spec, org);
  const plugins = await loadRunPlugins(store, runPluginReferences(spec, undefined, org), org);
  return { plugins, subagents };
}

export function newResolveAgentComputerStep(store: Store): PipelineStep<AgentDesc> {
  return {
    name: "ResolveAgentComputer",
    async execute(ctx: RequestContext<AgentDesc>): Promise<void> {
      const spec = ctx.newState.spec;
      if (spec === undefined || spec.computer !== Computer.UNSPECIFIED) {
        return;
      }
      const stored = ctx.get(EXISTING_RESOURCE_KEY) as Agent | undefined;
      if (stored !== undefined) {
        spec.computer = stored.spec?.computer ?? Computer.UNSPECIFIED;
        return;
      }
      const reads = await readWhatNeedsAComputer(store, spec, ctx.newState.metadata?.org ?? "");
      ctx.set(COMPUTER_READS_KEY, reads);
      spec.computer =
        whyAgentNeedsComputer(spec, reads.plugins, reads.subagents) === undefined ? Computer.NONE : Computer.REQUIRED;
    },
  };
}

// ---------------------------------------------------------------------------
// RefuseWhatNeedsAComputer — an agent without a computer may not name
// anything that needs one (whyAgentNeedsComputer, domain/run/computer.ts):
// the Claude harness, a Bash tool, its own hooks, an Environment, an MCP
// server of its own on this machine, a plugin with hooks or a local MCP
// server, or a subagent whose pinned version has a computer. The plugins
// are read at the version a turn reads them (run-plugins.ts), the
// subagents at their pins (run-subagents.ts), so saving and a turn judge
// the same things; a create whose computer ResolveAgentComputer filled
// reuses what it read. An agent with a computer reads nothing here.
//
// Pipeline position: after ResolveAgentComputer and PinSubagents, whose
// pins it reads, and before the version hash.
// ---------------------------------------------------------------------------

export function newRefuseWhatNeedsAComputerStep(store: Store): PipelineStep<AgentDesc> {
  return {
    name: "RefuseWhatNeedsAComputer",
    async execute(ctx: RequestContext<AgentDesc>): Promise<void> {
      const spec = ctx.newState.spec;
      if (spec === undefined || spec.computer !== Computer.NONE) {
        return;
      }
      const reads =
        (ctx.get(COMPUTER_READS_KEY) as ComputerReads | undefined) ??
        (await readWhatNeedsAComputer(store, spec, ctx.newState.metadata?.org ?? ""));
      refuseAgentWithoutComputer(spec, reads.plugins, reads.subagents);
    },
  };
}

// ---------------------------------------------------------------------------
// ValidateHooks — the agent's own hooks block, checked where the proto's
// own rules cannot reach. One inline block at most (spec.hooks), so "the
// agent's own hooks" names one thing. An inline block is held to the rules
// a plugin's hooks are held to
// at install, from the one library that reads them (@stigmer/plugin-package),
// in either format, since both engines run both. Claude Code's: the two
// tool-call events, a matcher that is "*", an exact list or a regular
// expression, an `if` in a permission rule's shape, and no fail_closed,
// which Claude Code hooks do not honour. Cursor's: the five tool-call
// events Stigmer runs, a matcher that is "*" or a regular expression, and
// neither an `if` nor `args` nor `${user_config.*}`, which Cursor's format
// does not have. An omitted format is filled with
// Claude Code's, so an author writing a block by hand never names an enum;
// a Cursor block names its format.
//
//
// Pipeline position: before ValidateReferences, so malformed hooks are
// INVALID_ARGUMENT before any reference is judged; before the version
// hash, so the filled format is part of what is hashed.
// ---------------------------------------------------------------------------

export function newValidateHooksStep(): PipelineStep<AgentDesc> {
  return {
    name: "ValidateHooks",
    execute(ctx: RequestContext<AgentDesc>): void {
      let inlineBlocks = 0;
      for (const source of ctx.newState.spec?.hooks ?? []) {
        switch (source.source.case) {
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
