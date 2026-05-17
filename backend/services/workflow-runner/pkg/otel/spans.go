package otel

import "go.opentelemetry.io/otel/attribute"

// Span names follow OTel semantic conventions: <domain>.<operation>.
// These are shared across all Stigmer runners (Go, Python, TypeScript).
const (
	SpanLlmCall = "stigmer.llm.call"
	SpanLlmEval = "stigmer.llm.eval"
	SpanMcpTool = "stigmer.mcp.tool_call"
)

// Attribute keys for stigmer.llm.call spans.
var (
	AttrLlmProvider          = attribute.Key("stigmer.llm.provider")
	AttrLlmModel             = attribute.Key("stigmer.llm.model")
	AttrLlmProxyActive       = attribute.Key("stigmer.llm.proxy_active")
	AttrLlmMaxTokens         = attribute.Key("stigmer.llm.max_tokens")
	AttrLlmTemperature       = attribute.Key("stigmer.llm.temperature")
	AttrLlmInputTokens       = attribute.Key("stigmer.llm.input_tokens")
	AttrLlmOutputTokens      = attribute.Key("stigmer.llm.output_tokens")
	AttrLlmHasResponseSchema = attribute.Key("stigmer.llm.has_response_schema")
)

// Attribute keys for stigmer.llm.eval spans.
var (
	AttrEvalMode      = attribute.Key("stigmer.eval.mode")
	AttrEvalModel     = attribute.Key("stigmer.eval.model")
	AttrEvalThreshold = attribute.Key("stigmer.eval.threshold")
	AttrEvalPassed    = attribute.Key("stigmer.eval.passed")
	AttrEvalScore     = attribute.Key("stigmer.eval.score")
)

// Attribute keys for stigmer.mcp.tool_call spans (reserved for Python/TS).
var (
	AttrMcpToolName   = attribute.Key("stigmer.mcp.tool_name")
	AttrMcpServerName = attribute.Key("stigmer.mcp.server_name")
	AttrMcpServerID   = attribute.Key("stigmer.mcp.server_id")
)

// Shared attribute keys that appear across multiple span types.
var (
	AttrWorkflowExecutionID = attribute.Key("stigmer.workflow.execution_id")
	AttrSessionID           = attribute.Key("stigmer.session.id")
	AttrOrgID               = attribute.Key("stigmer.org.id")
)

// Baggage keys propagated through W3C baggage headers.
const (
	BaggageExecutionID = "stigmer.execution_id"
	BaggageSessionID   = "stigmer.session_id"
	BaggageOrgID       = "stigmer.org_id"
)
