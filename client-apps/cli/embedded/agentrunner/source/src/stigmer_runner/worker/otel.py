"""Env-var-driven OpenTelemetry tracing initialization.

Mirrors the workflow-runner pattern (``pkg/otel/otel.go``): reads
``OTEL_EXPORTER_OTLP_ENDPOINT`` and configures an OTLP/gRPC exporter
with W3C TraceContext + Baggage propagation.  When the env var is unset,
``init_tracing`` returns ``None`` — zero overhead, no SDK initialization.
"""

import logging
import os
from collections.abc import Callable

logger = logging.getLogger(__name__)


def init_tracing(service_name: str) -> Callable[[], None] | None:
    """Initialize OTel tracing if ``OTEL_EXPORTER_OTLP_ENDPOINT`` is set.

    Returns a synchronous shutdown callable that flushes buffered spans,
    or ``None`` when tracing is disabled.
    """
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
    if not endpoint:
        return None

    from opentelemetry import propagate, trace
    from opentelemetry.baggage.propagation import W3CBaggagePropagator
    from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
    from opentelemetry.propagators.composite import CompositePropagator
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator

    resource = Resource.create({"service.name": service_name})
    exporter = OTLPSpanExporter(endpoint=endpoint, insecure=True)
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    propagate.set_global_textmap(
        CompositePropagator([TraceContextTextMapPropagator(), W3CBaggagePropagator()])
    )

    logger.info("OTel tracing enabled (endpoint=%s, service=%s)", endpoint, service_name)

    def shutdown() -> None:
        provider.shutdown()

    return shutdown


# Baggage key constants — must match workflow-runner pkg/otel/spans.go.
BAGGAGE_EXECUTION_ID = "stigmer.execution_id"
BAGGAGE_SESSION_ID = "stigmer.session_id"
BAGGAGE_ORG_ID = "stigmer.org_id"


def init_metrics(service_name: str) -> Callable[[], None] | None:
    """Initialize OTel metrics if ``OTEL_EXPORTER_OTLP_ENDPOINT`` is set.

    Returns a synchronous shutdown callable that flushes buffered metrics,
    or ``None`` when metrics are disabled.
    """
    endpoint = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT")
    if not endpoint:
        return None

    from opentelemetry.exporter.otlp.proto.grpc.metric_exporter import OTLPMetricExporter
    from opentelemetry.sdk.metrics import MeterProvider
    from opentelemetry.sdk.metrics.export import PeriodicExportingMetricReader
    from opentelemetry.sdk.resources import Resource

    resource = Resource.create({"service.name": service_name})
    exporter = OTLPMetricExporter(endpoint=endpoint, insecure=True)
    reader = PeriodicExportingMetricReader(exporter, export_interval_millis=30_000)
    provider = MeterProvider(resource=resource, metric_readers=[reader])

    from opentelemetry import metrics as otel_metrics
    otel_metrics.set_meter_provider(provider)

    logger.info("OTel metrics enabled (endpoint=%s, service=%s)", endpoint, service_name)

    def shutdown() -> None:
        provider.shutdown()

    return shutdown


def set_baggage(items: dict[str, str]) -> None:
    """Attach key-value pairs to the current context as W3C baggage.

    Must be called inside an async task where ``contextvars`` are active
    (e.g. inside a Temporal activity). Keys with empty values are skipped.
    """
    from opentelemetry import baggage, context as otel_context

    ctx = otel_context.get_current()
    for k, v in items.items():
        if v:
            ctx = baggage.set_baggage(k, v, ctx)
    otel_context.attach(ctx)
