import { create } from "@bufbuild/protobuf";
import { AgentSchema, type Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ExecutionArtifactSchema,
  type ExecutionArtifact,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/artifact_pb";
import {
  ExecutionArtifactKind,
  ExecutionPhase,
  MessageType,
  ToolCallStatus,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  AgentExecutionListSchema,
  type AgentExecutionList,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import {
  AgentMessageSchema,
  ToolCallSchema,
  type AgentMessage,
  type ToolCall,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { AgentExecutionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import {
  AgentInstanceSchema,
  type AgentInstance,
} from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/api_pb";
import { AgentInstanceSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentinstance/v1/spec_pb";
import {
  EnvironmentSchema,
  type Environment,
} from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import {
  ApiKeySchema,
  ApiKeyStatusSchema,
  type ApiKey,
} from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { ApiKeySpecSchema } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/spec_pb";
import {
  ApiKeysSchema,
  type ApiKeys,
} from "@stigmer/protos/ai/stigmer/iam/apikey/v1/io_pb";
import {
  ApiResourceAuditSchema,
  ApiResourceAuditInfoSchema,
} from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";
import {
  McpServerSchema,
  type McpServer,
} from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { McpServerSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import {
  SessionSchema,
  type Session,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import {
  SessionListSchema,
  type SessionList,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/io_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { SkillSchema, type Skill } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { SkillSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import {
  SearchResponseSchema,
  SearchResultSchema,
  type SearchResponse,
  type SearchResult,
} from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

// ---------------------------------------------------------------------------
// Override interfaces — flat projections of commonly-customized fields
// ---------------------------------------------------------------------------

export interface SessionOverrides {
  readonly id?: string;
  readonly name?: string;
  readonly org?: string;
  readonly slug?: string;
  readonly subject?: string;
  readonly agentInstanceId?: string;
}

export interface AgentOverrides {
  readonly id?: string;
  readonly name?: string;
  readonly org?: string;
  readonly slug?: string;
  readonly description?: string;
  readonly instructions?: string;
}

export interface AgentExecutionOverrides {
  readonly id?: string;
  readonly sessionId?: string;
  readonly agentId?: string;
  readonly phase?: ExecutionPhase;
  readonly messages?: AgentMessage[];
  readonly artifacts?: ExecutionArtifact[];
}

export interface SkillOverrides {
  readonly id?: string;
  readonly name?: string;
  readonly org?: string;
  readonly slug?: string;
  readonly description?: string;
  readonly skillMd?: string;
}

export interface McpServerOverrides {
  readonly id?: string;
  readonly name?: string;
  readonly org?: string;
  readonly slug?: string;
  readonly description?: string;
}

export interface EnvironmentOverrides {
  readonly id?: string;
  readonly name?: string;
  readonly org?: string;
  readonly slug?: string;
}

export interface AgentInstanceOverrides {
  readonly id?: string;
  readonly name?: string;
  readonly org?: string;
  readonly slug?: string;
  readonly agentId?: string;
}

export interface ApiKeyOverrides {
  readonly id?: string;
  readonly name?: string;
  readonly slug?: string;
  readonly fingerprint?: string;
  readonly neverExpires?: boolean;
  readonly keyHash?: string;
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
// Resource factories
// ---------------------------------------------------------------------------

/**
 * Sample data factories for building demo fixtures.
 *
 * Each factory returns a realistic protobuf object with sensible defaults.
 * Pass an overrides object to customize the most commonly-needed fields.
 * For deeper customization, modify the returned object directly — protobuf
 * messages from `create()` are mutable plain objects.
 *
 * @example
 * ```ts
 * import { samples, fixtures, buildScenario } from "@stigmer/react/demo";
 *
 * const scenario = buildScenario(
 *   fixtures.session.get(() => samples.session({ subject: "My topic" })),
 *   fixtures.agent.getByReference(() => samples.agent({ name: "My Agent" })),
 * );
 * ```
 */
export const samples = {
  /**
   * A session resource with metadata and spec.
   * Default: `demo-session` in org `demo` with subject "Demo conversation".
   */
  session(o?: SessionOverrides): Session {
    return create(SessionSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Session",
      metadata: create(ApiResourceMetadataSchema, {
        id: o?.id ?? "ses-00000000-0000-0000-0000-000000000001",
        name: o?.name ?? "demo-session",
        slug: o?.slug ?? o?.name ?? "demo-session",
        org: o?.org ?? "demo",
      }),
      spec: create(SessionSpecSchema, {
        subject: o?.subject ?? "Demo conversation",
        agentInstanceId:
          o?.agentInstanceId ?? "ain-00000000-0000-0000-0000-000000000001",
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
        id: o?.id ?? "agt-00000000-0000-0000-0000-000000000001",
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
   * An agent execution with status, messages, and optional artifacts.
   * Default: completed execution with a short human/AI exchange.
   */
  agentExecution(o?: AgentExecutionOverrides): AgentExecution {
    const msgs =
      o?.messages ?? [
        samples.humanMessage("Hello! Can you help me get started?"),
        samples.aiMessage(
          "Of course! I'd be happy to help you get started. What would you like to work on?",
        ),
      ];

    return create(AgentExecutionSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "AgentExecution",
      metadata: create(ApiResourceMetadataSchema, {
        id: o?.id ?? "aex-00000000-0000-0000-0000-000000000001",
        name: "demo-execution",
        slug: "demo-execution",
        org: "demo",
      }),
      spec: create(AgentExecutionSpecSchema, {
        sessionId: o?.sessionId ?? "ses-00000000-0000-0000-0000-000000000001",
        agentId: o?.agentId ?? "agt-00000000-0000-0000-0000-000000000001",
        message: msgs[0]?.content ?? "",
      }),
      status: create(AgentExecutionStatusSchema, {
        phase: o?.phase ?? ExecutionPhase.EXECUTION_COMPLETED,
        messages: msgs,
        artifacts: o?.artifacts ?? [],
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
        id: o?.id ?? "skl-00000000-0000-0000-0000-000000000001",
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
   * An MCP server resource.
   * Default: `Demo MCP Server` in org `demo`.
   */
  mcpServer(o?: McpServerOverrides): McpServer {
    return create(McpServerSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "McpServer",
      metadata: create(ApiResourceMetadataSchema, {
        id: o?.id ?? "mcp-00000000-0000-0000-0000-000000000001",
        name: o?.name ?? "Demo MCP Server",
        slug:
          o?.slug ?? o?.name?.toLowerCase().replace(/\s+/g, "-") ?? "demo-mcp-server",
        org: o?.org ?? "demo",
      }),
      spec: create(McpServerSpecSchema, {
        description:
          o?.description ?? "A sample MCP server for demo purposes.",
      }),
    });
  },

  /**
   * An environment resource.
   * Default: `demo-env` in org `demo`.
   */
  environment(o?: EnvironmentOverrides): Environment {
    return create(EnvironmentSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Environment",
      metadata: create(ApiResourceMetadataSchema, {
        id: o?.id ?? "env-00000000-0000-0000-0000-000000000001",
        name: o?.name ?? "demo-env",
        slug: o?.slug ?? o?.name ?? "demo-env",
        org: o?.org ?? "demo",
      }),
    });
  },

  /**
   * An agent instance resource.
   * Default: `demo-instance` in org `demo` referencing the default demo agent.
   */
  agentInstance(o?: AgentInstanceOverrides): AgentInstance {
    return create(AgentInstanceSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "AgentInstance",
      metadata: create(ApiResourceMetadataSchema, {
        id: o?.id ?? "ain-00000000-0000-0000-0000-000000000001",
        name: o?.name ?? "demo-instance",
        slug: o?.slug ?? o?.name ?? "demo-instance",
        org: o?.org ?? "demo",
      }),
      spec: create(AgentInstanceSpecSchema, {
        agentId: o?.agentId ?? "agt-00000000-0000-0000-0000-000000000001",
      }),
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
        id: o?.id ?? "apk-00000000-0000-0000-0000-000000000001",
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
            createdAt: { seconds: BigInt(Math.floor(Date.now() / 1000)), nanos: 0 },
          }),
        }),
      }),
    });
  },

  // ---- Message & artifact primitives ----

  /** A human (user) message. */
  humanMessage(content: string): AgentMessage {
    return create(AgentMessageSchema, {
      type: MessageType.MESSAGE_HUMAN,
      content,
      timestamp: new Date().toISOString(),
    });
  },

  /** An AI (assistant) message, optionally with tool calls. */
  aiMessage(content: string, toolCalls?: ToolCall[]): AgentMessage {
    return create(AgentMessageSchema, {
      type: MessageType.MESSAGE_AI,
      content,
      timestamp: new Date().toISOString(),
      toolCalls: toolCalls ?? [],
    });
  },

  /** A completed tool call with a result. */
  toolCall(name: string, result: string): ToolCall {
    return create(ToolCallSchema, {
      id: `tc-${name}-${Date.now()}`,
      name,
      result,
      status: ToolCallStatus.TOOL_CALL_COMPLETED,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    });
  },

  /** A file artifact produced by an execution. */
  artifact(name: string, kind?: ExecutionArtifactKind): ExecutionArtifact {
    return create(ExecutionArtifactSchema, {
      name,
      kind: kind ?? ExecutionArtifactKind.FILE,
      storageKey: `demo-artifact-${name}`,
      createdAt: new Date().toISOString(),
    });
  },

  // ---- List response factories ----

  /** A session list response. Defaults to one demo session. */
  sessionList(entries?: Session[]): SessionList {
    const items = entries ?? [samples.session()];
    return create(SessionListSchema, {
      entries: items,
      totalPages: 1,
    });
  },

  /** An agent execution list response. Defaults to one demo execution. */
  agentExecutionList(entries?: AgentExecution[]): AgentExecutionList {
    const items = entries ?? [samples.agentExecution()];
    return create(AgentExecutionListSchema, {
      entries: items,
      totalPages: 1,
    });
  },

  /**
   * A search response for list hooks (`useAgentList`, `useSkillList`, etc.).
   * Defaults to one search result matching the specified kind.
   */
  searchResponse(
    entries?: SearchResult[],
    totalCount?: number,
  ): SearchResponse {
    const items = entries ?? [samples.searchResult()];
    return create(SearchResponseSchema, {
      entries: items,
      totalCount: totalCount ?? items.length,
      totalPages: 1,
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
      id: o?.id ?? "agt-00000000-0000-0000-0000-000000000001",
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
