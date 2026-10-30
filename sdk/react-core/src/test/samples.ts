import { create, type JsonObject, type MessageInitShape } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { foldSession, type SessionFold, type ToolUse, type Turn, type TurnPhase } from "@stigmer/client";
import { AgentSchema, type Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/spec_pb";
import {
  RunSchema,
  RunStatusSchema,
  type Run,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { FileSchema, type File as StigmerFile } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import {
  RunListSchema,
  type RunList,
} from "@stigmer/apis/ai/stigmer/agentic/run/v1/io_pb";
import { RunSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/spec_pb";
import {
  VaultSchema,
  type Vault,
} from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import {
  ApiKeySchema,
  ApiKeyStatusSchema,
  type ApiKey,
} from "@stigmer/apis/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiKeySpecSchema } from "@stigmer/apis/ai/stigmer/iam/apikey/v1/spec_pb";
import {
  ApiKeysSchema,
  type ApiKeys,
} from "@stigmer/apis/ai/stigmer/iam/apikey/v1/io_pb";
import {
  ApiResourceAuditSchema,
  ApiResourceAuditInfoSchema,
} from "@stigmer/apis/ai/stigmer/commons/apiresource/status_pb";
import { PluginSchema, type Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/spec_pb";
import {
  McpServerEntrySchema,
  McpServerSignInSchema,
  PluginStatusSchema,
} from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/status_pb";
import {
  SessionSchema,
  type Session,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import {
  SessionEventListSchema,
  SessionListSchema,
  StreamSessionEventsResponseSchema,
  type SessionEventList,
  type SessionList,
  type StreamSessionEventsResponse,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import {
  SessionEventSchema,
  type SessionEvent,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { SessionSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";
import { SkillSchema, type Skill } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/spec_pb";
import {
  OrganizationSchema,
  type Organization,
} from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import {
  OrganizationsSchema,
  type Organizations,
} from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/io_pb";
import { OrganizationSpecSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/metadata_pb";
import {
  SearchResponseSchema,
  SearchResultSchema,
  type SearchResponse,
  type SearchResult,
} from "@stigmer/apis/ai/stigmer/search/v1/io_pb";

// ---------------------------------------------------------------------------
// The frozen instant
// ---------------------------------------------------------------------------

/**
 * The frozen instant every timestamped `samples.*` factory defaults to — the
 * samples' single clock. Anything that needs an instant derives from this one
 * via {@link sampleInstant} / {@link sampleDate}; nothing authors a second
 * instant of its own.
 *
 * These factories must never read the live clock. A `samples.*` value is
 * rendered into tests and stories that must give the same result on every
 * run; a clock read paints a pixel that changes between runs, which breaks the
 * "same source, same result" guarantee.
 *
 * The date is `2026-07-20`, the samples' day. The time is 11:00 UTC,
 * chosen by the *reader offset window*: components format dates in the
 * reader's local time (e.g. `ApiKeyListPanel` via `toLocaleDateString`), and
 * real UTC offsets span −11:00 (Midway) to +14:00 (Kiritimati) — a 25-hour
 * range against a 24-hour day, so **no instant renders one calendar date
 * everywhere**. The supported window is UTC−11:00 through UTC+12:45 — every
 * inhabited zone except Tongatapu (+13, ~100k) and Kiritimati (+14, ~6k).
 * 11:00Z holds `Jul 20` across that whole window; the previous noon anchor
 * flipped to `Jul 21` at UTC+12:45 and beyond (Auckland, Fiji, Chatham).
 * Instants whose calendar *date* is rendered must stay inside the window's
 * stable band, 11:00:00Z–11:14:59Z — the anchor sits at its start so all
 * derivation headroom points forward. Duration deltas (end minus start) are
 * zone-invariant and may leave the band freely.
 *
 * The window stabilises the rendered *date*, not the rendered *string*:
 * locale-unpinned formatters still vary the format per reader ("Jul 20, 2026"
 * vs "20 Jul 2026"), and a component that renders a *time of day* is
 * zone-dependent no matter which instant is chosen. The property test in
 * `__tests__/samples.test.ts` locks the date-stability claim at both window
 * boundaries.
 */
export const SAMPLE_INSTANT = "2026-07-20T11:00:00.000Z";

/** {@link SAMPLE_INSTANT} in epoch milliseconds, the base all derivation uses. */
const SAMPLE_INSTANT_MS = Date.parse(SAMPLE_INSTANT);

/**
 * An ISO-8601 instant `deltaMs` after {@link SAMPLE_INSTANT} — the way a
 * fixture expresses "2.4 seconds later" or "a day earlier" without authoring
 * a second instant. `sampleInstant()` with no argument is the anchor itself.
 *
 * Prefer this over a hand-written literal even for values that never render:
 * derivation keeps the whole fixture world moving together if the samples' day
 * is ever refreshed.
 */
export function sampleInstant(deltaMs = 0): string {
  return new Date(SAMPLE_INSTANT_MS + deltaMs).toISOString();
}

/**
 * {@link sampleInstant} as a `Date`, for APIs that take one (e.g. protobuf's
 * `timestampFromDate`). Same instant, same derivation rule.
 */
export function sampleDate(deltaMs = 0): Date {
  return new Date(SAMPLE_INSTANT_MS + deltaMs);
}

/**
 * When a default tool use returns ({@link samples.toolResultEvent}):
 * {@link SAMPLE_INSTANT} plus 1.2s, so the rendered duration chip reads a
 * stable "1.2s" — long enough to never collapse to the "0ms" that two
 * adjacent live clock reads can produce.
 */
const SAMPLE_TOOL_RESULT_AT = sampleInstant(1_200);

/** The demo run every event builder files its event under by default. */
const SAMPLE_RUN_ID = "run_00000000000000000000000001";

/** The demo session the demo run belongs to. */
const SAMPLE_SESSION_ID = "ses_00000000000000000000000001";

// ---------------------------------------------------------------------------
// Override interfaces — flat projections of commonly-customized fields
// ---------------------------------------------------------------------------

export interface SessionOverrides {
  readonly id?: string;
  readonly name?: string;
  readonly org?: string;
  readonly slug?: string;
  readonly subject?: string;
  /** The agent the session names; `null` for the built-in assistant. Defaults to the demo agent. */
  readonly agentRef?: { readonly org: string; readonly slug: string } | null;
}

export interface AgentOverrides {
  readonly id?: string;
  readonly name?: string;
  readonly org?: string;
  readonly slug?: string;
  readonly description?: string;
  readonly instructions?: string;
}

export interface RunOverrides {
  readonly id?: string;
  readonly sessionId?: string;
  readonly agentId?: string;
  readonly phase?: RunPhase;
  /** The message the run (turn) was started with (`spec.message`). */
  readonly message?: string;
}

export interface OutputFileOverrides {
  /** The run (turn) that returned it. Defaults to the demo run. */
  readonly runId?: string;
  /** Where the agent saved it under the outputs folder. Defaults to the filename. */
  readonly outputPath?: string;
  readonly sizeBytes?: bigint;
  readonly mimeType?: string;
}

/** Where a session event is filed, shared by every event builder. */
export interface SessionEventOverrides {
  /** The run (turn) the event belongs to. Defaults to the demo run. */
  readonly runId?: string;
  /** The subagent thread that produced it; "" (the default) is the primary thread. */
  readonly threadId?: string;
  /**
   * The event's id, unique in its session. Each builder derives a stable
   * default from the run and its arguments; pass one for a second event of
   * the same shape in one run.
   */
  readonly id?: string;
  /** When it was appended. Defaults to {@link SAMPLE_INSTANT}. */
  readonly processedAt?: string;
}

/** A tool use's event: its MCP server and permission, beside the common overrides. */
export interface ToolUseEventOverrides extends SessionEventOverrides {
  /** The MCP server the tool belongs to; "" (the default) for a built-in tool. */
  readonly mcpServerName?: string;
  /** `ask` when the call waits for a person; "" (the default) when it runs. */
  readonly evaluatedPermission?: string;
}

/** A tool result's event: whether the result is an error. */
export interface ToolResultEventOverrides extends SessionEventOverrides {
  readonly isError?: boolean;
  /** Pair it with an MCP tool use (`agent.mcp_tool_result`). */
  readonly mcp?: boolean;
}

/** Why a call waits: the ask's message, preview and the rule that asked. */
export interface PermissionAskedOverrides extends SessionEventOverrides {
  readonly message?: string;
  /** The sanitized JSON preview of the call's input. */
  readonly argsPreview?: string;
  /** The rule that asked, as one word (`builtin_category`, `hook`, ...). */
  readonly policySource?: string;
  readonly policyHook?: string;
}

/** A turn's `stigmer.run.status`: its stop cause and error. */
export interface RunStatusEventOverrides extends SessionEventOverrides {
  readonly stopCause?: string;
  readonly error?: string;
}

/** One tool call of a {@link samples.turnEvents} turn: its use and, when it returned, its result. */
export interface TurnToolOverrides {
  readonly name: string;
  readonly input?: JsonObject;
  /** The result's text; omit for a call that has not returned. */
  readonly result?: string;
  readonly isError?: boolean;
  readonly mcpServerName?: string;
}

/** A whole turn for {@link samples.turnEvents}: its message, tools, reply and phase. */
export interface TurnOverrides {
  readonly runId?: string;
  /** The person's message. Defaults to a short greeting. */
  readonly message?: string;
  /** The tool calls the agent made, in order, before its reply. */
  readonly tools?: readonly TurnToolOverrides[];
  /** The agent's reply; omit or "" for none. Defaults to a short answer. */
  readonly reply?: string;
  /** The turn's phase (`stigmer.run.status`). Defaults to `completed`. */
  readonly phase?: TurnPhase;
}

export interface SkillOverrides {
  readonly id?: string;
  readonly name?: string;
  readonly org?: string;
  readonly slug?: string;
  readonly description?: string;
  readonly skillMd?: string;
}

export interface PluginOverrides {
  readonly id?: string;
  readonly name?: string;
  readonly org?: string;
  readonly slug?: string;
  readonly description?: string;
  /** The URL of the plugin's one MCP server, which signs in. */
  readonly serverUrl?: string;
}

export interface VaultOverrides {
  readonly id?: string;
  readonly name?: string;
  readonly org?: string;
  readonly slug?: string;
}

export interface ApiKeyOverrides {
  readonly id?: string;
  readonly name?: string;
  readonly slug?: string;
  readonly fingerprint?: string;
  readonly neverExpires?: boolean;
  readonly keyHash?: string;
  /** Frozen ISO-8601 instant for the key's `createdAt`. Defaults to {@link SAMPLE_INSTANT}. */
  readonly createdAt?: string;
}

export interface OrganizationOverrides {
  readonly id?: string;
  readonly name?: string;
  readonly slug?: string;
}

export interface SearchResultOverrides {
  readonly id?: string;
  readonly name?: string;
  readonly org?: string;
  readonly slug?: string;
  readonly kind?: ApiResourceKind;
  readonly description?: string;
  readonly iconUrl?: string;
}

// ---------------------------------------------------------------------------
// Session-event helpers
// ---------------------------------------------------------------------------

/** The demo turn's message and the agent's answer to it. */
const SAMPLE_USER_MESSAGE = "Hello! Can you help me get started?";
const SAMPLE_REPLY =
  "Of course! I'd be happy to help you get started. What would you like to work on?";

type SessionEventInit = MessageInitShape<typeof SessionEventSchema>["event"];

/** A stored event of the demo session, filed under its run and thread. */
function sessionEvent(o: SessionEventOverrides | undefined, event: SessionEventInit): SessionEvent {
  return create(SessionEventSchema, {
    sessionId: SAMPLE_SESSION_ID,
    runId: o?.runId ?? SAMPLE_RUN_ID,
    threadId: o?.threadId ?? "",
    event,
  });
}

/** A text content block list, as messages carry text. */
function textContent(text: string): { type: string; text: string }[] {
  return text === "" ? [] : [{ type: "text", text }];
}

/** An event's append time: the override, or the frozen instant. */
function at(o: SessionEventOverrides | undefined): string {
  return o?.processedAt ?? SAMPLE_INSTANT;
}

/** The events with their log places (`seq`) numbered 1.. in order. */
function numbered(events: readonly SessionEvent[]): SessionEvent[] {
  return events.map((event, index) => ({ ...event, seq: BigInt(index + 1) }));
}

// ---------------------------------------------------------------------------
// Resource factories
// ---------------------------------------------------------------------------

/**
 * Sample data factories for building demo fixtures.
 *
 * Each factory returns a realistic protobuf object with sensible defaults.
 * Pass an overrides object to customize the most commonly-needed fields.
 *
 * Every timestamp is frozen at {@link SAMPLE_INSTANT} — these factories never
 * read the live clock, so a fixture renders identical pixels on every browser
 * replay and every video-export frame. Do not reintroduce `Date.now()` or
 * `new Date()` here.
 *
 * For a value the overrides do not cover, modify the returned object
 * directly rather than growing the override surface: protobuf messages from
 * `create()` are mutable plain objects. Timestamps derive from the anchor via {@link sampleInstant} rather
 * than a hand-written literal, so the fixture world keeps a single clock.
 *
 * @example
 * ```ts
 * import { samples, sampleInstant } from "@stigmer/react-core/test";
 *
 * const scenario = buildScenario(
 *   fixtures.session.get(() => samples.session({ subject: "My topic" })),
 *   fixtures.agent.getByReference(() => samples.agent({ name: "My Agent" })),
 * );
 *
 * // Deeper customization — derive "5 seconds later" from the anchor:
 * const later = samples.agentMessageEvent("later", { processedAt: sampleInstant(5_000) });
 * ```
 */
export const samples = {
  /**
   * A session resource with metadata and spec.
   * Default: `demo-session` in org `demo` with subject "Demo conversation".
   */
  session(o?: SessionOverrides): Session {
    const sessionAgentRef =
      o?.agentRef === undefined ? { org: "demo", slug: "demo-agent" } : o.agentRef;
    return create(SessionSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Session",
      metadata: create(ApiResourceMetadataSchema, {
        id: o?.id ?? "ses_00000000000000000000000001",
        name: o?.name ?? "demo-session",
        slug: o?.slug ?? o?.name ?? "demo-session",
        org: o?.org ?? "demo",
      }),
      spec: create(SessionSpecSchema, {
        subject: o?.subject ?? "Demo conversation",
        ...(sessionAgentRef !== null && {
          agentRef: { ...sessionAgentRef, kind: ApiResourceKind.agent },
        }),
      }),
    });
  },

  /**
   * An agent blueprint with metadata and spec.
   * Default: `Demo Agent` in org `demo`.
   */
  agent(o?: AgentOverrides): Agent {
    return create(AgentSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: create(ApiResourceMetadataSchema, {
        id: o?.id ?? "agt_00000000000000000000000001",
        name: o?.name ?? "Demo Agent",
        slug: o?.slug ?? o?.name?.toLowerCase().replace(/\s+/g, "-") ?? "demo-agent",
        org: o?.org ?? "demo",
      }),
      spec: create(AgentSpecSchema, {
        description: o?.description ?? "A sample agent for demo and documentation purposes.",
        instructions:
          o?.instructions ??
          "You are a helpful assistant. Answer questions clearly and concisely.",
      }),
    });
  },

  /**
   * A run: one turn's lifecycle record (its spec and phase).
   * What the agent did in the turn is the session's events — see
   * {@link samples.turnEvents}.
   * Default: a completed run started with a short greeting.
   */
  run(o?: RunOverrides): Run {
    return create(RunSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Run",
      metadata: create(ApiResourceMetadataSchema, {
        id: o?.id ?? SAMPLE_RUN_ID,
        name: "demo-execution",
        slug: "demo-execution",
        org: "demo",
      }),
      spec: create(RunSpecSchema, {
        target: {
          case: "sessionId",
          value: o?.sessionId ?? SAMPLE_SESSION_ID,
        },
        message: o?.message ?? SAMPLE_USER_MESSAGE,
      }),
      status: create(RunStatusSchema, {
        agentId: o?.agentId ?? "agt_00000000000000000000000001",
        phase: o?.phase ?? RunPhase.RUN_COMPLETED,
      }),
    });
  },

  /**
   * A skill resource with SKILL.md content.
   * Default: `Demo Skill` in org `demo`.
   */
  skill(o?: SkillOverrides): Skill {
    return create(SkillSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Skill",
      metadata: create(ApiResourceMetadataSchema, {
        id: o?.id ?? "skl_00000000000000000000000001",
        name: o?.name ?? "Demo Skill",
        slug: o?.slug ?? o?.name?.toLowerCase().replace(/\s+/g, "-") ?? "demo-skill",
        org: o?.org ?? "demo",
      }),
      spec: create(SkillSpecSchema, {
        description: o?.description ?? "A sample skill for demo purposes.",
        skillMd:
          o?.skillMd ??
          "# Demo Skill\n\nThis skill provides sample domain knowledge for demonstrations.",
      }),
    });
  },

  /**
   * An installed plugin holding one MCP server at an address, which signs
   * in. Default: `demo-plugin` in org `demo`, its server named after it.
   */
  plugin(o?: PluginOverrides): Plugin {
    const name = o?.name ?? "demo-plugin";
    return create(PluginSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Plugin",
      metadata: create(ApiResourceMetadataSchema, {
        id: o?.id ?? "plg_00000000000000000000000001",
        name,
        slug: o?.slug ?? name,
        org: o?.org ?? "demo",
      }),
      spec: create(PluginSpecSchema, {
        description: o?.description ?? "A sample plugin for demo purposes.",
      }),
      status: create(PluginStatusSchema, {
        mcpServers: [
          create(McpServerEntrySchema, {
            name,
            transport: { case: "http", value: { url: o?.serverUrl ?? "https://mcp.example.com/mcp" } },
            signIn: create(McpServerSignInSchema, {}),
          }),
        ],
      }),
    });
  },

  /**
   * A shared vault resource, values blanked as every read is.
   * Default: `demo-vault` in org `demo`.
   */
  vault(o?: VaultOverrides): Vault {
    return create(VaultSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Vault",
      metadata: create(ApiResourceMetadataSchema, {
        id: o?.id ?? "vlt_00000000000000000000000001",
        name: o?.name ?? "demo-vault",
        slug: o?.slug ?? o?.name ?? "demo-vault",
        org: o?.org ?? "demo",
      }),
      spec: { owner: { case: "org", value: o?.org ?? "demo" } },
    });
  },

  /**
   * An API key resource with metadata, spec, and status.
   * Default: `demo-api-key` with fingerprint `Ab1c2D` and no expiry.
   */
  apiKey(o?: ApiKeyOverrides): ApiKey {
    return create(ApiKeySchema, {
      apiVersion: "iam.stigmer.ai/v1",
      kind: "ApiKey",
      metadata: create(ApiResourceMetadataSchema, {
        id: o?.id ?? "key_00000000000000000000000001",
        name: o?.name ?? "demo-api-key",
        slug: o?.slug ?? o?.name?.toLowerCase().replace(/\s+/g, "-") ?? "demo-api-key",
      }),
      spec: create(ApiKeySpecSchema, {
        fingerprint: o?.fingerprint ?? "Ab1c2D",
        neverExpires: o?.neverExpires ?? true,
        keyHash: o?.keyHash ?? "",
      }),
      status: create(ApiKeyStatusSchema, {
        audit: create(ApiResourceAuditSchema, {
          specAudit: create(ApiResourceAuditInfoSchema, {
            createdAt: timestampFromDate(new Date(o?.createdAt ?? SAMPLE_INSTANT)),
          }),
        }),
      }),
    });
  },

  /**
   * An organization resource with metadata and spec.
   * Default: team org `Acme Corp` (slug `acme`), the samples' organization.
   */
  organization(o?: OrganizationOverrides): Organization {
    return create(OrganizationSchema, {
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: create(ApiResourceMetadataSchema, {
        id: o?.id ?? "org_00000000000000000000000001",
        name: o?.name ?? "Acme Corp",
        slug: o?.slug ?? "acme",
      }),
      spec: create(OrganizationSpecSchema, {}),
    });
  },

  /**
   * An `Organizations` response for `listMine` — what
   * `OrgProvider` fetches to drive the org switcher.
   * Default: a single {@link samples.organization}.
   */
  organizationList(entries?: Organization[]): Organizations {
    return create(OrganizationsSchema, {
      entries: entries ?? [samples.organization()],
    });
  },

  // ---- Session events: a conversation as its event log holds it ----

  /** The person's message that starts a turn (`user.message`). Id: `<run>.user`. */
  userMessageEvent(text: string, o?: SessionEventOverrides): SessionEvent {
    const runId = o?.runId ?? SAMPLE_RUN_ID;
    return sessionEvent(o, {
      case: "userMessage",
      value: { id: o?.id ?? `${runId}.user`, content: textContent(text), processedAt: at(o) },
    });
  },

  /** A message the agent wrote (`agent.message`). Id: `<run>.root.m0`. */
  agentMessageEvent(text: string, o?: SessionEventOverrides): SessionEvent {
    const runId = o?.runId ?? SAMPLE_RUN_ID;
    return sessionEvent(o, {
      case: "agentMessage",
      value: { id: o?.id ?? `${runId}.root.m0`, content: textContent(text), processedAt: at(o) },
    });
  },

  /**
   * The agent's thinking: its `agent.thinking` and the
   * `stigmer.agent.thinking` that carries its text. Id: `<run>.root.t0`.
   */
  thinkingEvents(text: string, o?: SessionEventOverrides): SessionEvent[] {
    const runId = o?.runId ?? SAMPLE_RUN_ID;
    const id = o?.id ?? `${runId}.root.t0`;
    return [
      sessionEvent(o, { case: "agentThinking", value: { id, processedAt: at(o) } }),
      sessionEvent(o, {
        case: "stigmerAgentThinking",
        value: { id: `${id}.text`, thinkingId: id, text, processedAt: at(o) },
      }),
    ];
  },

  /**
   * A tool call (`agent.tool_use`, or `agent.mcp_tool_use` with an MCP
   * server). Id: `<run>.tc-<name>`, stable across runs; a second call of
   * the same name in one run needs its own `id`.
   */
  toolUseEvent(name: string, input: JsonObject = {}, o?: ToolUseEventOverrides): SessionEvent {
    const runId = o?.runId ?? SAMPLE_RUN_ID;
    const id = o?.id ?? `${runId}.tc-${name}`;
    const common = {
      id,
      name,
      input,
      evaluatedPermission: o?.evaluatedPermission ?? "",
      sessionThreadId: o?.threadId ?? "",
      processedAt: at(o),
    };
    return o?.mcpServerName
      ? sessionEvent(o, { case: "agentMcpToolUse", value: { ...common, mcpServerName: o.mcpServerName } })
      : sessionEvent(o, { case: "agentToolUse", value: common });
  },

  /**
   * A tool call's result (`agent.tool_result`, or `agent.mcp_tool_result`),
   * 1.2s after {@link SAMPLE_INSTANT} so the call's duration chip reads a
   * stable "1.2s". Id: `<tool use>.r`.
   */
  toolResultEvent(toolUseId: string, text: string, o?: ToolResultEventOverrides): SessionEvent {
    const value = {
      id: o?.id ?? `${toolUseId}.r`,
      content: textContent(text),
      isError: o?.isError ?? false,
      processedAt: o?.processedAt ?? SAMPLE_TOOL_RESULT_AT,
    };
    return o?.mcp
      ? sessionEvent(o, { case: "agentMcpToolResult", value: { ...value, mcpToolUseId: toolUseId } })
      : sessionEvent(o, { case: "agentToolResult", value: { ...value, toolUseId } });
  },

  /** Why a tool call waits for a person (`stigmer.permission.asked`). Id: `<tool use>.ask`. */
  permissionAskedEvent(toolUseId: string, o?: PermissionAskedOverrides): SessionEvent {
    return sessionEvent(o, {
      case: "stigmerPermissionAsked",
      value: {
        id: o?.id ?? `${toolUseId}.ask`,
        toolUseId,
        message: o?.message ?? "",
        argsPreview: o?.argsPreview ?? "",
        policySource: o?.policySource ?? "builtin_category",
        policyHook: o?.policyHook ?? "",
        processedAt: at(o),
      },
    });
  },

  /** A turn's phase (`stigmer.run.status`). Id: `<run>.status.<phase>`. */
  runStatusEvent(phase: TurnPhase, o?: RunStatusEventOverrides): SessionEvent {
    const runId = o?.runId ?? SAMPLE_RUN_ID;
    return sessionEvent(o, {
      case: "stigmerRunStatus",
      value: {
        id: o?.id ?? `${runId}.status.${phase}`,
        phase,
        stopCause: o?.stopCause ?? "",
        error: o?.error ?? "",
        processedAt: at(o),
      },
    });
  },

  /**
   * A whole turn's events, in log order: the person's message, the status
   * the turn starts with, each tool call's use and result, the reply, and
   * the turn's phase. Default: a completed greeting and its answer.
   */
  turnEvents(o?: TurnOverrides): SessionEvent[] {
    const runId = o?.runId ?? SAMPLE_RUN_ID;
    const phase = o?.phase ?? "completed";
    const events: SessionEvent[] = [
      samples.userMessageEvent(o?.message ?? SAMPLE_USER_MESSAGE, { runId }),
      samples.runStatusEvent("running", { runId }),
    ];
    for (const tool of o?.tools ?? []) {
      const use = samples.toolUseEvent(tool.name, tool.input, {
        runId,
        ...(tool.mcpServerName === undefined ? {} : { mcpServerName: tool.mcpServerName }),
      });
      events.push(use);
      if (tool.result !== undefined) {
        events.push(
          samples.toolResultEvent(use.event.value!.id, tool.result, {
            runId,
            isError: tool.isError ?? false,
            mcp: tool.mcpServerName !== undefined,
          }),
        );
      }
    }
    const reply = o?.reply ?? SAMPLE_REPLY;
    if (reply !== "") events.push(samples.agentMessageEvent(reply, { runId }));
    if (phase !== "running") events.push(samples.runStatusEvent(phase, { runId }));
    return events;
  },

  /** A session's events folded (`foldSession`), numbered in order. */
  fold(events: readonly SessionEvent[]): SessionFold {
    return foldSession(numbered(events));
  },

  /** One turn, folded: {@link samples.turnEvents} as the conversation hooks hold it. */
  turn(o?: TurnOverrides): Turn {
    return samples.fold(samples.turnEvents(o)).turns[0]!;
  },

  /**
   * A folded tool use that returned `result` (or still runs, when `result`
   * is omitted), spanning {@link SAMPLE_INSTANT} to 1.2s later so its
   * duration chip reads a stable "1.2s". Id: `<run>.tc-<name>`.
   */
  toolUse(name: string, result?: string, o?: ToolUseEventOverrides & { readonly input?: JsonObject; readonly isError?: boolean }): ToolUse {
    const use = samples.toolUseEvent(name, o?.input, o);
    const events = [use];
    if (result !== undefined) {
      events.push(
        samples.toolResultEvent(use.event.value!.id, result, {
          runId: o?.runId,
          isError: o?.isError ?? false,
          mcp: Boolean(o?.mcpServerName),
        }),
      );
    }
    return samples.fold(events).turns[0]!.items.find((item): item is ToolUse => item.kind === "tool_use")!;
  },

  /** A session event list response (`listEvents`), its events numbered in order. */
  sessionEventList(events: readonly SessionEvent[]): SessionEventList {
    return create(SessionEventListSchema, { events: numbered(events) });
  },

  /** A stream frame carrying one stored event (`streamEvents`). */
  eventFrame(event: SessionEvent): StreamSessionEventsResponse {
    return create(StreamSessionEventsResponseSchema, { frame: { case: "event", value: event } });
  },

  /**
   * A File a run returned (what the agent saved in its outputs folder), in
   * the demo session. The id derives from the run and output path, so two
   * calls with the same arguments build the same File.
   */
  outputFile(filename: string, o?: OutputFileOverrides): StigmerFile {
    const runId = o?.runId ?? SAMPLE_RUN_ID;
    const outputPath = o?.outputPath ?? filename;
    return create(FileSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "File",
      metadata: {
        id: `file_${runId}_${outputPath.replace(/[^A-Za-z0-9]/g, "_")}`,
        org: "demo",
        name: filename,
      },
      spec: { filename, mimeType: o?.mimeType ?? "" },
      status: {
        sizeBytes: o?.sizeBytes ?? 0n,
        sessionId: SAMPLE_SESSION_ID,
        runId,
        outputPath,
      },
    });
  },

  // ---- List response factories ----

  /** A session list response. Defaults to one demo session. */
  sessionList(entries?: Session[]): SessionList {
    const items = entries ?? [samples.session()];
    return create(SessionListSchema, { entries: items });
  },

  /** A run list response. Defaults to one demo run. */
  runList(entries?: Run[]): RunList {
    const items = entries ?? [samples.run()];
    return create(RunListSchema, { entries: items });
  },

  /**
   * A search response for search-backed hooks (`useAgentSearch`, the
   * Library's count cards). Defaults to one search result; the per-kind
   * counts default to the entries' own kinds, and no page follows.
   */
  searchResponse(
    entries?: SearchResult[],
    options?: {
      readonly countsByKind?: Readonly<Record<string, number>>;
      readonly nextPageToken?: string;
    },
  ): SearchResponse {
    const items = entries ?? [samples.searchResult()];
    const countsByKind: Record<string, number> = {};
    for (const item of items) {
      const kind = ApiResourceKind[item.kind] ?? String(item.kind);
      countsByKind[kind] = (countsByKind[kind] ?? 0) + 1;
    }
    return create(SearchResponseSchema, {
      entries: items,
      countsByKind: options?.countsByKind ?? countsByKind,
      nextPageToken: options?.nextPageToken ?? "",
    });
  },

  /** An API key list response. Defaults to one demo API key. */
  apiKeyList(entries?: ApiKey[]): ApiKeys {
    const items = entries ?? [samples.apiKey()];
    return create(ApiKeysSchema, { entries: items });
  },

  /** A single search result entry. */
  searchResult(o?: SearchResultOverrides): SearchResult {
    return create(SearchResultSchema, {
      kind: o?.kind ?? ApiResourceKind.agent,
      id: o?.id ?? "agt_00000000000000000000000001",
      name: o?.name ?? "Demo Agent",
      slug: o?.slug ?? "demo-agent",
      qualifiedSlug: `${o?.org ?? "demo"}/${o?.slug ?? "demo-agent"}`,
      org: o?.org ?? "demo",
      description: o?.description ?? "A sample resource for demo purposes.",
      score: 1.0,
      iconUrl: o?.iconUrl ?? "",
    });
  },
} as const;
