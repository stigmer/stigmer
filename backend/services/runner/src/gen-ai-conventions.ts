/**
 * The names a run's trace is written in: OpenTelemetry's conventions for
 * generative-AI telemetry, and Stigmer's own attributes beside them, in one
 * module that every span the runner emits takes its vocabulary from.
 *
 * The conventions live in `open-telemetry/semantic-conventions-genai`, read
 * at `6fd0d763a0` (2026-10-09). Every attribute there is still
 * "Development", so a name can move with an upstream release; the names are
 * string literals here, not `@opentelemetry/semantic-conventions`'
 * incubating constants, whose resolved 1.41 still carries the superseded
 * ones (`gen_ai.system`). A rename upstream is a change to this module and a
 * release note, nothing more.
 *
 * A tool that reads the conventions (Langfuse, among others) shows a run as
 * an AI trace: an `invoke_agent` span per turn, a `chat` span per model call
 * and an `execute_tool` span per tool call. A plain trace viewer shows the
 * same spans by name.
 *
 * Stigmer's own attributes (`stigmer.*`) carry what the conventions have no
 * name for: the run, its organization, what started it, the harness. The
 * metric names below are the ones the runner has always recorded; renaming
 * them belongs to whoever rebuilds the dashboards, not to this vocabulary.
 */

/** The instrumentation scope every span and instrument of the runner is created under. */
export const TRACER_NAME = "stigmer-runner";

// ─── Operations (`gen_ai.operation.name`, and the span name's first word) ───

export const OP_INVOKE_AGENT = "invoke_agent";
export const OP_CHAT = "chat";
export const OP_EXECUTE_TOOL = "execute_tool";

// ─── GenAI attributes ──────────────────────────────────────────────────────

export const GEN_AI_OPERATION_NAME = "gen_ai.operation.name";
export const GEN_AI_PROVIDER_NAME = "gen_ai.provider.name";
export const GEN_AI_AGENT_ID = "gen_ai.agent.id";
export const GEN_AI_AGENT_NAME = "gen_ai.agent.name";
export const GEN_AI_AGENT_VERSION = "gen_ai.agent.version";
export const GEN_AI_CONVERSATION_ID = "gen_ai.conversation.id";
export const GEN_AI_REQUEST_MODEL = "gen_ai.request.model";
export const GEN_AI_RESPONSE_MODEL = "gen_ai.response.model";
export const GEN_AI_RESPONSE_ID = "gen_ai.response.id";
export const GEN_AI_RESPONSE_FINISH_REASONS = "gen_ai.response.finish_reasons";
/** Input tokens, cached ones included (the conventions' Anthropic note). */
export const GEN_AI_USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens";
export const GEN_AI_USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens";
export const GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS = "gen_ai.usage.cache_read.input_tokens";
export const GEN_AI_USAGE_CACHE_WRITE_INPUT_TOKENS = "gen_ai.usage.cache_write.input_tokens";
export const GEN_AI_TOOL_NAME = "gen_ai.tool.name";
export const GEN_AI_TOOL_CALL_ID = "gen_ai.tool.call.id";
export const GEN_AI_TOOL_TYPE = "gen_ai.tool.type";

// The conversation's text: set only when the operator switches content on
// (`otel-export.ts`, `shared/telemetry-content.ts`). Each is a JSON string.
export const GEN_AI_SYSTEM_INSTRUCTIONS = "gen_ai.system_instructions";
export const GEN_AI_INPUT_MESSAGES = "gen_ai.input.messages";
export const GEN_AI_OUTPUT_MESSAGES = "gen_ai.output.messages";
export const GEN_AI_TOOL_CALL_ARGUMENTS = "gen_ai.tool.call.arguments";
export const GEN_AI_TOOL_CALL_RESULT = "gen_ai.tool.call.result";

/** Who asked: the run's creator, which can be an email, so set only with content on. */
export const USER_ID = "user.id";
export const ERROR_TYPE = "error.type";

// ─── MCP attributes ────────────────────────────────────────────────────────

export const MCP_METHOD_NAME = "mcp.method.name";
export const MCP_METHOD_TOOLS_CALL = "tools/call";

// ─── Well-known values ─────────────────────────────────────────────────────

/** `gen_ai.tool.type`: a tool the runner executes for the model. */
export const TOOL_TYPE_FUNCTION = "function";
/** `gen_ai.tool.type`: an MCP server's tool, executed by that server. */
export const TOOL_TYPE_EXTENSION = "extension";

/** `gen_ai.provider.name` for each place a model is served from (the conventions' provider table). */
export const PROVIDER_ANTHROPIC = "anthropic";
export const PROVIDER_OPENAI = "openai";
export const PROVIDER_GCP_VERTEX_AI = "gcp.vertex_ai";
export const PROVIDER_AWS_BEDROCK = "aws.bedrock";
export const PROVIDER_AZURE_AI_INFERENCE = "azure.ai.inference";
/** Not in the conventions' table: the Cursor service runs the Cursor engine's model calls itself. */
export const PROVIDER_CURSOR = "cursor";

// ─── Stigmer's own attributes ──────────────────────────────────────────────

export const STIGMER_RUN_ID = "stigmer.run.id";
/** The turn of the run (`turn_seq`): 0, then one more for each approval the run waited on. */
export const STIGMER_RUN_TURN = "stigmer.run.turn";
/** What started the run, one of {@link RunKind}. */
export const STIGMER_RUN_KIND = "stigmer.run.kind";
export const STIGMER_ORGANIZATION = "stigmer.organization";
/** The engine that ran the turn (`deep-agent`, `cursor`). */
export const STIGMER_HARNESS = "stigmer.harness";
/** The MCP server a tool belongs to, by its slug in the run. */
export const STIGMER_MCP_SERVER_NAME = "stigmer.mcp.server_name";
/** The Cursor engine's agent mode. */
export const STIGMER_CURSOR_MODE = "stigmer.cursor.mode";

/** `stigmer.run.kind`: what started a run, read from its labels. */
export type RunKind = "conversation" | "routine" | "judge" | "eval-try";

// ─── Metrics (names unchanged since the Go runner) ─────────────────────────

export const METRIC_LLM_CALL_DURATION = "stigmer.llm.call.duration";
export const METRIC_LLM_CALL_COUNT = "stigmer.llm.call.count";
export const METRIC_LLM_TOKENS_INPUT = "stigmer.llm.tokens.input";
export const METRIC_LLM_TOKENS_OUTPUT = "stigmer.llm.tokens.output";
export const METRIC_MCP_TOOL_CALL_DURATION = "stigmer.mcp.tool_call.duration";
export const METRIC_MCP_TOOL_CALL_COUNT = "stigmer.mcp.tool_call.count";

/** The metric attributes, kept as the dashboards have always read them. */
export const METRIC_ATTR_LLM_PROVIDER = "stigmer.llm.provider";
export const METRIC_ATTR_LLM_MODEL = "stigmer.llm.model";
export const METRIC_ATTR_MCP_TOOL_NAME = "stigmer.mcp.tool_name";
export const METRIC_ATTR_MCP_SERVER_NAME = "stigmer.mcp.server_name";
export const METRIC_ATTR_CURSOR_MODEL = "stigmer.cursor.model";
export const METRIC_ATTR_CURSOR_MODE = "stigmer.cursor.mode";
