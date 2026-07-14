import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ChannelDeliveryStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    channel_delivery_status_unspecified: _ClassVar[ChannelDeliveryStatus]
    pending: _ClassVar[ChannelDeliveryStatus]
    delivering: _ClassVar[ChannelDeliveryStatus]
    delivered: _ClassVar[ChannelDeliveryStatus]
    failed: _ClassVar[ChannelDeliveryStatus]
channel_delivery_status_unspecified: ChannelDeliveryStatus
pending: ChannelDeliveryStatus
delivering: ChannelDeliveryStatus
delivered: ChannelDeliveryStatus
failed: ChannelDeliveryStatus

class ChannelDelivery(_message.Message):
    __slots__ = ("delivery_id", "agent_channel_id", "org", "execution_id", "session_id", "conversation_key", "external_user_key", "status", "attempts", "last_error", "idempotency_key", "slack", "created_at", "updated_at", "next_attempt_at")
    DELIVERY_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_KEY_FIELD_NUMBER: _ClassVar[int]
    EXTERNAL_USER_KEY_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    ATTEMPTS_FIELD_NUMBER: _ClassVar[int]
    LAST_ERROR_FIELD_NUMBER: _ClassVar[int]
    IDEMPOTENCY_KEY_FIELD_NUMBER: _ClassVar[int]
    SLACK_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    NEXT_ATTEMPT_AT_FIELD_NUMBER: _ClassVar[int]
    delivery_id: str
    agent_channel_id: str
    org: str
    execution_id: str
    session_id: str
    conversation_key: str
    external_user_key: str
    status: ChannelDeliveryStatus
    attempts: int
    last_error: str
    idempotency_key: str
    slack: SlackDeliveryContext
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    next_attempt_at: _timestamp_pb2.Timestamp
    def __init__(self, delivery_id: _Optional[str] = ..., agent_channel_id: _Optional[str] = ..., org: _Optional[str] = ..., execution_id: _Optional[str] = ..., session_id: _Optional[str] = ..., conversation_key: _Optional[str] = ..., external_user_key: _Optional[str] = ..., status: _Optional[_Union[ChannelDeliveryStatus, str]] = ..., attempts: _Optional[int] = ..., last_error: _Optional[str] = ..., idempotency_key: _Optional[str] = ..., slack: _Optional[_Union[SlackDeliveryContext, _Mapping]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., next_attempt_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class SlackDeliveryContext(_message.Message):
    __slots__ = ("channel_id", "thread_ts", "placeholder_ts")
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    THREAD_TS_FIELD_NUMBER: _ClassVar[int]
    PLACEHOLDER_TS_FIELD_NUMBER: _ClassVar[int]
    channel_id: str
    thread_ts: str
    placeholder_ts: str
    def __init__(self, channel_id: _Optional[str] = ..., thread_ts: _Optional[str] = ..., placeholder_ts: _Optional[str] = ...) -> None: ...
