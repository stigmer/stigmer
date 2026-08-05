import datetime

from ai.stigmer.agentic.schedule.v1 import api_pb2 as _api_pb2
from ai.stigmer.commons.rpc import pagination_pb2 as _pagination_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ScheduleRunOrigin(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SCHEDULE_RUN_ORIGIN_UNSPECIFIED: _ClassVar[ScheduleRunOrigin]
    SCHEDULE_RUN_ORIGIN_CRON: _ClassVar[ScheduleRunOrigin]
    SCHEDULE_RUN_ORIGIN_MANUAL: _ClassVar[ScheduleRunOrigin]

class ScheduleRunOutcome(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SCHEDULE_RUN_OUTCOME_UNSPECIFIED: _ClassVar[ScheduleRunOutcome]
    SCHEDULE_RUN_OUTCOME_STARTED: _ClassVar[ScheduleRunOutcome]
    SCHEDULE_RUN_OUTCOME_REFUSED: _ClassVar[ScheduleRunOutcome]
    SCHEDULE_RUN_OUTCOME_TARGET_MISSING: _ClassVar[ScheduleRunOutcome]
    SCHEDULE_RUN_OUTCOME_SKIPPED: _ClassVar[ScheduleRunOutcome]
    SCHEDULE_RUN_OUTCOME_COMPLETED: _ClassVar[ScheduleRunOutcome]
    SCHEDULE_RUN_OUTCOME_FAILED: _ClassVar[ScheduleRunOutcome]
    SCHEDULE_RUN_OUTCOME_TIMED_OUT: _ClassVar[ScheduleRunOutcome]
SCHEDULE_RUN_ORIGIN_UNSPECIFIED: ScheduleRunOrigin
SCHEDULE_RUN_ORIGIN_CRON: ScheduleRunOrigin
SCHEDULE_RUN_ORIGIN_MANUAL: ScheduleRunOrigin
SCHEDULE_RUN_OUTCOME_UNSPECIFIED: ScheduleRunOutcome
SCHEDULE_RUN_OUTCOME_STARTED: ScheduleRunOutcome
SCHEDULE_RUN_OUTCOME_REFUSED: ScheduleRunOutcome
SCHEDULE_RUN_OUTCOME_TARGET_MISSING: ScheduleRunOutcome
SCHEDULE_RUN_OUTCOME_SKIPPED: ScheduleRunOutcome
SCHEDULE_RUN_OUTCOME_COMPLETED: ScheduleRunOutcome
SCHEDULE_RUN_OUTCOME_FAILED: ScheduleRunOutcome
SCHEDULE_RUN_OUTCOME_TIMED_OUT: ScheduleRunOutcome

class ScheduleId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class GetSchedulesByAgentRequest(_message.Message):
    __slots__ = ("agent_id", "page_info", "org")
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_INFO_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    agent_id: str
    page_info: _pagination_pb2.PageInfo
    org: str
    def __init__(self, agent_id: _Optional[str] = ..., page_info: _Optional[_Union[_pagination_pb2.PageInfo, _Mapping]] = ..., org: _Optional[str] = ...) -> None: ...

class ScheduleList(_message.Message):
    __slots__ = ("total_count", "items")
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    total_count: int
    items: _containers.RepeatedCompositeFieldContainer[_api_pb2.Schedule]
    def __init__(self, total_count: _Optional[int] = ..., items: _Optional[_Iterable[_Union[_api_pb2.Schedule, _Mapping]]] = ...) -> None: ...

class ListSchedulesRequest(_message.Message):
    __slots__ = ("org", "labels", "page_info")
    class LabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ORG_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    PAGE_INFO_FIELD_NUMBER: _ClassVar[int]
    org: str
    labels: _containers.ScalarMap[str, str]
    page_info: _pagination_pb2.PageInfo
    def __init__(self, org: _Optional[str] = ..., labels: _Optional[_Mapping[str, str]] = ..., page_info: _Optional[_Union[_pagination_pb2.PageInfo, _Mapping]] = ...) -> None: ...

class ScheduleTriggerResult(_message.Message):
    __slots__ = ("schedule", "outcome", "execution_id", "refusal_reason")
    SCHEDULE_FIELD_NUMBER: _ClassVar[int]
    OUTCOME_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    REFUSAL_REASON_FIELD_NUMBER: _ClassVar[int]
    schedule: _api_pb2.Schedule
    outcome: ScheduleRunOutcome
    execution_id: str
    refusal_reason: str
    def __init__(self, schedule: _Optional[_Union[_api_pb2.Schedule, _Mapping]] = ..., outcome: _Optional[_Union[ScheduleRunOutcome, str]] = ..., execution_id: _Optional[str] = ..., refusal_reason: _Optional[str] = ...) -> None: ...

class ScheduleRun(_message.Message):
    __slots__ = ("schedule_id", "org", "nominal_fire_time", "origin", "outcome", "reason", "execution_id", "recorded_at", "completed_at")
    SCHEDULE_ID_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    NOMINAL_FIRE_TIME_FIELD_NUMBER: _ClassVar[int]
    ORIGIN_FIELD_NUMBER: _ClassVar[int]
    OUTCOME_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    RECORDED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    schedule_id: str
    org: str
    nominal_fire_time: _timestamp_pb2.Timestamp
    origin: ScheduleRunOrigin
    outcome: ScheduleRunOutcome
    reason: str
    execution_id: str
    recorded_at: _timestamp_pb2.Timestamp
    completed_at: _timestamp_pb2.Timestamp
    def __init__(self, schedule_id: _Optional[str] = ..., org: _Optional[str] = ..., nominal_fire_time: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., origin: _Optional[_Union[ScheduleRunOrigin, str]] = ..., outcome: _Optional[_Union[ScheduleRunOutcome, str]] = ..., reason: _Optional[str] = ..., execution_id: _Optional[str] = ..., recorded_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., completed_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ListScheduleRunsRequest(_message.Message):
    __slots__ = ("schedule_id", "page_info")
    SCHEDULE_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_INFO_FIELD_NUMBER: _ClassVar[int]
    schedule_id: str
    page_info: _pagination_pb2.PageInfo
    def __init__(self, schedule_id: _Optional[str] = ..., page_info: _Optional[_Union[_pagination_pb2.PageInfo, _Mapping]] = ...) -> None: ...

class ScheduleRunList(_message.Message):
    __slots__ = ("total_count", "items")
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    total_count: int
    items: _containers.RepeatedCompositeFieldContainer[ScheduleRun]
    def __init__(self, total_count: _Optional[int] = ..., items: _Optional[_Iterable[_Union[ScheduleRun, _Mapping]]] = ...) -> None: ...
