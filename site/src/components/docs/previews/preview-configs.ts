import type { ComponentType } from "react";
import {
  AgentDetailView,
  AgentEnvForm,
  AgentPicker,
  ApiKeyCreatedAlert,
  ApiKeyListPanel,
  ArtifactCard,
  ArtifactContentRenderer,
  ArtifactsWidget,
  AttachmentChipList,
  ApprovalCard,
  CloudFeatureNotice,
  CreateApiKeyForm,
  CreateEnvironmentForm,
  CreateOrganizationForm,
  EnvironmentListPanel,
  EnvironmentVariableEditor,
  EnvVarForm,
  ErrorMessage,
  ExecutionPhaseBadge,
  ExecutionProgress,
  FilePathLink,
  FollowUpInput,
  McpArgsView,
  McpMetadataRow,
  McpServerConfigPanel,
  McpServerDetailView,
  McpServerPicker,
  McpToolDetail,
  McpToolSelector,
  MessageEntry,
  MessageThread,
  ModelSelector,
  ResourceCountCard,
  ResourceListView,
  ScopeToggle,
  SecretFlowErrorGuide,
  SessionComposer,
  SessionVariablesInput,
  SetupProgress,
  SkillDetailView,
  SkillPicker,
  SubAgentSection,
  TodoInProgressIcon,
  TodoList,
  ToolArgsView,
  ToolCallDetail,
  ToolCallGroup,
  ToolCallItem,
  UsageWidget,
  VisibilityToggle,
  WorkspaceEditor,
  WorkspaceSummary,
  WriteBackCard,
  WriteBacksWidget,
} from "@stigmer/react";
import type { UseWorkspaceEntriesReturn, UseSessionVariablesReturn } from "@stigmer/react";
import { create } from "@bufbuild/protobuf";

import { EnvironmentListSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/io_pb";
import { EnvironmentSpecSchema, EnvironmentValueSchema, EnvVarDeclarationSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/spec_pb";
import { AgentSpecSchema, McpServerUsageSchema, SubAgentSchema, McpAccessSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { AgentStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/status_pb";
import { PendingApprovalSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import { SubAgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { TodoItemSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import { WorkspaceWriteBackSchema, WorkspaceWriteBackPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/writeback_pb";
import { LlmCallMetricsSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/usage_pb";
import { ExecutionPhase, TodoStatus, ToolCallStatus, SubAgentStatus, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { AgentMessageSchema, ToolCallSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { DiscoveredToolSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import { McpServerSpecSchema, ToolApprovalPolicySchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/spec_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceAuditSchema, ApiResourceAuditInfoSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/status_pb";

import { fixtures, samples, type FixtureSpec } from "@stigmer/react/demo";

// ---------------------------------------------------------------------------
// Config shape
// ---------------------------------------------------------------------------

export interface PreviewConfig {
  /** The SDK component to render. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- heterogeneous component registry; type safety is per-config, not at the registry boundary
  readonly component: ComponentType<any>;
  /** Fixture specs passed to `buildScenario()` for the demo client. */
  readonly fixtures: FixtureSpec[];
  /** Props spread onto the component. */
  readonly props: Record<string, unknown>;
  /** Extra Tailwind classes applied to the preview container (e.g. max-width). */
  readonly previewClassName?: string;
}

// ---------------------------------------------------------------------------
// Shared helpers — reusable mock objects and data builders
// ---------------------------------------------------------------------------

const noop = () => {};

const MOCK_WORKSPACE: UseWorkspaceEntriesReturn = {
  entries: [],
  addGitRepo: noop,
  addLocalPath: noop,
  remove: noop,
  clear: noop,
  toInput: () => [],
  hasEntries: false,
};

const MOCK_SESSION_VARIABLES: UseSessionVariablesReturn = {
  entries: [
    { id: "sv-1", key: "API_URL", value: "https://api.example.com", isSecret: false, saveForFuture: false },
    { id: "sv-2", key: "API_TOKEN", value: "", isSecret: true, saveForFuture: true },
  ],
  addEntry: noop,
  removeEntry: noop,
  updateEntry: noop,
  clear: noop,
  isEmpty: false,
  hasValidEntries: true,
  toRuntimeEnv: () => ({}),
  toSaveForFutureEnv: () => ({}),
  hasSaveForFutureEntries: true,
};

function buildRichAgent() {
  const agent = samples.agent({
    name: "support-agent",
    org: "acme",
    description:
      "Handles customer support requests — answers questions using company knowledge, looks up orders, and processes returns with human approval.",
    instructions: [
      "You are a customer support agent for Acme Corp.",
      "",
      "Use the company knowledge base to answer product questions.",
      "When customers ask about orders, look up the order details",
      "using the available tools before responding.",
      "",
      "For returns and refunds, always ask for human approval",
      "before processing. Never process a refund without approval.",
    ].join("\n"),
  });

  agent.spec = create(AgentSpecSchema, {
    description: agent.spec!.description,
    instructions: agent.spec!.instructions,
    mcpServerUsages: [
      create(McpServerUsageSchema, {
        mcpServerRef: create(ApiResourceReferenceSchema, {
          kind: ApiResourceKind.mcp_server,
          slug: "order-management-api",
        }),
        enabledTools: ["get_order", "list_orders", "process_return"],
      }),
      create(McpServerUsageSchema, {
        mcpServerRef: create(ApiResourceReferenceSchema, {
          kind: ApiResourceKind.mcp_server,
          slug: "notification-service",
        }),
        enabledTools: ["send_email", "send_sms"],
      }),
    ],
    skillRefs: [
      create(ApiResourceReferenceSchema, {
        kind: ApiResourceKind.skill,
        slug: "company-knowledge-base",
      }),
      create(ApiResourceReferenceSchema, {
        kind: ApiResourceKind.skill,
        slug: "return-policy",
      }),
      create(ApiResourceReferenceSchema, {
        kind: ApiResourceKind.skill,
        slug: "product-catalog",
      }),
    ],
    subAgents: [
      create(SubAgentSchema, {
        name: "order-lookup",
        description: "Searches and retrieves order details from the order management system.",
        instructions: "Look up orders by ID or customer email. Return structured order details.",
        mcpAccess: [
          create(McpAccessSchema, {
            mcpServer: "order-management-api",
            enabledTools: ["get_order", "list_orders"],
          }),
        ],
      }),
    ],
    env: {
      ORDER_API_URL: create(EnvVarDeclarationSchema, {
        isSecret: false,
        description: "Base URL of the order management API",
      }),
      ORDER_API_KEY: create(EnvVarDeclarationSchema, {
        isSecret: true,
        description: "API key for authenticating with the order management service",
      }),
      NOTIFICATION_WEBHOOK: create(EnvVarDeclarationSchema, {
        isSecret: false,
        description: "Webhook URL for sending customer notifications",
      }),
    },
  });

  agent.metadata!.visibility = ApiResourceVisibility.visibility_public;

  const now = BigInt(Math.floor(Date.now() / 1000));
  const threeDaysAgo = now - BigInt(3 * 24 * 60 * 60);
  agent.status = create(AgentStatusSchema, {
    audit: create(ApiResourceAuditSchema, {
      specAudit: create(ApiResourceAuditInfoSchema, {
        createdAt: { seconds: threeDaysAgo, nanos: 0 },
        updatedAt: { seconds: now, nanos: 0 },
      }),
    }),
    defaultInstanceId: "",
  });

  return agent;
}

function buildSampleToolCall() {
  return create(ToolCallSchema, {
    id: "tc-get-order-001",
    name: "get_order",
    args: { order_id: "ORD-2847" },
    result: '{"order_id": "ORD-2847", "status": "shipped", "items": [{"name": "Wireless Headphones", "qty": 1, "price": 79.99}], "tracking": "1Z999AA10123456784"}',
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  });
}

function buildMcpToolCall() {
  return create(ToolCallSchema, {
    id: "tc-mcp-search-001",
    name: "mcp__order-management-api__list_orders",
    args: { customer_email: "jane@example.com", limit: 5 },
    result: '{"orders": [{"id": "ORD-2847", "date": "2026-03-28", "total": 79.99}, {"id": "ORD-2612", "date": "2026-03-15", "total": 149.50}]}',
    status: ToolCallStatus.TOOL_CALL_COMPLETED,
    startedAt: new Date(Date.now() - 342).toISOString(),
    completedAt: new Date().toISOString(),
  });
}

function buildSampleExecution() {
  const toolCall = buildSampleToolCall();

  const exec = samples.agentExecution({
    phase: ExecutionPhase.EXECUTION_COMPLETED,
    messages: [
      samples.humanMessage("I need to check the status of order ORD-2847."),
      samples.aiMessage("Let me look up that order for you.", [toolCall]),
      samples.aiMessage(
        "Order **ORD-2847** has shipped. Here are the details:\n\n" +
        "- **Item**: Wireless Headphones (1×)\n" +
        "- **Total**: $79.99\n" +
        "- **Tracking**: 1Z999AA10123456784\n\n" +
        "The package is on its way. Is there anything else I can help with?",
      ),
    ],
  });

  // Add LLM metrics to the AI messages for UsageWidget
  const aiMsgs = exec.status!.messages.filter(m => m.type === MessageType.MESSAGE_AI);
  if (aiMsgs[0]) {
    aiMsgs[0].llmMetrics = create(LlmCallMetricsSchema, {
      sequence: 1,
      model: "gpt-4o",
      provider: "openai",
      inputTokens: 1250,
      outputTokens: 86,
      totalTokens: 1336,
      estimatedCostUsd: 0.0142,
      durationMs: 1820,
    });
  }
  if (aiMsgs[1]) {
    aiMsgs[1].llmMetrics = create(LlmCallMetricsSchema, {
      sequence: 2,
      model: "gpt-4o",
      provider: "openai",
      inputTokens: 1580,
      outputTokens: 124,
      totalTokens: 1704,
      estimatedCostUsd: 0.0183,
      durationMs: 2140,
    });
  }

  // Add todos for ExecutionProgress / TodoList
  exec.status!.todos = {
    "todo-1": create(TodoItemSchema, { id: "todo-1", content: "Look up order details", status: TodoStatus.TODO_COMPLETED }),
    "todo-2": create(TodoItemSchema, { id: "todo-2", content: "Format order summary for customer", status: TodoStatus.TODO_COMPLETED }),
    "todo-3": create(TodoItemSchema, { id: "todo-3", content: "Check for delivery exceptions", status: TodoStatus.TODO_IN_PROGRESS }),
  };

  // Add a write-back for WriteBacksWidget
  exec.status!.workspaceWriteBacks = [
    create(WorkspaceWriteBackSchema, {
      workspaceEntryName: "acme-support-scripts",
      branchName: "agent/support-response-template",
      baseBranch: "main",
      commitSha: "a1b2c3d4e5f6",
      pullRequestUrl: "https://github.com/acme/support-scripts/pull/42",
      pullRequestNumber: 42,
      diffSummary: "+15 -3 in templates/order-status.md",
      phase: WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PR_CREATED,
    }),
  ];

  // Add an artifact for ArtifactCard / ArtifactsWidget
  exec.status!.artifacts = [
    samples.artifact("order-summary.md"),
  ];

  return exec;
}

function buildSampleSearchResults() {
  return [
    samples.searchResult({ name: "support-agent", slug: "support-agent", org: "acme", kind: ApiResourceKind.agent, description: "Handles customer support requests" }),
    samples.searchResult({ name: "code-reviewer", slug: "code-reviewer", org: "acme", kind: ApiResourceKind.agent, description: "Reviews pull requests and suggests improvements" }),
    samples.searchResult({ name: "data-analyst", slug: "data-analyst", org: "acme", kind: ApiResourceKind.agent, description: "Analyzes datasets and generates reports" }),
  ];
}

function buildSampleDiscoveredTools() {
  return [
    create(DiscoveredToolSchema, { name: "get_order", description: "Retrieve order details by order ID" }),
    create(DiscoveredToolSchema, { name: "list_orders", description: "List orders for a customer by email or ID" }),
    create(DiscoveredToolSchema, { name: "process_return", description: "Initiate a return or refund for an order" }),
    create(DiscoveredToolSchema, { name: "update_status", description: "Update the fulfillment status of an order" }),
  ];
}

function buildRichSkill() {
  const skill = samples.skill({
    name: "company-knowledge-base",
    org: "acme",
    description: "Product documentation, return policies, and FAQ answers for Acme Corp support agents.",
    skillMd: [
      "# Company Knowledge Base",
      "",
      "## Return Policy",
      "",
      "Acme Corp offers a 30-day return window for all products. Items must be in original packaging.",
      "Refunds are processed within 5-7 business days after the return is received.",
      "",
      "## Shipping",
      "",
      "- **Standard**: 5-7 business days",
      "- **Express**: 2-3 business days",
      "- **Overnight**: Next business day (orders before 2 PM ET)",
      "",
      "## Product Categories",
      "",
      "| Category | Warranty | Support Level |",
      "|----------|----------|---------------|",
      "| Electronics | 2 years | Priority |",
      "| Accessories | 1 year | Standard |",
      "| Software | Lifetime updates | Community |",
    ].join("\n"),
  });
  skill.metadata!.visibility = ApiResourceVisibility.visibility_public;
  return skill;
}

function buildRichMcpServer() {
  const server = samples.mcpServer({
    name: "order-management-api",
    org: "acme",
    description: "REST API for order lifecycle management — lookup, returns, and fulfillment tracking.",
  });
  server.spec = create(McpServerSpecSchema, {
    description: server.spec!.description,
    defaultEnabledTools: ["get_order", "list_orders"],
    pinnedToolApprovals: [
      create(ToolApprovalPolicySchema, {
        toolName: "process_return",
        message: "This tool processes refunds. Approve to continue.",
      }),
    ],
  });
  server.metadata!.visibility = ApiResourceVisibility.visibility_public;
  return server;
}

// ---------------------------------------------------------------------------
// Preview definitions
// ---------------------------------------------------------------------------

/**
 * Data-driven registry of component previews for SDK reference pages.
 *
 * Each entry declares what to render and with what data. The generic
 * {@link ComponentPreview} component reads this config, creates a
 * demo client from the fixtures, and renders the component inside a
 * {@link PreviewShell}.
 *
 * Adding a new preview: add one entry here and add the component name
 * to `PREVIEW_COMPONENTS` in `site/scripts/generate-react-sdk-docs/renderer.ts`.
 */
export const PREVIEW_CONFIGS: Record<string, PreviewConfig> = {

  // =========================================================================
  // Composer
  // =========================================================================

  SessionComposer: {
    component: SessionComposer,
    fixtures: [
      fixtures.environment.list(() =>
        create(EnvironmentListSchema, { items: [], totalCount: 0 }),
      ),
    ],
    props: {
      onSubmit: noop,
      placeholder: "Describe what you need help with...",
      org: "acme",
      workspace: MOCK_WORKSPACE,
      onAgentRefChange: noop,
      onMcpServerUsagesChange: noop,
      onSkillRefsChange: noop,
    },
    previewClassName: "max-w-2xl",
  },

  FollowUpInput: {
    component: FollowUpInput,
    fixtures: [],
    props: {
      onSubmit: noop,
      placeholder: "Send a follow-up message...",
    },
    previewClassName: "max-w-2xl",
  },

  // =========================================================================
  // Models
  // =========================================================================

  ModelSelector: {
    component: ModelSelector,
    fixtures: [],
    props: { onValueChange: noop },
  },

  // =========================================================================
  // Agent
  // =========================================================================

  AgentDetailView: {
    component: AgentDetailView,
    fixtures: [fixtures.agent.getByReference(() => buildRichAgent())],
    props: { org: "acme", slug: "support-agent" },
    previewClassName: "max-w-3xl",
  },

  AgentPicker: {
    component: AgentPicker,
    fixtures: [
      fixtures.agent.list(() =>
        samples.searchResponse(
          buildSampleSearchResults().filter(r => r.kind === ApiResourceKind.agent),
        ),
      ),
    ],
    props: { org: "acme", value: null, onChange: noop },
    previewClassName: "max-w-sm",
  },

  AgentEnvForm: {
    component: AgentEnvForm,
    fixtures: [],
    props: {
      agentName: "support-agent",
      variables: [
        { key: "ORDER_API_URL", isSecret: false, description: "Base URL of the order management API" },
        { key: "ORDER_API_KEY", isSecret: true, description: "API key for the order management service" },
      ],
      onSubmit: noop,
    },
    previewClassName: "max-w-lg",
  },

  // =========================================================================
  // Skill
  // =========================================================================

  SkillDetailView: {
    component: SkillDetailView,
    fixtures: [fixtures.skill.getByReference(() => buildRichSkill())],
    props: { org: "acme", slug: "company-knowledge-base" },
    previewClassName: "max-w-3xl",
  },

  SkillPicker: {
    component: SkillPicker,
    fixtures: [
      fixtures.skill.list(() =>
        samples.searchResponse([
          samples.searchResult({ name: "company-knowledge-base", slug: "company-knowledge-base", org: "acme", kind: ApiResourceKind.skill, description: "Product docs and FAQ answers" }),
          samples.searchResult({ name: "return-policy", slug: "return-policy", org: "acme", kind: ApiResourceKind.skill, description: "Return and refund policy reference" }),
        ]),
      ),
    ],
    props: { org: "acme", value: [], onChange: noop },
    previewClassName: "max-w-sm",
  },

  // =========================================================================
  // MCP Server
  // =========================================================================

  McpServerDetailView: {
    component: McpServerDetailView,
    fixtures: [fixtures.mcpServer.getByReference(() => buildRichMcpServer())],
    props: { org: "acme", slug: "order-management-api" },
    previewClassName: "max-w-3xl",
  },

  McpServerPicker: {
    component: McpServerPicker,
    fixtures: [
      fixtures.mcpServer.list(() =>
        samples.searchResponse([
          samples.searchResult({ name: "order-management-api", slug: "order-management-api", org: "acme", kind: ApiResourceKind.mcp_server, description: "REST API for order lifecycle management" }),
          samples.searchResult({ name: "notification-service", slug: "notification-service", org: "acme", kind: ApiResourceKind.mcp_server, description: "Email and SMS notification delivery" }),
        ]),
      ),
    ],
    props: { org: "acme", value: [], onChange: noop },
    previewClassName: "max-w-sm",
  },

  McpServerConfigPanel: {
    component: McpServerConfigPanel,
    fixtures: [],
    props: {
      mcpServer: buildRichMcpServer(),
      discoveredTools: buildSampleDiscoveredTools(),
      toolApprovals: [
        create(ToolApprovalPolicySchema, {
          toolName: "process_return",
          message: "This tool processes refunds. Approve to continue.",
        }),
      ],
      enabledTools: ["get_order", "list_orders"],
      onEnabledToolsChange: noop,
      onBack: noop,
    },
    previewClassName: "max-w-xl",
  },

  McpToolSelector: {
    component: McpToolSelector,
    fixtures: [],
    props: {
      tools: buildSampleDiscoveredTools(),
      toolApprovals: [
        create(ToolApprovalPolicySchema, {
          toolName: "process_return",
          message: "This tool processes refunds. Approve to continue.",
        }),
      ],
      enabledTools: ["get_order", "list_orders"],
      onChange: noop,
    },
    previewClassName: "max-w-lg",
  },

  // =========================================================================
  // Environment
  // =========================================================================

  EnvironmentListPanel: {
    component: EnvironmentListPanel,
    fixtures: [
      fixtures.environment.list(() =>
        create(EnvironmentListSchema, {
          items: [
            samples.environment({ name: "production", org: "acme" }),
            samples.environment({ name: "staging", org: "acme", id: "env-00000000-0000-0000-0000-000000000002" }),
          ],
          totalCount: 2,
        }),
      ),
    ],
    props: { org: "acme" },
    previewClassName: "max-w-2xl",
  },

  EnvironmentVariableEditor: {
    component: EnvironmentVariableEditor,
    fixtures: [
      fixtures.environment.get(() => {
        const env = samples.environment({ name: "production", org: "acme" });
        env.spec = create(EnvironmentSpecSchema, {
          data: {
            DATABASE_URL: create(EnvironmentValueSchema, {
              isSecret: false,
              description: "PostgreSQL connection string",
            }),
            API_SECRET: create(EnvironmentValueSchema, {
              isSecret: true,
              description: "Secret key for external API authentication",
            }),
          },
        });
        return env;
      }),
    ],
    props: { environmentId: "env-00000000-0000-0000-0000-000000000001" },
    previewClassName: "max-w-2xl",
  },

  CreateEnvironmentForm: {
    component: CreateEnvironmentForm,
    fixtures: [],
    props: { org: "acme" },
    previewClassName: "max-w-lg",
  },

  EnvVarForm: {
    component: EnvVarForm,
    fixtures: [],
    props: {
      variables: [
        { key: "DATABASE_URL", isSecret: false, description: "PostgreSQL connection string" },
        { key: "API_SECRET", isSecret: true, description: "Secret key for external API authentication" },
      ],
      onSubmit: noop,
      title: "Environment Variables",
      description: "Provide values for the required environment variables.",
    },
    previewClassName: "max-w-lg",
  },

  // =========================================================================
  // API Key
  // =========================================================================

  ApiKeyListPanel: {
    component: ApiKeyListPanel,
    fixtures: [fixtures.apiKey.findAll(() => samples.apiKeyList())],
    props: {},
    previewClassName: "max-w-2xl",
  },

  CreateApiKeyForm: {
    component: CreateApiKeyForm,
    fixtures: [],
    props: { org: "acme" },
    previewClassName: "max-w-lg",
  },

  ApiKeyCreatedAlert: {
    component: ApiKeyCreatedAlert,
    fixtures: [],
    props: {
      rawKey: "stgm_sk_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
      keyName: "production-deploy-key",
      onDismiss: noop,
    },
    previewClassName: "max-w-lg",
  },

  // =========================================================================
  // Organization
  // =========================================================================

  CreateOrganizationForm: {
    component: CreateOrganizationForm,
    fixtures: [],
    props: {},
    previewClassName: "max-w-lg",
  },

  // =========================================================================
  // Error
  // =========================================================================

  ErrorMessage: {
    component: ErrorMessage,
    fixtures: [],
    props: {
      error: new Error(
        "Failed to fetch agent — the server returned an unexpected response. " +
          "Check that the API URL is correct and the service is running.",
      ),
    },
  },

  SecretFlowErrorGuide: {
    component: SecretFlowErrorGuide,
    fixtures: [],
    props: {
      error: Object.assign(
        new Error(
          "Agent requires environment variables that have not been configured. " +
            "Missing: ORDER_API_KEY (secret), NOTIFICATION_WEBHOOK",
        ),
        { code: "failed-precondition" },
      ),
    },
    previewClassName: "max-w-lg",
  },

  // =========================================================================
  // Execution — Messages
  // =========================================================================

  MessageThread: {
    component: MessageThread,
    fixtures: [],
    props: { executions: [buildSampleExecution()] },
    previewClassName: "max-w-2xl",
  },

  MessageEntry: {
    component: MessageEntry,
    fixtures: [],
    props: {
      message: samples.aiMessage(
        "Order **ORD-2847** has shipped. Here are the details:\n\n" +
        "- **Item**: Wireless Headphones (1×)\n" +
        "- **Total**: $79.99\n" +
        "- **Tracking**: 1Z999AA10123456784\n\n" +
        "The package is on its way. Is there anything else I can help with?",
      ),
    },
    previewClassName: "max-w-2xl",
  },

  SubAgentSection: {
    component: SubAgentSection,
    fixtures: [],
    props: {
      subAgentExecution: create(SubAgentExecutionSchema, {
        id: "sae-001",
        name: "order-lookup",
        subject: "Looking up order ORD-2847",
        status: SubAgentStatus.SUB_AGENT_COMPLETED,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        messages: [
          create(AgentMessageSchema, {
            type: MessageType.MESSAGE_HUMAN,
            content: "Find order ORD-2847",
            timestamp: new Date().toISOString(),
          }),
          create(AgentMessageSchema, {
            type: MessageType.MESSAGE_AI,
            content: 'Found order ORD-2847: shipped on March 28, tracking 1Z999AA10123456784.',
            timestamp: new Date().toISOString(),
          }),
        ],
      }),
    },
    previewClassName: "max-w-2xl",
  },

  // =========================================================================
  // Execution — Progress & Status
  // =========================================================================

  ExecutionProgress: {
    component: ExecutionProgress,
    fixtures: [],
    props: { execution: buildSampleExecution() },
    previewClassName: "max-w-md",
  },

  ExecutionPhaseBadge: {
    component: ExecutionPhaseBadge,
    fixtures: [],
    props: { phase: ExecutionPhase.EXECUTION_IN_PROGRESS },
  },

  TodoList: {
    component: TodoList,
    fixtures: [],
    props: {
      todos: {
        "todo-1": create(TodoItemSchema, { id: "todo-1", content: "Look up order details", status: TodoStatus.TODO_COMPLETED }),
        "todo-2": create(TodoItemSchema, { id: "todo-2", content: "Format order summary for customer", status: TodoStatus.TODO_COMPLETED }),
        "todo-3": create(TodoItemSchema, { id: "todo-3", content: "Check for delivery exceptions", status: TodoStatus.TODO_IN_PROGRESS }),
        "todo-4": create(TodoItemSchema, { id: "todo-4", content: "Send tracking notification", status: TodoStatus.TODO_PENDING }),
      },
    },
    previewClassName: "max-w-md",
  },

  TodoInProgressIcon: {
    component: TodoInProgressIcon,
    fixtures: [],
    props: {},
  },

  SetupProgress: {
    component: SetupProgress,
    fixtures: [],
    props: {
      serverPhase: "cloning repository",
    },
    previewClassName: "max-w-md",
  },

  // =========================================================================
  // Execution — Approvals
  // =========================================================================

  ApprovalCard: {
    component: ApprovalCard,
    fixtures: [],
    props: {
      pendingApproval: create(PendingApprovalSchema, {
        toolCallId: "tc-return-001",
        toolName: "process_return",
        message: "Process a $79.99 refund for order ORD-2847 (Wireless Headphones)",
        argsPreview: '{"order_id": "ORD-2847", "amount": 79.99, "reason": "customer_request"}',
        requestedAt: new Date().toISOString(),
      }),
      onSubmit: noop,
    },
    previewClassName: "max-w-lg",
  },

  // =========================================================================
  // Execution — Tool Calls
  // =========================================================================

  ToolCallDetail: {
    component: ToolCallDetail,
    fixtures: [],
    props: { toolCall: buildSampleToolCall() },
    previewClassName: "max-w-lg",
  },

  ToolCallGroup: {
    component: ToolCallGroup,
    fixtures: [],
    props: {
      toolCalls: [buildSampleToolCall(), buildMcpToolCall()],
      defaultExpanded: true,
    },
    previewClassName: "max-w-lg",
  },

  ToolCallItem: {
    component: ToolCallItem,
    fixtures: [],
    props: { toolCall: buildSampleToolCall(), defaultExpanded: true },
    previewClassName: "max-w-lg",
  },

  ToolArgsView: {
    component: ToolArgsView,
    fixtures: [],
    props: {
      toolName: "get_order",
      args: { order_id: "ORD-2847" },
    },
    previewClassName: "max-w-lg",
  },

  McpToolDetail: {
    component: McpToolDetail,
    fixtures: [],
    props: { toolCall: buildMcpToolCall() },
    previewClassName: "max-w-lg",
  },

  McpArgsView: {
    component: McpArgsView,
    fixtures: [],
    props: {
      args: { customer_email: "jane@example.com", limit: 5 },
    },
    previewClassName: "max-w-lg",
  },

  McpMetadataRow: {
    component: McpMetadataRow,
    fixtures: [],
    props: {
      mcpServerSlug: "order-management-api",
      toolName: "list_orders",
      duration: "342ms",
    },
  },

  // =========================================================================
  // Execution — Artifacts
  // =========================================================================

  ArtifactContentRenderer: {
    component: ArtifactContentRenderer,
    fixtures: [],
    props: {
      content: [
        "# Order Summary — ORD-2847",
        "",
        "| Field | Value |",
        "|-------|-------|",
        "| Status | Shipped |",
        "| Item | Wireless Headphones |",
        "| Total | $79.99 |",
        "| Tracking | 1Z999AA10123456784 |",
      ].join("\n"),
      fileName: "order-summary.md",
    },
    previewClassName: "max-w-lg",
  },

  ArtifactCard: {
    component: ArtifactCard,
    fixtures: [
      fixtures.agentExecution.getArtifactContent(() => ({
        content: new TextEncoder().encode("# Order Summary\n\nShipped on March 28."),
        fileName: "order-summary.md",
        contentType: "text/markdown",
        sizeBytes: 42,
      })),
    ],
    props: {
      artifact: samples.artifact("order-summary.md"),
      executionId: "aex-00000000-0000-0000-0000-000000000001",
      org: "acme",
    },
    previewClassName: "max-w-sm",
  },

  ArtifactsWidget: {
    component: ArtifactsWidget,
    fixtures: [
      fixtures.agentExecution.getArtifactContent(() => ({
        content: new TextEncoder().encode("# Order Summary\n\nShipped on March 28."),
        fileName: "order-summary.md",
        contentType: "text/markdown",
        sizeBytes: 42,
      })),
    ],
    props: {
      executions: [buildSampleExecution()],
      org: "acme",
    },
    previewClassName: "max-w-sm",
  },

  // =========================================================================
  // Execution — Write-Backs
  // =========================================================================

  WriteBackCard: {
    component: WriteBackCard,
    fixtures: [],
    props: {
      writeBack: create(WorkspaceWriteBackSchema, {
        workspaceEntryName: "acme-support-scripts",
        branchName: "agent/support-response-template",
        baseBranch: "main",
        commitSha: "a1b2c3d4e5f6",
        pullRequestUrl: "https://github.com/acme/support-scripts/pull/42",
        pullRequestNumber: 42,
        diffSummary: "+15 -3 in templates/order-status.md",
        phase: WorkspaceWriteBackPhase.WORKSPACE_WRITE_BACK_PR_CREATED,
      }),
    },
    previewClassName: "max-w-md",
  },

  WriteBacksWidget: {
    component: WriteBacksWidget,
    fixtures: [],
    props: { executions: [buildSampleExecution()] },
    previewClassName: "max-w-sm",
  },

  // =========================================================================
  // Execution — Usage
  // =========================================================================

  UsageWidget: {
    component: UsageWidget,
    fixtures: [],
    props: { executions: [buildSampleExecution()] },
    previewClassName: "max-w-sm",
  },

  // =========================================================================
  // Execution — File Paths
  // =========================================================================

  FilePathLink: {
    component: FilePathLink,
    fixtures: [],
    props: { path: "src/handlers/order-status.ts" },
  },

  // =========================================================================
  // Execution — Session Variables
  // =========================================================================

  SessionVariablesInput: {
    component: SessionVariablesInput,
    fixtures: [],
    props: { sessionVariables: MOCK_SESSION_VARIABLES },
    previewClassName: "max-w-lg",
  },

  // =========================================================================
  // Workspace
  // =========================================================================

  WorkspaceEditor: {
    component: WorkspaceEditor,
    fixtures: [],
    props: { workspace: MOCK_WORKSPACE },
    previewClassName: "max-w-md",
  },

  WorkspaceSummary: {
    component: WorkspaceSummary,
    fixtures: [],
    props: {
      entries: [
        { id: "ws-1", name: "acme-support-scripts", type: "git" as const, gitUrl: "https://github.com/acme/support-scripts.git", gitBranch: "main" },
        { id: "ws-2", name: "local-project", type: "local" as const, localPath: "/Users/dev/projects/local-project" },
      ],
    },
    previewClassName: "max-w-md",
  },

  // =========================================================================
  // Library — Resource browsing
  // =========================================================================

  ResourceListView: {
    component: ResourceListView,
    fixtures: [],
    props: {
      items: buildSampleSearchResults(),
      isLoading: false,
      totalCount: 3,
    },
    previewClassName: "max-w-2xl",
  },

  ResourceCountCard: {
    component: ResourceCountCard,
    fixtures: [],
    props: {
      icon: "📦",
      label: "Agents",
      count: 12,
    },
    previewClassName: "max-w-xs",
  },

  ScopeToggle: {
    component: ScopeToggle,
    fixtures: [],
    props: { value: "org" as const, onChange: noop },
  },

  VisibilityToggle: {
    component: VisibilityToggle,
    fixtures: [],
    props: {
      visibility: ApiResourceVisibility.visibility_public,
      onVisibilityChange: noop,
    },
  },

  // =========================================================================
  // Attachment
  // =========================================================================

  AttachmentChipList: {
    component: AttachmentChipList,
    fixtures: [],
    props: {
      entries: [
        { id: "att-1", file: new File([""], "requirements.txt", { type: "text/plain" }), phase: "ready" as const, contentType: "text/plain", storageKey: "sk-1" },
        { id: "att-2", file: new File([""], "screenshot.png", { type: "image/png" }), phase: "uploading" as const, contentType: "image/png" },
        { id: "att-3", file: new File([""], "data.csv", { type: "text/csv" }), phase: "error" as const, contentType: "text/csv", error: "File too large" },
      ],
      onRemove: noop,
      onRetry: noop,
    },
    previewClassName: "max-w-md",
  },

  // =========================================================================
  // Internal / Misc
  // =========================================================================

  CloudFeatureNotice: {
    component: CloudFeatureNotice,
    fixtures: [],
    props: {
      children: "This feature is available on Stigmer Cloud. Self-hosted deployments require additional configuration.",
    },
    previewClassName: "max-w-lg",
  },
};
