import datetime

from ai.stigmer.agentic.evalrun.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class EvalRunPhase(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    eval_run_phase_unspecified: _ClassVar[EvalRunPhase]
    eval_run_phase_pending: _ClassVar[EvalRunPhase]
    eval_run_phase_running: _ClassVar[EvalRunPhase]
    eval_run_phase_completed: _ClassVar[EvalRunPhase]
    eval_run_phase_partial: _ClassVar[EvalRunPhase]
    eval_run_phase_failed: _ClassVar[EvalRunPhase]

class EvalRunPartialReason(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    eval_run_partial_reason_unspecified: _ClassVar[EvalRunPartialReason]
    eval_run_partial_reason_cost_ceiling: _ClassVar[EvalRunPartialReason]
    eval_run_partial_reason_cancelled: _ClassVar[EvalRunPartialReason]

class EvalRunTryState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    eval_run_try_state_unspecified: _ClassVar[EvalRunTryState]
    eval_run_try_state_pending: _ClassVar[EvalRunTryState]
    eval_run_try_state_running: _ClassVar[EvalRunTryState]
    eval_run_try_state_graded: _ClassVar[EvalRunTryState]
    eval_run_try_state_not_graded: _ClassVar[EvalRunTryState]
eval_run_phase_unspecified: EvalRunPhase
eval_run_phase_pending: EvalRunPhase
eval_run_phase_running: EvalRunPhase
eval_run_phase_completed: EvalRunPhase
eval_run_phase_partial: EvalRunPhase
eval_run_phase_failed: EvalRunPhase
eval_run_partial_reason_unspecified: EvalRunPartialReason
eval_run_partial_reason_cost_ceiling: EvalRunPartialReason
eval_run_partial_reason_cancelled: EvalRunPartialReason
eval_run_try_state_unspecified: EvalRunTryState
eval_run_try_state_pending: EvalRunTryState
eval_run_try_state_running: EvalRunTryState
eval_run_try_state_graded: EvalRunTryState
eval_run_try_state_not_graded: EvalRunTryState

class EvalRunStatus(_message.Message):
    __slots__ = ("phase", "partial_reason", "error", "agent_version_hash", "plugins", "aggregates", "cost_usd", "tries_total", "tries_finished", "started_at", "finished_at", "vault_attachers", "audit")
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
    AGENT_VERSION_HASH_FIELD_NUMBER: _ClassVar[int]
    PLUGINS_FIELD_NUMBER: _ClassVar[int]
    AGGREGATES_FIELD_NUMBER: _ClassVar[int]
    COST_USD_FIELD_NUMBER: _ClassVar[int]
    TRIES_TOTAL_FIELD_NUMBER: _ClassVar[int]
    TRIES_FINISHED_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    FINISHED_AT_FIELD_NUMBER: _ClassVar[int]
    VAULT_ATTACHERS_FIELD_NUMBER: _ClassVar[int]
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    phase: EvalRunPhase
    partial_reason: EvalRunPartialReason
    error: str
    agent_version_hash: str
    plugins: _containers.RepeatedCompositeFieldContainer[EvalRunPlugin]
    aggregates: EvalRunAggregates
    cost_usd: float
    tries_total: int
    tries_finished: int
    started_at: _timestamp_pb2.Timestamp
    finished_at: _timestamp_pb2.Timestamp
    vault_attachers: _containers.ScalarMap[str, str]
    audit: _status_pb2.ApiResourceAudit
    def __init__(self, phase: _Optional[_Union[EvalRunPhase, str]] = ..., partial_reason: _Optional[_Union[EvalRunPartialReason, str]] = ..., error: _Optional[str] = ..., agent_version_hash: _Optional[str] = ..., plugins: _Optional[_Iterable[_Union[EvalRunPlugin, _Mapping]]] = ..., aggregates: _Optional[_Union[EvalRunAggregates, _Mapping]] = ..., cost_usd: _Optional[float] = ..., tries_total: _Optional[int] = ..., tries_finished: _Optional[int] = ..., started_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., finished_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., vault_attachers: _Optional[_Mapping[str, str]] = ..., audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ...) -> None: ...

class EvalRunPlugin(_message.Message):
    __slots__ = ("plugin_id", "plugin_slug", "plugin_digest", "attached", "compared", "not_run_reason", "cases", "aggregates")
    PLUGIN_ID_FIELD_NUMBER: _ClassVar[int]
    PLUGIN_SLUG_FIELD_NUMBER: _ClassVar[int]
    PLUGIN_DIGEST_FIELD_NUMBER: _ClassVar[int]
    ATTACHED_FIELD_NUMBER: _ClassVar[int]
    COMPARED_FIELD_NUMBER: _ClassVar[int]
    NOT_RUN_REASON_FIELD_NUMBER: _ClassVar[int]
    CASES_FIELD_NUMBER: _ClassVar[int]
    AGGREGATES_FIELD_NUMBER: _ClassVar[int]
    plugin_id: str
    plugin_slug: str
    plugin_digest: str
    attached: bool
    compared: bool
    not_run_reason: str
    cases: _containers.RepeatedCompositeFieldContainer[EvalRunCase]
    aggregates: EvalRunAggregates
    def __init__(self, plugin_id: _Optional[str] = ..., plugin_slug: _Optional[str] = ..., plugin_digest: _Optional[str] = ..., attached: bool = ..., compared: bool = ..., not_run_reason: _Optional[str] = ..., cases: _Optional[_Iterable[_Union[EvalRunCase, _Mapping]]] = ..., aggregates: _Optional[_Union[EvalRunAggregates, _Mapping]] = ...) -> None: ...

class EvalRunCase(_message.Message):
    __slots__ = ("case_name", "path", "case_tags", "not_run_reason", "targets", "notes", "mocked_servers")
    CASE_NAME_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    CASE_TAGS_FIELD_NUMBER: _ClassVar[int]
    NOT_RUN_REASON_FIELD_NUMBER: _ClassVar[int]
    TARGETS_FIELD_NUMBER: _ClassVar[int]
    NOTES_FIELD_NUMBER: _ClassVar[int]
    MOCKED_SERVERS_FIELD_NUMBER: _ClassVar[int]
    case_name: str
    path: str
    case_tags: _containers.RepeatedScalarFieldContainer[str]
    not_run_reason: str
    targets: _containers.RepeatedCompositeFieldContainer[EvalRunCaseTarget]
    notes: _containers.RepeatedScalarFieldContainer[str]
    mocked_servers: _containers.RepeatedCompositeFieldContainer[EvalRunMockedServer]
    def __init__(self, case_name: _Optional[str] = ..., path: _Optional[str] = ..., case_tags: _Optional[_Iterable[str]] = ..., not_run_reason: _Optional[str] = ..., targets: _Optional[_Iterable[_Union[EvalRunCaseTarget, _Mapping]]] = ..., notes: _Optional[_Iterable[str]] = ..., mocked_servers: _Optional[_Iterable[_Union[EvalRunMockedServer, _Mapping]]] = ...) -> None: ...

class EvalRunMockedServer(_message.Message):
    __slots__ = ("name", "tools", "not_started_reason")
    NAME_FIELD_NUMBER: _ClassVar[int]
    TOOLS_FIELD_NUMBER: _ClassVar[int]
    NOT_STARTED_REASON_FIELD_NUMBER: _ClassVar[int]
    name: str
    tools: _containers.RepeatedScalarFieldContainer[str]
    not_started_reason: str
    def __init__(self, name: _Optional[str] = ..., tools: _Optional[_Iterable[str]] = ..., not_started_reason: _Optional[str] = ...) -> None: ...

class EvalRunCaseTarget(_message.Message):
    __slots__ = ("target", "not_run_reason", "with_plugin", "without_plugin", "delta", "passed", "pass_k")
    TARGET_FIELD_NUMBER: _ClassVar[int]
    NOT_RUN_REASON_FIELD_NUMBER: _ClassVar[int]
    WITH_PLUGIN_FIELD_NUMBER: _ClassVar[int]
    WITHOUT_PLUGIN_FIELD_NUMBER: _ClassVar[int]
    DELTA_FIELD_NUMBER: _ClassVar[int]
    PASSED_FIELD_NUMBER: _ClassVar[int]
    PASS_K_FIELD_NUMBER: _ClassVar[int]
    target: _spec_pb2.EvalRunTarget
    not_run_reason: str
    with_plugin: EvalRunArm
    without_plugin: EvalRunArm
    delta: float
    passed: bool
    pass_k: bool
    def __init__(self, target: _Optional[_Union[_spec_pb2.EvalRunTarget, _Mapping]] = ..., not_run_reason: _Optional[str] = ..., with_plugin: _Optional[_Union[EvalRunArm, _Mapping]] = ..., without_plugin: _Optional[_Union[EvalRunArm, _Mapping]] = ..., delta: _Optional[float] = ..., passed: bool = ..., pass_k: bool = ...) -> None: ...

class EvalRunArm(_message.Message):
    __slots__ = ("score", "perfect_runs", "graded_tries", "tries")
    SCORE_FIELD_NUMBER: _ClassVar[int]
    PERFECT_RUNS_FIELD_NUMBER: _ClassVar[int]
    GRADED_TRIES_FIELD_NUMBER: _ClassVar[int]
    TRIES_FIELD_NUMBER: _ClassVar[int]
    score: float
    perfect_runs: int
    graded_tries: int
    tries: _containers.RepeatedCompositeFieldContainer[EvalRunTry]
    def __init__(self, score: _Optional[float] = ..., perfect_runs: _Optional[int] = ..., graded_tries: _Optional[int] = ..., tries: _Optional[_Iterable[_Union[EvalRunTry, _Mapping]]] = ...) -> None: ...

class EvalRunTry(_message.Message):
    __slots__ = ("index", "session_id", "run_id", "state", "score", "not_graded_reason", "error", "cost_usd", "duration_seconds", "aborted")
    INDEX_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    SCORE_FIELD_NUMBER: _ClassVar[int]
    NOT_GRADED_REASON_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    COST_USD_FIELD_NUMBER: _ClassVar[int]
    DURATION_SECONDS_FIELD_NUMBER: _ClassVar[int]
    ABORTED_FIELD_NUMBER: _ClassVar[int]
    index: int
    session_id: str
    run_id: str
    state: EvalRunTryState
    score: float
    not_graded_reason: str
    error: str
    cost_usd: float
    duration_seconds: float
    aborted: EvalRunAbort
    def __init__(self, index: _Optional[int] = ..., session_id: _Optional[str] = ..., run_id: _Optional[str] = ..., state: _Optional[_Union[EvalRunTryState, str]] = ..., score: _Optional[float] = ..., not_graded_reason: _Optional[str] = ..., error: _Optional[str] = ..., cost_usd: _Optional[float] = ..., duration_seconds: _Optional[float] = ..., aborted: _Optional[_Union[EvalRunAbort, _Mapping]] = ...) -> None: ...

class EvalRunAbort(_message.Message):
    __slots__ = ("server", "tool", "reason")
    SERVER_FIELD_NUMBER: _ClassVar[int]
    TOOL_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    server: str
    tool: str
    reason: str
    def __init__(self, server: _Optional[str] = ..., tool: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class EvalRunAggregates(_message.Message):
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
