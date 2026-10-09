import datetime

from ai.stigmer.agentic.plugineval.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PluginEvalPhase(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    plugin_eval_phase_unspecified: _ClassVar[PluginEvalPhase]
    plugin_eval_phase_pending: _ClassVar[PluginEvalPhase]
    plugin_eval_phase_running: _ClassVar[PluginEvalPhase]
    plugin_eval_phase_completed: _ClassVar[PluginEvalPhase]
    plugin_eval_phase_partial: _ClassVar[PluginEvalPhase]
    plugin_eval_phase_failed: _ClassVar[PluginEvalPhase]

class PluginEvalPartialReason(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    plugin_eval_partial_reason_unspecified: _ClassVar[PluginEvalPartialReason]
    plugin_eval_partial_reason_cost_ceiling: _ClassVar[PluginEvalPartialReason]
    plugin_eval_partial_reason_out_of_credit: _ClassVar[PluginEvalPartialReason]
    plugin_eval_partial_reason_cancelled: _ClassVar[PluginEvalPartialReason]

class PluginEvalTryState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    plugin_eval_try_state_unspecified: _ClassVar[PluginEvalTryState]
    plugin_eval_try_state_pending: _ClassVar[PluginEvalTryState]
    plugin_eval_try_state_running: _ClassVar[PluginEvalTryState]
    plugin_eval_try_state_graded: _ClassVar[PluginEvalTryState]
    plugin_eval_try_state_not_graded: _ClassVar[PluginEvalTryState]
plugin_eval_phase_unspecified: PluginEvalPhase
plugin_eval_phase_pending: PluginEvalPhase
plugin_eval_phase_running: PluginEvalPhase
plugin_eval_phase_completed: PluginEvalPhase
plugin_eval_phase_partial: PluginEvalPhase
plugin_eval_phase_failed: PluginEvalPhase
plugin_eval_partial_reason_unspecified: PluginEvalPartialReason
plugin_eval_partial_reason_cost_ceiling: PluginEvalPartialReason
plugin_eval_partial_reason_out_of_credit: PluginEvalPartialReason
plugin_eval_partial_reason_cancelled: PluginEvalPartialReason
plugin_eval_try_state_unspecified: PluginEvalTryState
plugin_eval_try_state_pending: PluginEvalTryState
plugin_eval_try_state_running: PluginEvalTryState
plugin_eval_try_state_graded: PluginEvalTryState
plugin_eval_try_state_not_graded: PluginEvalTryState

class PluginEvalStatus(_message.Message):
    __slots__ = ("phase", "partial_reason", "error", "cases", "aggregates", "cost_usd", "tries_total", "tries_finished", "started_at", "finished_at", "provisional_delta", "vault_attachers", "audit")
    class VaultAttachersEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    PHASE_FIELD_NUMBER: _ClassVar[int]
    PARTIAL_REASON_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    CASES_FIELD_NUMBER: _ClassVar[int]
    AGGREGATES_FIELD_NUMBER: _ClassVar[int]
    COST_USD_FIELD_NUMBER: _ClassVar[int]
    TRIES_TOTAL_FIELD_NUMBER: _ClassVar[int]
    TRIES_FINISHED_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    FINISHED_AT_FIELD_NUMBER: _ClassVar[int]
    PROVISIONAL_DELTA_FIELD_NUMBER: _ClassVar[int]
    VAULT_ATTACHERS_FIELD_NUMBER: _ClassVar[int]
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    phase: PluginEvalPhase
    partial_reason: PluginEvalPartialReason
    error: str
    cases: _containers.RepeatedCompositeFieldContainer[PluginEvalCase]
    aggregates: PluginEvalAggregates
    cost_usd: float
    tries_total: int
    tries_finished: int
    started_at: _timestamp_pb2.Timestamp
    finished_at: _timestamp_pb2.Timestamp
    provisional_delta: bool
    vault_attachers: _containers.ScalarMap[str, str]
    audit: _status_pb2.ApiResourceAudit
    def __init__(self, phase: _Optional[_Union[PluginEvalPhase, str]] = ..., partial_reason: _Optional[_Union[PluginEvalPartialReason, str]] = ..., error: _Optional[str] = ..., cases: _Optional[_Iterable[_Union[PluginEvalCase, _Mapping]]] = ..., aggregates: _Optional[_Union[PluginEvalAggregates, _Mapping]] = ..., cost_usd: _Optional[float] = ..., tries_total: _Optional[int] = ..., tries_finished: _Optional[int] = ..., started_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., finished_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., provisional_delta: bool = ..., vault_attachers: _Optional[_Mapping[str, str]] = ..., audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ...) -> None: ...

class PluginEvalCase(_message.Message):
    __slots__ = ("case_name", "path", "case_tags", "not_run_reason", "targets", "notes")
    CASE_NAME_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    CASE_TAGS_FIELD_NUMBER: _ClassVar[int]
    NOT_RUN_REASON_FIELD_NUMBER: _ClassVar[int]
    TARGETS_FIELD_NUMBER: _ClassVar[int]
    NOTES_FIELD_NUMBER: _ClassVar[int]
    case_name: str
    path: str
    case_tags: _containers.RepeatedScalarFieldContainer[str]
    not_run_reason: str
    targets: _containers.RepeatedCompositeFieldContainer[PluginEvalCaseTarget]
    notes: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, case_name: _Optional[str] = ..., path: _Optional[str] = ..., case_tags: _Optional[_Iterable[str]] = ..., not_run_reason: _Optional[str] = ..., targets: _Optional[_Iterable[_Union[PluginEvalCaseTarget, _Mapping]]] = ..., notes: _Optional[_Iterable[str]] = ...) -> None: ...

class PluginEvalCaseTarget(_message.Message):
    __slots__ = ("target", "not_run_reason", "with_plugin", "without_plugin", "delta", "passed", "pass_k")
    TARGET_FIELD_NUMBER: _ClassVar[int]
    NOT_RUN_REASON_FIELD_NUMBER: _ClassVar[int]
    WITH_PLUGIN_FIELD_NUMBER: _ClassVar[int]
    WITHOUT_PLUGIN_FIELD_NUMBER: _ClassVar[int]
    DELTA_FIELD_NUMBER: _ClassVar[int]
    PASSED_FIELD_NUMBER: _ClassVar[int]
    PASS_K_FIELD_NUMBER: _ClassVar[int]
    target: _spec_pb2.PluginEvalTarget
    not_run_reason: str
    with_plugin: PluginEvalArm
    without_plugin: PluginEvalArm
    delta: float
    passed: bool
    pass_k: bool
    def __init__(self, target: _Optional[_Union[_spec_pb2.PluginEvalTarget, _Mapping]] = ..., not_run_reason: _Optional[str] = ..., with_plugin: _Optional[_Union[PluginEvalArm, _Mapping]] = ..., without_plugin: _Optional[_Union[PluginEvalArm, _Mapping]] = ..., delta: _Optional[float] = ..., passed: bool = ..., pass_k: bool = ...) -> None: ...

class PluginEvalArm(_message.Message):
    __slots__ = ("score", "perfect_runs", "graded_tries", "tries")
    SCORE_FIELD_NUMBER: _ClassVar[int]
    PERFECT_RUNS_FIELD_NUMBER: _ClassVar[int]
    GRADED_TRIES_FIELD_NUMBER: _ClassVar[int]
    TRIES_FIELD_NUMBER: _ClassVar[int]
    score: float
    perfect_runs: int
    graded_tries: int
    tries: _containers.RepeatedCompositeFieldContainer[PluginEvalTry]
    def __init__(self, score: _Optional[float] = ..., perfect_runs: _Optional[int] = ..., graded_tries: _Optional[int] = ..., tries: _Optional[_Iterable[_Union[PluginEvalTry, _Mapping]]] = ...) -> None: ...

class PluginEvalTry(_message.Message):
    __slots__ = ("index", "session_id", "run_id", "state", "score", "not_graded_reason", "error", "cost_usd", "duration_seconds")
    INDEX_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    SCORE_FIELD_NUMBER: _ClassVar[int]
    NOT_GRADED_REASON_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    COST_USD_FIELD_NUMBER: _ClassVar[int]
    DURATION_SECONDS_FIELD_NUMBER: _ClassVar[int]
    index: int
    session_id: str
    run_id: str
    state: PluginEvalTryState
    score: float
    not_graded_reason: str
    error: str
    cost_usd: float
    duration_seconds: float
    def __init__(self, index: _Optional[int] = ..., session_id: _Optional[str] = ..., run_id: _Optional[str] = ..., state: _Optional[_Union[PluginEvalTryState, str]] = ..., score: _Optional[float] = ..., not_graded_reason: _Optional[str] = ..., error: _Optional[str] = ..., cost_usd: _Optional[float] = ..., duration_seconds: _Optional[float] = ...) -> None: ...

class PluginEvalAggregates(_message.Message):
    __slots__ = ("overall_score", "cases_passed", "cases_total", "mean_delta", "cases_not_run")
    OVERALL_SCORE_FIELD_NUMBER: _ClassVar[int]
    CASES_PASSED_FIELD_NUMBER: _ClassVar[int]
    CASES_TOTAL_FIELD_NUMBER: _ClassVar[int]
    MEAN_DELTA_FIELD_NUMBER: _ClassVar[int]
    CASES_NOT_RUN_FIELD_NUMBER: _ClassVar[int]
    overall_score: float
    cases_passed: int
    cases_total: int
    mean_delta: float
    cases_not_run: int
    def __init__(self, overall_score: _Optional[float] = ..., cases_passed: _Optional[int] = ..., cases_total: _Optional[int] = ..., mean_delta: _Optional[float] = ..., cases_not_run: _Optional[int] = ...) -> None: ...
