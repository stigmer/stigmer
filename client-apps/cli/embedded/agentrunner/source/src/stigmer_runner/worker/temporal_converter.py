"""Forward-compatible Temporal data converter for proto JSON payloads.

The default Temporal Python SDK payload converter rejects unknown protobuf
fields during JSON deserialization. In a polyglot architecture (Go workflows
calling Python activities), this causes hard failures when the Go side adds
new proto fields before the Python worker is redeployed with updated stubs.

Proto3 is designed for forward compatibility — unknown fields should be
silently ignored rather than causing parse errors. This module provides a
custom DataConverter that honours that contract by setting
``ignore_unknown_fields=True`` on the ``JSONProtoPayloadConverter``.

Usage::

    from stigmer_runner.worker.temporal_converter import create_data_converter

    client = await Client.connect(
        address,
        namespace=namespace,
        data_converter=create_data_converter(),
    )
"""

import logging

from temporalio.converter import (
    BinaryNullPayloadConverter,
    BinaryPlainPayloadConverter,
    BinaryProtoPayloadConverter,
    CompositePayloadConverter,
    DataConverter,
    JSONPlainPayloadConverter,
    JSONProtoPayloadConverter,
)

logger = logging.getLogger(__name__)


class ForwardCompatiblePayloadConverter(CompositePayloadConverter):
    """Payload converter that tolerates unknown protobuf fields.

    Mirrors ``DefaultPayloadConverter`` but replaces the
    ``JSONProtoPayloadConverter`` with one that sets
    ``ignore_unknown_fields=True``, making proto JSON deserialization
    forward-compatible with newer proto schemas.
    """

    def __init__(self) -> None:
        super().__init__(
            BinaryNullPayloadConverter(),
            BinaryPlainPayloadConverter(),
            JSONProtoPayloadConverter(ignore_unknown_fields=True),
            BinaryProtoPayloadConverter(),
            JSONPlainPayloadConverter(),
        )


def create_data_converter() -> DataConverter:
    """Create a ``DataConverter`` with forward-compatible proto handling.

    Returns:
        A ``DataConverter`` whose payload converter tolerates unknown
        protobuf fields in JSON payloads, preventing hard failures from
        proto schema version skew between Go and Python services.
    """
    converter = DataConverter(
        payload_converter_class=ForwardCompatiblePayloadConverter,
    )
    logger.info(
        "Using forward-compatible DataConverter "
        "(ignore_unknown_fields=True for proto JSON payloads)"
    )
    return converter
