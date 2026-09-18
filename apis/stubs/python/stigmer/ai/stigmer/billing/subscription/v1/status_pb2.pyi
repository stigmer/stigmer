import datetime

from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SubscriptionState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    subscription_state_unspecified: _ClassVar[SubscriptionState]
    active: _ClassVar[SubscriptionState]
    past_due: _ClassVar[SubscriptionState]
    canceled: _ClassVar[SubscriptionState]
subscription_state_unspecified: SubscriptionState
active: SubscriptionState
past_due: SubscriptionState
canceled: SubscriptionState

class SubscriptionStatus(_message.Message):
    __slots__ = ("audit", "state", "current_period_start", "current_period_end", "canceled_at")
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    CURRENT_PERIOD_START_FIELD_NUMBER: _ClassVar[int]
    CURRENT_PERIOD_END_FIELD_NUMBER: _ClassVar[int]
    CANCELED_AT_FIELD_NUMBER: _ClassVar[int]
    audit: _status_pb2.ApiResourceAudit
    state: SubscriptionState
    current_period_start: _timestamp_pb2.Timestamp
    current_period_end: _timestamp_pb2.Timestamp
    canceled_at: _timestamp_pb2.Timestamp
    def __init__(self, audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ..., state: _Optional[_Union[SubscriptionState, str]] = ..., current_period_start: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., current_period_end: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., canceled_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...
