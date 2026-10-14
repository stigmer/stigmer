from ai.stigmer.agentic.score.v1 import api_pb2 as _api_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import field_mask_pb2 as _field_mask_pb2
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
    __slots__ = ("run_id", "page_size", "page_token", "labels")
    class LabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    run_id: str
    page_size: int
    page_token: str
    labels: _containers.ScalarMap[str, str]
    def __init__(self, run_id: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., labels: _Optional[_Mapping[str, str]] = ...) -> None: ...

class ListScoresBySessionRequest(_message.Message):
    __slots__ = ("session_id", "page_size", "page_token", "labels")
    class LabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    page_size: int
    page_token: str
    labels: _containers.ScalarMap[str, str]
    def __init__(self, session_id: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., labels: _Optional[_Mapping[str, str]] = ...) -> None: ...

class ScoreList(_message.Message):
    __slots__ = ("entries", "next_page_token")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.Score]
    next_page_token: str
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.Score, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

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
    __slots__ = ("from_date", "to_date", "total", "days", "versions", "agreement")
    FROM_DATE_FIELD_NUMBER: _ClassVar[int]
    TO_DATE_FIELD_NUMBER: _ClassVar[int]
    TOTAL_FIELD_NUMBER: _ClassVar[int]
    DAYS_FIELD_NUMBER: _ClassVar[int]
    VERSIONS_FIELD_NUMBER: _ClassVar[int]
    AGREEMENT_FIELD_NUMBER: _ClassVar[int]
    from_date: str
    to_date: str
    total: QualitySummary
    days: _containers.RepeatedCompositeFieldContainer[QualityDay]
    versions: _containers.RepeatedCompositeFieldContainer[QualityVersion]
    agreement: _containers.RepeatedCompositeFieldContainer[JudgeAgreement]
    def __init__(self, from_date: _Optional[str] = ..., to_date: _Optional[str] = ..., total: _Optional[_Union[QualitySummary, _Mapping]] = ..., days: _Optional[_Iterable[_Union[QualityDay, _Mapping]]] = ..., versions: _Optional[_Iterable[_Union[QualityVersion, _Mapping]]] = ..., agreement: _Optional[_Iterable[_Union[JudgeAgreement, _Mapping]]] = ...) -> None: ...

class JudgeAgreement(_message.Message):
    __slots__ = ("evaluator_version", "runs", "thumbs_down_none_failed", "rules")
    EVALUATOR_VERSION_FIELD_NUMBER: _ClassVar[int]
    RUNS_FIELD_NUMBER: _ClassVar[int]
    THUMBS_DOWN_NONE_FAILED_FIELD_NUMBER: _ClassVar[int]
    RULES_FIELD_NUMBER: _ClassVar[int]
    evaluator_version: str
    runs: int
    thumbs_down_none_failed: int
    rules: _containers.RepeatedCompositeFieldContainer[RuleAgreement]
    def __init__(self, evaluator_version: _Optional[str] = ..., runs: _Optional[int] = ..., thumbs_down_none_failed: _Optional[int] = ..., rules: _Optional[_Iterable[_Union[RuleAgreement, _Mapping]]] = ...) -> None: ...

class RuleAgreement(_message.Message):
    __slots__ = ("name", "failed_thumbs_down", "failed_thumbs_up", "passed_thumbs_down", "passed_thumbs_up")
    NAME_FIELD_NUMBER: _ClassVar[int]
    FAILED_THUMBS_DOWN_FIELD_NUMBER: _ClassVar[int]
    FAILED_THUMBS_UP_FIELD_NUMBER: _ClassVar[int]
    PASSED_THUMBS_DOWN_FIELD_NUMBER: _ClassVar[int]
    PASSED_THUMBS_UP_FIELD_NUMBER: _ClassVar[int]
    name: str
    failed_thumbs_down: int
    failed_thumbs_up: int
    passed_thumbs_down: int
    passed_thumbs_up: int
    def __init__(self, name: _Optional[str] = ..., failed_thumbs_down: _Optional[int] = ..., failed_thumbs_up: _Optional[int] = ..., passed_thumbs_down: _Optional[int] = ..., passed_thumbs_up: _Optional[int] = ...) -> None: ...

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
    __slots__ = ("org", "agent_id", "days", "page_size", "page_token", "labels")
    class LabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ORG_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    DAYS_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    org: str
    agent_id: str
    days: int
    page_size: int
    page_token: str
    labels: _containers.ScalarMap[str, str]
    def __init__(self, org: _Optional[str] = ..., agent_id: _Optional[str] = ..., days: _Optional[int] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., labels: _Optional[_Mapping[str, str]] = ...) -> None: ...

class UpdateScoreInput(_message.Message):
    __slots__ = ("resource", "update_mask")
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    UPDATE_MASK_FIELD_NUMBER: _ClassVar[int]
    resource: _api_pb2.Score
    update_mask: _field_mask_pb2.FieldMask
    def __init__(self, resource: _Optional[_Union[_api_pb2.Score, _Mapping]] = ..., update_mask: _Optional[_Union[_field_mask_pb2.FieldMask, _Mapping]] = ...) -> None: ...
