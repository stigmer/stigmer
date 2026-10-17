import datetime

from ai.stigmer.agentic.routine.v1 import api_pb2 as _api_pb2
from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import field_mask_pb2 as _field_mask_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class RoutineFireOrigin(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ROUTINE_FIRE_ORIGIN_UNSPECIFIED: _ClassVar[RoutineFireOrigin]
    ROUTINE_FIRE_ORIGIN_SCHEDULE: _ClassVar[RoutineFireOrigin]
    ROUTINE_FIRE_ORIGIN_MANUAL: _ClassVar[RoutineFireOrigin]

class RoutineFireOutcome(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ROUTINE_FIRE_OUTCOME_UNSPECIFIED: _ClassVar[RoutineFireOutcome]
    ROUTINE_FIRE_OUTCOME_STARTED: _ClassVar[RoutineFireOutcome]
    ROUTINE_FIRE_OUTCOME_REFUSED: _ClassVar[RoutineFireOutcome]
    ROUTINE_FIRE_OUTCOME_TARGET_MISSING: _ClassVar[RoutineFireOutcome]
    ROUTINE_FIRE_OUTCOME_SKIPPED: _ClassVar[RoutineFireOutcome]
    ROUTINE_FIRE_OUTCOME_COMPLETED: _ClassVar[RoutineFireOutcome]
    ROUTINE_FIRE_OUTCOME_FAILED: _ClassVar[RoutineFireOutcome]
    ROUTINE_FIRE_OUTCOME_TIMED_OUT: _ClassVar[RoutineFireOutcome]
ROUTINE_FIRE_ORIGIN_UNSPECIFIED: RoutineFireOrigin
ROUTINE_FIRE_ORIGIN_SCHEDULE: RoutineFireOrigin
ROUTINE_FIRE_ORIGIN_MANUAL: RoutineFireOrigin
ROUTINE_FIRE_OUTCOME_UNSPECIFIED: RoutineFireOutcome
ROUTINE_FIRE_OUTCOME_STARTED: RoutineFireOutcome
ROUTINE_FIRE_OUTCOME_REFUSED: RoutineFireOutcome
ROUTINE_FIRE_OUTCOME_TARGET_MISSING: RoutineFireOutcome
ROUTINE_FIRE_OUTCOME_SKIPPED: RoutineFireOutcome
ROUTINE_FIRE_OUTCOME_COMPLETED: RoutineFireOutcome
ROUTINE_FIRE_OUTCOME_FAILED: RoutineFireOutcome
ROUTINE_FIRE_OUTCOME_TIMED_OUT: RoutineFireOutcome

class RoutineId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class FireRoutineInput(_message.Message):
    __slots__ = ("id", "text")
    ID_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    id: str
    text: str
    def __init__(self, id: _Optional[str] = ..., text: _Optional[str] = ...) -> None: ...

class ListRoutinesByAgentRequest(_message.Message):
    __slots__ = ("agent_id", "org", "page_size", "page_token", "labels")
    class LabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    agent_id: str
    org: str
    page_size: int
    page_token: str
    labels: _containers.ScalarMap[str, str]
    def __init__(self, agent_id: _Optional[str] = ..., org: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., labels: _Optional[_Mapping[str, str]] = ...) -> None: ...

class RoutineList(_message.Message):
    __slots__ = ("entries", "next_page_token")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.Routine]
    next_page_token: str
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.Routine, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class ListRoutinesRequest(_message.Message):
    __slots__ = ("org", "labels", "page_size", "page_token")
    class LabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ORG_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    org: str
    labels: _containers.ScalarMap[str, str]
    page_size: int
    page_token: str
    def __init__(self, org: _Optional[str] = ..., labels: _Optional[_Mapping[str, str]] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

class RoutineFireResult(_message.Message):
    __slots__ = ("routine", "outcome", "run_id", "refusal_reason", "fire_id")
    ROUTINE_FIELD_NUMBER: _ClassVar[int]
    OUTCOME_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    REFUSAL_REASON_FIELD_NUMBER: _ClassVar[int]
    FIRE_ID_FIELD_NUMBER: _ClassVar[int]
    routine: _api_pb2.Routine
    outcome: RoutineFireOutcome
    run_id: str
    refusal_reason: str
    fire_id: str
    def __init__(self, routine: _Optional[_Union[_api_pb2.Routine, _Mapping]] = ..., outcome: _Optional[_Union[RoutineFireOutcome, str]] = ..., run_id: _Optional[str] = ..., refusal_reason: _Optional[str] = ..., fire_id: _Optional[str] = ...) -> None: ...

class RoutineFire(_message.Message):
    __slots__ = ("routine_id", "org", "nominal_fire_time", "origin", "outcome", "reason", "run_id", "recorded_at", "completed_at", "fire_id", "fired_by")
    ROUTINE_ID_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    NOMINAL_FIRE_TIME_FIELD_NUMBER: _ClassVar[int]
    ORIGIN_FIELD_NUMBER: _ClassVar[int]
    OUTCOME_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    RECORDED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    FIRE_ID_FIELD_NUMBER: _ClassVar[int]
    FIRED_BY_FIELD_NUMBER: _ClassVar[int]
    routine_id: str
    org: str
    nominal_fire_time: _timestamp_pb2.Timestamp
    origin: RoutineFireOrigin
    outcome: RoutineFireOutcome
    reason: str
    run_id: str
    recorded_at: _timestamp_pb2.Timestamp
    completed_at: _timestamp_pb2.Timestamp
    fire_id: str
    fired_by: _status_pb2.ApiResourceAuditActor
    def __init__(self, routine_id: _Optional[str] = ..., org: _Optional[str] = ..., nominal_fire_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., origin: _Optional[_Union[RoutineFireOrigin, str]] = ..., outcome: _Optional[_Union[RoutineFireOutcome, str]] = ..., reason: _Optional[str] = ..., run_id: _Optional[str] = ..., recorded_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., completed_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., fire_id: _Optional[str] = ..., fired_by: _Optional[_Union[_status_pb2.ApiResourceAuditActor, _Mapping]] = ...) -> None: ...

class ListRoutineFiresRequest(_message.Message):
    __slots__ = ("routine_id", "page_size", "page_token")
    ROUTINE_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    routine_id: str
    page_size: int
    page_token: str
    def __init__(self, routine_id: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

class RoutineFireList(_message.Message):
    __slots__ = ("entries", "next_page_token")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[RoutineFire]
    next_page_token: str
    def __init__(self, entries: _Optional[_Iterable[_Union[RoutineFire, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class UpdateRoutineInput(_message.Message):
    __slots__ = ("resource", "update_mask")
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    UPDATE_MASK_FIELD_NUMBER: _ClassVar[int]
    resource: _api_pb2.Routine
    update_mask: _field_mask_pb2.FieldMask
    def __init__(self, resource: _Optional[_Union[_api_pb2.Routine, _Mapping]] = ..., update_mask: _Optional[_Union[_field_mask_pb2.FieldMask, _Mapping]] = ...) -> None: ...
