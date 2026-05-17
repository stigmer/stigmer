"""Unit tests for the OTel callback handler.

Uses an in-memory span exporter to verify that the handler creates the
correct spans with the expected attributes, without requiring a running
OTel collector or Jaeger instance.
"""

from __future__ import annotations

from uuid import uuid4

import pytest
from langchain_core.outputs import Generation, LLMResult

from graphton.core.otel_callback import (
    ATTR_LLM_INPUT_TOKENS,
    ATTR_LLM_MODEL,
    ATTR_LLM_OUTPUT_TOKENS,
    ATTR_LLM_PROVIDER,
    ATTR_MCP_SERVER_NAME,
    ATTR_MCP_TOOL_NAME,
    SPAN_LLM_CALL,
    SPAN_MCP_TOOL,
    OTelCallbackHandler,
)

otel_api = pytest.importorskip("opentelemetry.trace")
otel_sdk_trace = pytest.importorskip("opentelemetry.sdk.trace")
otel_export = pytest.importorskip("opentelemetry.sdk.trace.export")


@pytest.fixture()
def _otel_setup():
    """Configure an in-memory tracer for the duration of a single test."""
    exporter = otel_export.SimpleSpanExporter()
    provider = otel_sdk_trace.TracerProvider()
    provider.add_span_processor(otel_export.SimpleSpanProcessor(exporter))

    original = otel_api.get_tracer_provider()
    otel_api.set_tracer_provider(provider)
    yield exporter
    otel_api.set_tracer_provider(original)
    provider.shutdown()


@pytest.fixture()
def exporter(_otel_setup):
    return _otel_setup


# ---------------------------------------------------------------------------
# LLM call spans
# ---------------------------------------------------------------------------


class TestLlmCallSpans:
    def test_creates_span_on_chat_model_start_end(self, exporter):
        handler = OTelCallbackHandler()
        run_id = uuid4()

        handler.on_chat_model_start(
            serialized={"kwargs": {"model": "claude-sonnet-4-5-20250929"}},
            messages=[[]],
            run_id=run_id,
            invocation_params={"model": "claude-sonnet-4-5-20250929"},
        )
        handler.on_llm_end(
            response=LLMResult(
                generations=[[Generation(text="hello")]],
                llm_output={
                    "token_usage": {
                        "input_tokens": 150,
                        "output_tokens": 42,
                    },
                },
            ),
            run_id=run_id,
        )

        spans = exporter.get_finished_spans()
        assert len(spans) == 1

        span = spans[0]
        assert span.name == SPAN_LLM_CALL
        attrs = dict(span.attributes or {})
        assert attrs[ATTR_LLM_PROVIDER] == "anthropic"
        assert attrs[ATTR_LLM_MODEL] == "claude-sonnet-4-5-20250929"
        assert attrs[ATTR_LLM_INPUT_TOKENS] == 150
        assert attrs[ATTR_LLM_OUTPUT_TOKENS] == 42

    def test_openai_provider_detection(self, exporter):
        handler = OTelCallbackHandler()
        run_id = uuid4()

        handler.on_chat_model_start(
            serialized={},
            messages=[[]],
            run_id=run_id,
            invocation_params={"model": "gpt-4o"},
        )
        handler.on_llm_end(
            response=LLMResult(
                generations=[[Generation(text="hi")]],
                llm_output={
                    "token_usage": {
                        "prompt_tokens": 80,
                        "completion_tokens": 10,
                    },
                },
            ),
            run_id=run_id,
        )

        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        attrs = dict(spans[0].attributes or {})
        assert attrs[ATTR_LLM_PROVIDER] == "openai"
        assert attrs[ATTR_LLM_INPUT_TOKENS] == 80
        assert attrs[ATTR_LLM_OUTPUT_TOKENS] == 10

    def test_error_records_status_and_exception(self, exporter):
        handler = OTelCallbackHandler()
        run_id = uuid4()

        handler.on_chat_model_start(
            serialized={},
            messages=[[]],
            run_id=run_id,
            invocation_params={"model": "claude-sonnet-4-5-20250929"},
        )
        handler.on_llm_error(
            error=RuntimeError("API timeout"),
            run_id=run_id,
        )

        spans = exporter.get_finished_spans()
        assert len(spans) == 1

        from opentelemetry.trace import StatusCode

        span = spans[0]
        assert span.status.status_code == StatusCode.ERROR
        assert "API timeout" in span.status.description
        assert any(
            ev.name == "exception" for ev in span.events
        ), "Expected an exception event on the span"

    def test_missing_token_usage_still_ends_span(self, exporter):
        handler = OTelCallbackHandler()
        run_id = uuid4()

        handler.on_chat_model_start(
            serialized={},
            messages=[[]],
            run_id=run_id,
            invocation_params={"model": "claude-sonnet-4-5-20250929"},
        )
        handler.on_llm_end(
            response=LLMResult(
                generations=[[Generation(text="hi")]],
                llm_output=None,
            ),
            run_id=run_id,
        )

        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        attrs = dict(spans[0].attributes or {})
        assert ATTR_LLM_INPUT_TOKENS not in attrs
        assert ATTR_LLM_OUTPUT_TOKENS not in attrs

    def test_concurrent_runs_tracked_independently(self, exporter):
        handler = OTelCallbackHandler()
        id_a, id_b = uuid4(), uuid4()

        handler.on_chat_model_start(
            serialized={}, messages=[[]], run_id=id_a,
            invocation_params={"model": "claude-sonnet-4-5-20250929"},
        )
        handler.on_chat_model_start(
            serialized={}, messages=[[]], run_id=id_b,
            invocation_params={"model": "gpt-4o"},
        )
        handler.on_llm_end(
            response=LLMResult(generations=[[Generation(text="b")]], llm_output=None),
            run_id=id_b,
        )
        handler.on_llm_end(
            response=LLMResult(generations=[[Generation(text="a")]], llm_output=None),
            run_id=id_a,
        )

        spans = exporter.get_finished_spans()
        assert len(spans) == 2
        models = {dict(s.attributes or {}).get(ATTR_LLM_MODEL) for s in spans}
        assert models == {"claude-sonnet-4-5-20250929", "gpt-4o"}


# ---------------------------------------------------------------------------
# MCP tool call spans
# ---------------------------------------------------------------------------


class TestMcpToolSpans:
    def test_creates_span_for_mcp_tool(self, exporter):
        handler = OTelCallbackHandler(
            tool_server_map={"list_orgs": "planton", "deploy": "planton"},
        )
        run_id = uuid4()

        handler.on_tool_start(
            serialized={"name": "list_orgs"},
            input_str="{}",
            run_id=run_id,
        )
        handler.on_tool_end(output="result", run_id=run_id)

        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        attrs = dict(spans[0].attributes or {})
        assert spans[0].name == SPAN_MCP_TOOL
        assert attrs[ATTR_MCP_TOOL_NAME] == "list_orgs"
        assert attrs[ATTR_MCP_SERVER_NAME] == "planton"

    def test_ignores_platform_tools(self, exporter):
        handler = OTelCallbackHandler(
            tool_server_map={"list_orgs": "planton"},
        )
        run_id = uuid4()

        handler.on_tool_start(
            serialized={"name": "read"},
            input_str="{}",
            run_id=run_id,
        )
        handler.on_tool_end(output="file content", run_id=run_id)

        spans = exporter.get_finished_spans()
        assert len(spans) == 0

    def test_tool_error_records_exception(self, exporter):
        handler = OTelCallbackHandler(
            tool_server_map={"deploy": "planton"},
        )
        run_id = uuid4()

        handler.on_tool_start(
            serialized={"name": "deploy"},
            input_str="{}",
            run_id=run_id,
        )
        handler.on_tool_error(
            error=ConnectionError("MCP server unreachable"),
            run_id=run_id,
        )

        from opentelemetry.trace import StatusCode

        spans = exporter.get_finished_spans()
        assert len(spans) == 1
        assert spans[0].status.status_code == StatusCode.ERROR


# ---------------------------------------------------------------------------
# No-op when OTel not configured
# ---------------------------------------------------------------------------


class TestNoOpBehavior:
    def test_end_without_start_is_noop(self, exporter):
        handler = OTelCallbackHandler()
        handler.on_llm_end(
            response=LLMResult(generations=[[]], llm_output=None),
            run_id=uuid4(),
        )
        assert len(exporter.get_finished_spans()) == 0

    def test_tool_end_without_start_is_noop(self, exporter):
        handler = OTelCallbackHandler(tool_server_map={"x": "y"})
        handler.on_tool_end(output="x", run_id=uuid4())
        assert len(exporter.get_finished_spans()) == 0
