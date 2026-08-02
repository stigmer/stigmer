import datetime

from ai.stigmer.agentic.agentchannel.v1 import delivery_pb2 as _delivery_pb2
from ai.stigmer.agentic.agentchannel.v1 import message_io_pb2 as _message_io_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ChannelOutboundOrigin(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    channel_outbound_origin_unspecified: _ClassVar[ChannelOutboundOrigin]
    channel_conversation: _ClassVar[ChannelOutboundOrigin]
    operator: _ClassVar[ChannelOutboundOrigin]
channel_outbound_origin_unspecified: ChannelOutboundOrigin
channel_conversation: ChannelOutboundOrigin
operator: ChannelOutboundOrigin

class ChannelOutboundMessage(_message.Message):
    __slots__ = ("outbound_message_id", "agent_channel_id", "org", "session_id", "origin", "recipient", "payload", "status", "attempts", "last_error", "idempotency_key", "provider_message_id", "created_at", "updated_at", "next_attempt_at")
    OUTBOUND_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    ORIGIN_FIELD_NUMBER: _ClassVar[int]
    RECIPIENT_FIELD_NUMBER: _ClassVar[int]
    PAYLOAD_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    ATTEMPTS_FIELD_NUMBER: _ClassVar[int]
    LAST_ERROR_FIELD_NUMBER: _ClassVar[int]
    IDEMPOTENCY_KEY_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    NEXT_ATTEMPT_AT_FIELD_NUMBER: _ClassVar[int]
    outbound_message_id: str
    agent_channel_id: str
    org: str
    session_id: str
    origin: ChannelOutboundOrigin
    recipient: str
    payload: _message_io_pb2.ChannelOutboundPayload
    status: _delivery_pb2.ChannelDeliveryStatus
    attempts: int
    last_error: str
    idempotency_key: str
    provider_message_id: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    next_attempt_at: _timestamp_pb2.Timestamp
    def __init__(self, outbound_message_id: _Optional[str] = ..., agent_channel_id: _Optional[str] = ..., org: _Optional[str] = ..., session_id: _Optional[str] = ..., origin: _Optional[_Union[ChannelOutboundOrigin, str]] = ..., recipient: _Optional[str] = ..., payload: _Optional[_Union[_message_io_pb2.ChannelOutboundPayload, _Mapping]] = ..., status: _Optional[_Union[_delivery_pb2.ChannelDeliveryStatus, str]] = ..., attempts: _Optional[int] = ..., last_error: _Optional[str] = ..., idempotency_key: _Optional[str] = ..., provider_message_id: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., next_attempt_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...
