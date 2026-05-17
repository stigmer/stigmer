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

    from opentelemetry import trace
    from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor

    resource = Resource.create({"service.name": service_name})
    exporter = OTLPSpanExporter(endpoint=endpoint, insecure=True)
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)

    logger.info("OTel tracing enabled (endpoint=%s, service=%s)", endpoint, service_name)

    def shutdown() -> None:
        provider.shutdown()

    return shutdown
