import datetime

from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PlanLifecycle(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    plan_lifecycle_unspecified: _ClassVar[PlanLifecycle]
    active: _ClassVar[PlanLifecycle]
    retired: _ClassVar[PlanLifecycle]
plan_lifecycle_unspecified: PlanLifecycle
active: PlanLifecycle
retired: PlanLifecycle

class PlanStatus(_message.Message):
    __slots__ = ("audit", "lifecycle", "retired_at")
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    LIFECYCLE_FIELD_NUMBER: _ClassVar[int]
    RETIRED_AT_FIELD_NUMBER: _ClassVar[int]
    audit: _status_pb2.ApiResourceAudit
    lifecycle: PlanLifecycle
    retired_at: _timestamp_pb2.Timestamp
    def __init__(self, audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ..., lifecycle: _Optional[_Union[PlanLifecycle, str]] = ..., retired_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...
