"""OpenTelemetry callback handler for LangChain LLM and tool call spans.

Creates ``stigmer.llm.call`` and ``stigmer.mcp.tool_call`` spans aligned
with the Go workflow-runner span schema (``pkg/otel/spans.go``).  Spans
are created via the global OTel tracer — when no ``TracerProvider`` is
configured (unit tests, ``OTEL_EXPORTER_OTLP_ENDPOINT`` unset) all
operations are no-ops with zero overhead.

The handler is registered on the ``ChatModel`` instance by
``create_deep_agent`` and fires for every LLM call and tool invocation
in the agent graph, including sub-agent calls and summarization.
"""

from __future__ import annotations

import logging
import time
from typing import Any
from uuid import UUID

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.outputs import LLMResult

logger = logging.getLogger(__name__)

try:
    from opentelemetry import trace
    from opentelemetry.trace import StatusCode

    _HAS_OTEL = True
except ImportError:
    _HAS_OTEL = False

try:
    from opentelemetry import metrics as otel_metrics

    _HAS_METRICS = True
except ImportError:
    _HAS_METRICS = False

# ---------------------------------------------------------------------------
# Span names — must match workflow-runner pkg/otel/spans.go
# ---------------------------------------------------------------------------
SPAN_LLM_CALL = "stigmer.llm.call"
SPAN_MCP_TOOL = "stigmer.mcp.tool_call"

# ---------------------------------------------------------------------------
# Attribute keys — must match workflow-runner pkg/otel/spans.go
# ---------------------------------------------------------------------------
ATTR_LLM_PROVIDER = "stigmer.llm.provider"
ATTR_LLM_MODEL = "stigmer.llm.model"
ATTR_LLM_INPUT_TOKENS = "stigmer.llm.input_tokens"
ATTR_LLM_OUTPUT_TOKENS = "stigmer.llm.output_tokens"

ATTR_MCP_TOOL_NAME = "stigmer.mcp.tool_name"
ATTR_MCP_SERVER_NAME = "stigmer.mcp.server_name"

_TRACER_NAME = "graphton"
_METER_NAME = "graphton"

# Metric names — must match workflow-runner pkg/otel/metrics.go
METRIC_LLM_CALL_DURATION = "stigmer.llm.call.duration"
METRIC_LLM_CALL_COUNT = "stigmer.llm.call.count"
METRIC_LLM_TOKENS_INPUT = "stigmer.llm.tokens.input"
METRIC_LLM_TOKENS_OUTPUT = "stigmer.llm.tokens.output"
METRIC_MCP_TOOL_CALL_DURATION = "stigmer.mcp.tool_call.duration"
METRIC_MCP_TOOL_CALL_COUNT = "stigmer.mcp.tool_call.count"


def _infer_provider_from_model(model_name: str) -> str:
    """Map a model name to its provider string."""
    lower = model_name.lower()
    if lower.startswith("claude"):
        return "anthropic"
    if lower.startswith(("gpt", "o1", "o3", "o4")):
        return "openai"
    if any(lower.startswith(p) for p in ("qwen", "llama", "deepseek", "codellama", "mistral", "phi")):
        return "ollama"
    return "unknown"


class OTelCallbackHandler(BaseCallbackHandler):
    """LangChain callback that creates OTel spans for LLM and MCP tool calls.

    Thread-safe: each active span is keyed by LangChain's ``run_id``
    UUID, which is unique per concurrent invocation.

    Parameters
    ----------
    tool_server_map:
        Mapping from MCP tool name to the server that hosts it.
        Only tool names present in this map produce ``stigmer.mcp.tool_call``
        spans — platform tools (read, write, execute, …) are excluded.
    """

    def __init__(
        self,
        tool_server_map: dict[str, str] | None = None,
    ) -> None:
        super().__init__()
        self._tool_server_map: dict[str, str] = tool_server_map or {}
        self._spans: dict[UUID, Any] = {}
        self._start_times: dict[UUID, float] = {}

        # Metric instruments (no-op when opentelemetry.metrics not available)
        self._llm_call_duration: Any = None
        self._llm_call_count: Any = None
        self._llm_tokens_input: Any = None
        self._llm_tokens_output: Any = None
        self._mcp_tool_duration: Any = None
        self._mcp_tool_count: Any = None
        if _HAS_METRICS:
            try:
                meter = otel_metrics.get_meter(_METER_NAME)
                self._llm_call_duration = meter.create_histogram(
                    METRIC_LLM_CALL_DURATION, unit="ms",
                    description="Duration of LLM API calls in milliseconds",
                )
                self._llm_call_count = meter.create_counter(
                    METRIC_LLM_CALL_COUNT,
                    description="Total number of LLM API calls",
                )
                self._llm_tokens_input = meter.create_counter(
                    METRIC_LLM_TOKENS_INPUT, unit="{token}",
                    description="Total input tokens consumed across LLM calls",
                )
                self._llm_tokens_output = meter.create_counter(
                    METRIC_LLM_TOKENS_OUTPUT, unit="{token}",
                    description="Total output tokens produced across LLM calls",
                )
                self._mcp_tool_duration = meter.create_histogram(
                    METRIC_MCP_TOOL_CALL_DURATION, unit="ms",
                    description="Duration of MCP tool calls in milliseconds",
                )
                self._mcp_tool_count = meter.create_counter(
                    METRIC_MCP_TOOL_CALL_COUNT,
                    description="Total number of MCP tool calls",
                )
            except Exception:
                logger.debug("OTel metrics instruments not created")

    # ------------------------------------------------------------------
    # LLM call spans (stigmer.llm.call)
    # ------------------------------------------------------------------

    def on_chat_model_start(
        self,
        serialized: dict[str, Any],
        messages: list[list[Any]],
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        if not _HAS_OTEL:
            return

        tracer = trace.get_tracer(_TRACER_NAME)

        invocation_params = kwargs.get("invocation_params") or {}
        model_name = (
            invocation_params.get("model", "")
            or invocation_params.get("model_name", "")
            or serialized.get("kwargs", {}).get("model", "")
        )
        provider = _infer_provider_from_model(model_name)

        span = tracer.start_span(
            SPAN_LLM_CALL,
            attributes={
                ATTR_LLM_PROVIDER: provider,
                ATTR_LLM_MODEL: model_name,
            },
        )
        self._spans[run_id] = span
        self._start_times[run_id] = time.monotonic()

    def on_llm_end(
        self,
        response: LLMResult,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        span = self._spans.pop(run_id, None)
        self._start_times.pop(run_id, None)
        if span is None:
            return

        llm_output = response.llm_output or {}
        usage = llm_output.get("token_usage") or llm_output.get("usage") or {}

        input_tokens = usage.get("prompt_tokens") or usage.get("input_tokens", 0)
        output_tokens = usage.get("completion_tokens") or usage.get("output_tokens", 0)
        if input_tokens:
            span.set_attribute(ATTR_LLM_INPUT_TOKENS, int(input_tokens))
        if output_tokens:
            span.set_attribute(ATTR_LLM_OUTPUT_TOKENS, int(output_tokens))

        span.end()

        elapsed_ms = (time.monotonic() - start) * 1000 if (start := self._start_times.get(run_id)) else 0
        if self._llm_call_duration is not None:
            self._llm_call_duration.record(elapsed_ms)
        if self._llm_call_count is not None:
            self._llm_call_count.add(1)
        if input_tokens and self._llm_tokens_input is not None:
            self._llm_tokens_input.add(int(input_tokens))
        if output_tokens and self._llm_tokens_output is not None:
            self._llm_tokens_output.add(int(output_tokens))

    def on_llm_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        span = self._spans.pop(run_id, None)
        self._start_times.pop(run_id, None)
        if span is None:
            return

        span.set_status(StatusCode.ERROR, str(error))
        span.record_exception(error)
        span.end()

    # ------------------------------------------------------------------
    # MCP tool call spans (stigmer.mcp.tool_call)
    # ------------------------------------------------------------------

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        if not _HAS_OTEL:
            return

        tool_name = serialized.get("name") or kwargs.get("name", "")
        server_name = self._tool_server_map.get(tool_name, "")
        if not server_name:
            return

        tracer = trace.get_tracer(_TRACER_NAME)
        span = tracer.start_span(
            SPAN_MCP_TOOL,
            attributes={
                ATTR_MCP_TOOL_NAME: tool_name,
                ATTR_MCP_SERVER_NAME: server_name,
            },
        )
        self._spans[run_id] = span
        self._start_times[run_id] = time.monotonic()

    def on_tool_end(
        self,
        output: Any,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        start = self._start_times.pop(run_id, None)
        span = self._spans.pop(run_id, None)
        if span is None:
            return
        span.end()

        elapsed_ms = (time.monotonic() - start) * 1000 if start else 0
        if self._mcp_tool_duration is not None:
            self._mcp_tool_duration.record(elapsed_ms)
        if self._mcp_tool_count is not None:
            self._mcp_tool_count.add(1)

    def on_tool_error(
        self,
        error: BaseException,
        *,
        run_id: UUID,
        parent_run_id: UUID | None = None,
        **kwargs: Any,
    ) -> None:
        span = self._spans.pop(run_id, None)
        self._start_times.pop(run_id, None)
        if span is None:
            return

        span.set_status(StatusCode.ERROR, str(error))
        span.record_exception(error)
        span.end()
