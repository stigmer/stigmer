from ai.stigmer.agentic.score.v1 import api_pb2 as _api_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ScoreId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class ListScoresByRunRequest(_message.Message):
    __slots__ = ("run_id",)
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    run_id: str
    def __init__(self, run_id: _Optional[str] = ...) -> None: ...

class ListScoresBySessionRequest(_message.Message):
    __slots__ = ("session_id",)
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    def __init__(self, session_id: _Optional[str] = ...) -> None: ...

class ScoreList(_message.Message):
    __slots__ = ("total_count", "items", "next_page_token")
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    total_count: int
    items: _containers.RepeatedCompositeFieldContainer[_api_pb2.Score]
    next_page_token: str
    def __init__(self, total_count: _Optional[int] = ..., items: _Optional[_Iterable[_Union[_api_pb2.Score, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class GetAgentQualityReportRequest(_message.Message):
    __slots__ = ("org", "agent_id", "days")
    ORG_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    DAYS_FIELD_NUMBER: _ClassVar[int]
    org: str
    agent_id: str
    days: int
    def __init__(self, org: _Optional[str] = ..., agent_id: _Optional[str] = ..., days: _Optional[int] = ...) -> None: ...

class AgentQualityReport(_message.Message):
    __slots__ = ("from_date", "to_date", "total", "days", "versions")
    FROM_DATE_FIELD_NUMBER: _ClassVar[int]
    TO_DATE_FIELD_NUMBER: _ClassVar[int]
    TOTAL_FIELD_NUMBER: _ClassVar[int]
    DAYS_FIELD_NUMBER: _ClassVar[int]
    VERSIONS_FIELD_NUMBER: _ClassVar[int]
    from_date: str
    to_date: str
    total: QualitySummary
    days: _containers.RepeatedCompositeFieldContainer[QualityDay]
    versions: _containers.RepeatedCompositeFieldContainer[QualityVersion]
    def __init__(self, from_date: _Optional[str] = ..., to_date: _Optional[str] = ..., total: _Optional[_Union[QualitySummary, _Mapping]] = ..., days: _Optional[_Iterable[_Union[QualityDay, _Mapping]]] = ..., versions: _Optional[_Iterable[_Union[QualityVersion, _Mapping]]] = ...) -> None: ...

class QualitySummary(_message.Message):
    __slots__ = ("runs", "metrics")
    RUNS_FIELD_NUMBER: _ClassVar[int]
    METRICS_FIELD_NUMBER: _ClassVar[int]
    runs: int
    metrics: _containers.RepeatedCompositeFieldContainer[MetricTally]
    def __init__(self, runs: _Optional[int] = ..., metrics: _Optional[_Iterable[_Union[MetricTally, _Mapping]]] = ...) -> None: ...

class MetricTally(_message.Message):
    __slots__ = ("metric", "evaluator_version", "passed", "failed", "not_graded", "pending", "criteria")
    METRIC_FIELD_NUMBER: _ClassVar[int]
    EVALUATOR_VERSION_FIELD_NUMBER: _ClassVar[int]
    PASSED_FIELD_NUMBER: _ClassVar[int]
    FAILED_FIELD_NUMBER: _ClassVar[int]
    NOT_GRADED_FIELD_NUMBER: _ClassVar[int]
    PENDING_FIELD_NUMBER: _ClassVar[int]
    CRITERIA_FIELD_NUMBER: _ClassVar[int]
    metric: str
    evaluator_version: str
    passed: int
    failed: int
    not_graded: int
    pending: int
    criteria: _containers.RepeatedCompositeFieldContainer[CriterionTally]
    def __init__(self, metric: _Optional[str] = ..., evaluator_version: _Optional[str] = ..., passed: _Optional[int] = ..., failed: _Optional[int] = ..., not_graded: _Optional[int] = ..., pending: _Optional[int] = ..., criteria: _Optional[_Iterable[_Union[CriterionTally, _Mapping]]] = ...) -> None: ...

class CriterionTally(_message.Message):
    __slots__ = ("name", "passed", "failed", "not_applicable")
    NAME_FIELD_NUMBER: _ClassVar[int]
    PASSED_FIELD_NUMBER: _ClassVar[int]
    FAILED_FIELD_NUMBER: _ClassVar[int]
    NOT_APPLICABLE_FIELD_NUMBER: _ClassVar[int]
    name: str
    passed: int
    failed: int
    not_applicable: int
    def __init__(self, name: _Optional[str] = ..., passed: _Optional[int] = ..., failed: _Optional[int] = ..., not_applicable: _Optional[int] = ...) -> None: ...

class QualityDay(_message.Message):
    __slots__ = ("date", "summary")
    DATE_FIELD_NUMBER: _ClassVar[int]
    SUMMARY_FIELD_NUMBER: _ClassVar[int]
    date: str
    summary: QualitySummary
    def __init__(self, date: _Optional[str] = ..., summary: _Optional[_Union[QualitySummary, _Mapping]] = ...) -> None: ...

class QualityVersion(_message.Message):
    __slots__ = ("agent_version_hash", "first_date", "last_date", "summary")
    AGENT_VERSION_HASH_FIELD_NUMBER: _ClassVar[int]
    FIRST_DATE_FIELD_NUMBER: _ClassVar[int]
    LAST_DATE_FIELD_NUMBER: _ClassVar[int]
    SUMMARY_FIELD_NUMBER: _ClassVar[int]
    agent_version_hash: str
    first_date: str
    last_date: str
    summary: QualitySummary
    def __init__(self, agent_version_hash: _Optional[str] = ..., first_date: _Optional[str] = ..., last_date: _Optional[str] = ..., summary: _Optional[_Union[QualitySummary, _Mapping]] = ...) -> None: ...

class ListFlaggedScoresByAgentRequest(_message.Message):
    __slots__ = ("org", "agent_id", "days", "page_size", "page_token")
    ORG_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    DAYS_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    org: str
    agent_id: str
    days: int
    page_size: int
    page_token: str
    def __init__(self, org: _Optional[str] = ..., agent_id: _Optional[str] = ..., days: _Optional[int] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...
