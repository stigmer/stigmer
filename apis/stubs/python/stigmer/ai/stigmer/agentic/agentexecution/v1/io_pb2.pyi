import datetime

from ai.stigmer.agentic.agentexecution.v1 import api_pb2 as _api_pb2
from ai.stigmer.agentic.agentexecution.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.agentexecution.v1 import usage_pb2 as _usage_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import duration_pb2 as _duration_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentExecutionSummaryTimeWindow(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    AGENT_EXECUTION_SUMMARY_TIME_WINDOW_UNSPECIFIED: _ClassVar[AgentExecutionSummaryTimeWindow]
    AGENT_EXECUTION_SUMMARY_TIME_WINDOW_LAST_24H: _ClassVar[AgentExecutionSummaryTimeWindow]
    AGENT_EXECUTION_SUMMARY_TIME_WINDOW_LAST_7D: _ClassVar[AgentExecutionSummaryTimeWindow]
    AGENT_EXECUTION_SUMMARY_TIME_WINDOW_LAST_30D: _ClassVar[AgentExecutionSummaryTimeWindow]
    AGENT_EXECUTION_SUMMARY_TIME_WINDOW_ALL_TIME: _ClassVar[AgentExecutionSummaryTimeWindow]
AGENT_EXECUTION_SUMMARY_TIME_WINDOW_UNSPECIFIED: AgentExecutionSummaryTimeWindow
AGENT_EXECUTION_SUMMARY_TIME_WINDOW_LAST_24H: AgentExecutionSummaryTimeWindow
AGENT_EXECUTION_SUMMARY_TIME_WINDOW_LAST_7D: AgentExecutionSummaryTimeWindow
AGENT_EXECUTION_SUMMARY_TIME_WINDOW_LAST_30D: AgentExecutionSummaryTimeWindow
AGENT_EXECUTION_SUMMARY_TIME_WINDOW_ALL_TIME: AgentExecutionSummaryTimeWindow

class AgentExecutionId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class SessionId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class AgentExecutionList(_message.Message):
    __slots__ = ("total_pages", "entries")
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    total_pages: int
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.AgentExecution]
    def __init__(self, total_pages: _Optional[int] = ..., entries: _Optional[_Iterable[_Union[_api_pb2.AgentExecution, _Mapping]]] = ...) -> None: ...

class ListAgentExecutionsRequest(_message.Message):
    __slots__ = ("page_size", "page_token", "phase", "tags")
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    PHASE_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    page_size: int
    page_token: str
    phase: _enum_pb2.ExecutionPhase
    tags: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., phase: _Optional[_Union[_enum_pb2.ExecutionPhase, str]] = ..., tags: _Optional[_Iterable[str]] = ...) -> None: ...

class ListAgentExecutionsBySessionRequest(_message.Message):
    __slots__ = ("session_id", "page_size", "page_token")
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    page_size: int
    page_token: str
    def __init__(self, session_id: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

class AgentExecutionUpdateStatusInput(_message.Message):
    __slots__ = ("execution_id", "status")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    status: _api_pb2.AgentExecutionStatus
    def __init__(self, execution_id: _Optional[str] = ..., status: _Optional[_Union[_api_pb2.AgentExecutionStatus, _Mapping]] = ...) -> None: ...

class UpdateStatusResponse(_message.Message):
    __slots__ = ("signal", "signal_reason")
    SIGNAL_FIELD_NUMBER: _ClassVar[int]
    SIGNAL_REASON_FIELD_NUMBER: _ClassVar[int]
    signal: _enum_pb2.ExecutionControlSignal
    signal_reason: str
    def __init__(self, signal: _Optional[_Union[_enum_pb2.ExecutionControlSignal, str]] = ..., signal_reason: _Optional[str] = ...) -> None: ...

class SubmitApprovalInput(_message.Message):
    __slots__ = ("agent_execution_id", "tool_call_id", "action", "comment")
    AGENT_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    COMMENT_FIELD_NUMBER: _ClassVar[int]
    agent_execution_id: str
    tool_call_id: str
    action: _enum_pb2.ApprovalAction
    comment: str
    def __init__(self, agent_execution_id: _Optional[str] = ..., tool_call_id: _Optional[str] = ..., action: _Optional[_Union[_enum_pb2.ApprovalAction, str]] = ..., comment: _Optional[str] = ...) -> None: ...

class ApprovalDecisionList(_message.Message):
    __slots__ = ("decisions",)
    DECISIONS_FIELD_NUMBER: _ClassVar[int]
    decisions: _containers.RepeatedCompositeFieldContainer[SubmitApprovalInput]
    def __init__(self, decisions: _Optional[_Iterable[_Union[SubmitApprovalInput, _Mapping]]] = ...) -> None: ...

class SubmitFileDecisionInput(_message.Message):
    __slots__ = ("agent_execution_id", "change_set_id", "scope", "file_change_id", "action", "expected_digest", "reason")
    AGENT_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANGE_SET_ID_FIELD_NUMBER: _ClassVar[int]
    SCOPE_FIELD_NUMBER: _ClassVar[int]
    FILE_CHANGE_ID_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    EXPECTED_DIGEST_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    agent_execution_id: str
    change_set_id: str
    scope: _enum_pb2.FileDecisionScope
    file_change_id: str
    action: _enum_pb2.FileDecisionAction
    expected_digest: str
    reason: str
    def __init__(self, agent_execution_id: _Optional[str] = ..., change_set_id: _Optional[str] = ..., scope: _Optional[_Union[_enum_pb2.FileDecisionScope, str]] = ..., file_change_id: _Optional[str] = ..., action: _Optional[_Union[_enum_pb2.FileDecisionAction, str]] = ..., expected_digest: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class CancelAgentExecutionInput(_message.Message):
    __slots__ = ("id", "reason")
    ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    id: str
    reason: str
    def __init__(self, id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class TerminateAgentExecutionInput(_message.Message):
    __slots__ = ("id", "reason")
    ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    id: str
    reason: str
    def __init__(self, id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class RecoverAgentExecutionInput(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class PauseAgentExecutionInput(_message.Message):
    __slots__ = ("id", "reason")
    ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    id: str
    reason: str
    def __init__(self, id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class ResumeAgentExecutionInput(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class UploadAttachmentRequest(_message.Message):
    __slots__ = ("filename", "content", "content_type")
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    filename: str
    content: bytes
    content_type: str
    def __init__(self, filename: _Optional[str] = ..., content: _Optional[bytes] = ..., content_type: _Optional[str] = ...) -> None: ...

class UploadAttachmentResponse(_message.Message):
    __slots__ = ("storage_key",)
    STORAGE_KEY_FIELD_NUMBER: _ClassVar[int]
    storage_key: str
    def __init__(self, storage_key: _Optional[str] = ...) -> None: ...

class GetArtifactDownloadUrlRequest(_message.Message):
    __slots__ = ("execution_id", "storage_key")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    STORAGE_KEY_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    storage_key: str
    def __init__(self, execution_id: _Optional[str] = ..., storage_key: _Optional[str] = ...) -> None: ...

class GetArtifactDownloadUrlResponse(_message.Message):
    __slots__ = ("download_url", "expires_at")
    DOWNLOAD_URL_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    download_url: str
    expires_at: str
    def __init__(self, download_url: _Optional[str] = ..., expires_at: _Optional[str] = ...) -> None: ...

class GetArtifactContentRequest(_message.Message):
    __slots__ = ("execution_id", "storage_key", "max_bytes", "entry_path")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    STORAGE_KEY_FIELD_NUMBER: _ClassVar[int]
    MAX_BYTES_FIELD_NUMBER: _ClassVar[int]
    ENTRY_PATH_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    storage_key: str
    max_bytes: int
    entry_path: str
    def __init__(self, execution_id: _Optional[str] = ..., storage_key: _Optional[str] = ..., max_bytes: _Optional[int] = ..., entry_path: _Optional[str] = ...) -> None: ...

class GetArtifactContentResponse(_message.Message):
    __slots__ = ("content", "content_type", "total_size_bytes", "truncated")
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    TOTAL_SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    TRUNCATED_FIELD_NUMBER: _ClassVar[int]
    content: bytes
    content_type: str
    total_size_bytes: int
    truncated: bool
    def __init__(self, content: _Optional[bytes] = ..., content_type: _Optional[str] = ..., total_size_bytes: _Optional[int] = ..., truncated: bool = ...) -> None: ...

class GetExecutionUsageReportInput(_message.Message):
    __slots__ = ("execution_id",)
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    def __init__(self, execution_id: _Optional[str] = ...) -> None: ...

class GetExecutionUsageReportOutput(_message.Message):
    __slots__ = ("aggregate", "model_breakdown")
    AGGREGATE_FIELD_NUMBER: _ClassVar[int]
    MODEL_BREAKDOWN_FIELD_NUMBER: _ClassVar[int]
    aggregate: _usage_pb2.UsageReportAggregate
    model_breakdown: _containers.RepeatedCompositeFieldContainer[_usage_pb2.ModelUsage]
    def __init__(self, aggregate: _Optional[_Union[_usage_pb2.UsageReportAggregate, _Mapping]] = ..., model_breakdown: _Optional[_Iterable[_Union[_usage_pb2.ModelUsage, _Mapping]]] = ...) -> None: ...

class GetSessionUsageReportInput(_message.Message):
    __slots__ = ("session_id",)
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    def __init__(self, session_id: _Optional[str] = ...) -> None: ...

class GetSessionUsageReportOutput(_message.Message):
    __slots__ = ("session_id", "execution_count", "total_usage", "executions", "model_breakdown", "first_execution_at", "last_execution_at", "is_estimated")
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_COUNT_FIELD_NUMBER: _ClassVar[int]
    TOTAL_USAGE_FIELD_NUMBER: _ClassVar[int]
    EXECUTIONS_FIELD_NUMBER: _ClassVar[int]
    MODEL_BREAKDOWN_FIELD_NUMBER: _ClassVar[int]
    FIRST_EXECUTION_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_EXECUTION_AT_FIELD_NUMBER: _ClassVar[int]
    IS_ESTIMATED_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    execution_count: int
    total_usage: _usage_pb2.UsageReportAggregate
    executions: _containers.RepeatedCompositeFieldContainer[ExecutionUsageSummary]
    model_breakdown: _containers.RepeatedCompositeFieldContainer[_usage_pb2.ModelUsage]
    first_execution_at: str
    last_execution_at: str
    is_estimated: bool
    def __init__(self, session_id: _Optional[str] = ..., execution_count: _Optional[int] = ..., total_usage: _Optional[_Union[_usage_pb2.UsageReportAggregate, _Mapping]] = ..., executions: _Optional[_Iterable[_Union[ExecutionUsageSummary, _Mapping]]] = ..., model_breakdown: _Optional[_Iterable[_Union[_usage_pb2.ModelUsage, _Mapping]]] = ..., first_execution_at: _Optional[str] = ..., last_execution_at: _Optional[str] = ..., is_estimated: bool = ...) -> None: ...

class GetAgentUsageReportInput(_message.Message):
    __slots__ = ("agent_id", "from_date", "to_date", "page_size", "page_token")
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    FROM_DATE_FIELD_NUMBER: _ClassVar[int]
    TO_DATE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    agent_id: str
    from_date: str
    to_date: str
    page_size: int
    page_token: str
    def __init__(self, agent_id: _Optional[str] = ..., from_date: _Optional[str] = ..., to_date: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

class GetAgentUsageReportOutput(_message.Message):
    __slots__ = ("agent_id", "agent_name", "total_usage", "model_breakdown", "sessions", "total_sessions", "total_executions", "total_billable_cost_micros", "next_page_token")
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_NAME_FIELD_NUMBER: _ClassVar[int]
    TOTAL_USAGE_FIELD_NUMBER: _ClassVar[int]
    MODEL_BREAKDOWN_FIELD_NUMBER: _ClassVar[int]
    SESSIONS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_SESSIONS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_EXECUTIONS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_BILLABLE_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    agent_id: str
    agent_name: str
    total_usage: _usage_pb2.UsageReportAggregate
    model_breakdown: _containers.RepeatedCompositeFieldContainer[_usage_pb2.ModelUsage]
    sessions: _containers.RepeatedCompositeFieldContainer[SessionUsageSummary]
    total_sessions: int
    total_executions: int
    total_billable_cost_micros: int
    next_page_token: str
    def __init__(self, agent_id: _Optional[str] = ..., agent_name: _Optional[str] = ..., total_usage: _Optional[_Union[_usage_pb2.UsageReportAggregate, _Mapping]] = ..., model_breakdown: _Optional[_Iterable[_Union[_usage_pb2.ModelUsage, _Mapping]]] = ..., sessions: _Optional[_Iterable[_Union[SessionUsageSummary, _Mapping]]] = ..., total_sessions: _Optional[int] = ..., total_executions: _Optional[int] = ..., total_billable_cost_micros: _Optional[int] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class GetOrgUsageReportInput(_message.Message):
    __slots__ = ("org_id", "from_date", "to_date")
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    FROM_DATE_FIELD_NUMBER: _ClassVar[int]
    TO_DATE_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    from_date: str
    to_date: str
    def __init__(self, org_id: _Optional[str] = ..., from_date: _Optional[str] = ..., to_date: _Optional[str] = ...) -> None: ...

class GetOrgUsageReportOutput(_message.Message):
    __slots__ = ("org_id", "total_agents", "total_sessions", "total_executions", "total_billable_cost_micros", "model_breakdown", "top_agents_by_cost", "daily_costs", "harness_breakdown")
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    TOTAL_AGENTS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_SESSIONS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_EXECUTIONS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_BILLABLE_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    MODEL_BREAKDOWN_FIELD_NUMBER: _ClassVar[int]
    TOP_AGENTS_BY_COST_FIELD_NUMBER: _ClassVar[int]
    DAILY_COSTS_FIELD_NUMBER: _ClassVar[int]
    HARNESS_BREAKDOWN_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    total_agents: int
    total_sessions: int
    total_executions: int
    total_billable_cost_micros: int
    model_breakdown: _containers.RepeatedCompositeFieldContainer[_usage_pb2.ModelUsage]
    top_agents_by_cost: _containers.RepeatedCompositeFieldContainer[AgentUsageSummary]
    daily_costs: _containers.RepeatedCompositeFieldContainer[DailyCostEntry]
    harness_breakdown: _containers.RepeatedCompositeFieldContainer[HarnessCostSummary]
    def __init__(self, org_id: _Optional[str] = ..., total_agents: _Optional[int] = ..., total_sessions: _Optional[int] = ..., total_executions: _Optional[int] = ..., total_billable_cost_micros: _Optional[int] = ..., model_breakdown: _Optional[_Iterable[_Union[_usage_pb2.ModelUsage, _Mapping]]] = ..., top_agents_by_cost: _Optional[_Iterable[_Union[AgentUsageSummary, _Mapping]]] = ..., daily_costs: _Optional[_Iterable[_Union[DailyCostEntry, _Mapping]]] = ..., harness_breakdown: _Optional[_Iterable[_Union[HarnessCostSummary, _Mapping]]] = ...) -> None: ...

class ExecutionUsageSummary(_message.Message):
    __slots__ = ("execution_id", "started_at", "completed_at", "input_tokens", "output_tokens", "cache_read_input_tokens", "billable_cost_micros", "primary_model", "sub_agent_count", "phase", "is_estimated")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_READ_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    BILLABLE_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    PRIMARY_MODEL_FIELD_NUMBER: _ClassVar[int]
    SUB_AGENT_COUNT_FIELD_NUMBER: _ClassVar[int]
    PHASE_FIELD_NUMBER: _ClassVar[int]
    IS_ESTIMATED_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    started_at: str
    completed_at: str
    input_tokens: int
    output_tokens: int
    cache_read_input_tokens: int
    billable_cost_micros: int
    primary_model: str
    sub_agent_count: int
    phase: _enum_pb2.ExecutionPhase
    is_estimated: bool
    def __init__(self, execution_id: _Optional[str] = ..., started_at: _Optional[str] = ..., completed_at: _Optional[str] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ..., cache_read_input_tokens: _Optional[int] = ..., billable_cost_micros: _Optional[int] = ..., primary_model: _Optional[str] = ..., sub_agent_count: _Optional[int] = ..., phase: _Optional[_Union[_enum_pb2.ExecutionPhase, str]] = ..., is_estimated: bool = ...) -> None: ...

class SessionUsageSummary(_message.Message):
    __slots__ = ("session_id", "execution_count", "total_tokens", "billable_cost_micros", "first_execution_at", "last_execution_at")
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_COUNT_FIELD_NUMBER: _ClassVar[int]
    TOTAL_TOKENS_FIELD_NUMBER: _ClassVar[int]
    BILLABLE_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    FIRST_EXECUTION_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_EXECUTION_AT_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    execution_count: int
    total_tokens: int
    billable_cost_micros: int
    first_execution_at: str
    last_execution_at: str
    def __init__(self, session_id: _Optional[str] = ..., execution_count: _Optional[int] = ..., total_tokens: _Optional[int] = ..., billable_cost_micros: _Optional[int] = ..., first_execution_at: _Optional[str] = ..., last_execution_at: _Optional[str] = ...) -> None: ...

class AgentUsageSummary(_message.Message):
    __slots__ = ("agent_id", "agent_name", "execution_count", "total_tokens", "billable_cost_micros")
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_NAME_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_COUNT_FIELD_NUMBER: _ClassVar[int]
    TOTAL_TOKENS_FIELD_NUMBER: _ClassVar[int]
    BILLABLE_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    agent_id: str
    agent_name: str
    execution_count: int
    total_tokens: int
    billable_cost_micros: int
    def __init__(self, agent_id: _Optional[str] = ..., agent_name: _Optional[str] = ..., execution_count: _Optional[int] = ..., total_tokens: _Optional[int] = ..., billable_cost_micros: _Optional[int] = ...) -> None: ...

class DailyCostEntry(_message.Message):
    __slots__ = ("date", "execution_count", "total_tokens", "billable_cost_micros")
    DATE_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_COUNT_FIELD_NUMBER: _ClassVar[int]
    TOTAL_TOKENS_FIELD_NUMBER: _ClassVar[int]
    BILLABLE_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    date: str
    execution_count: int
    total_tokens: int
    billable_cost_micros: int
    def __init__(self, date: _Optional[str] = ..., execution_count: _Optional[int] = ..., total_tokens: _Optional[int] = ..., billable_cost_micros: _Optional[int] = ...) -> None: ...

class HarnessCostSummary(_message.Message):
    __slots__ = ("harness", "billable_cost_micros", "call_count", "execution_count")
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    BILLABLE_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    CALL_COUNT_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_COUNT_FIELD_NUMBER: _ClassVar[int]
    harness: str
    billable_cost_micros: int
    call_count: int
    execution_count: int
    def __init__(self, harness: _Optional[str] = ..., billable_cost_micros: _Optional[int] = ..., call_count: _Optional[int] = ..., execution_count: _Optional[int] = ...) -> None: ...

class GetAgentExecutionSummaryRequest(_message.Message):
    __slots__ = ("org", "time_window")
    ORG_FIELD_NUMBER: _ClassVar[int]
    TIME_WINDOW_FIELD_NUMBER: _ClassVar[int]
    org: str
    time_window: AgentExecutionSummaryTimeWindow
    def __init__(self, org: _Optional[str] = ..., time_window: _Optional[_Union[AgentExecutionSummaryTimeWindow, str]] = ...) -> None: ...

class AgentExecutionSummary(_message.Message):
    __slots__ = ("active_count", "phase_counts", "avg_duration", "top_failing_agents")
    class PhaseCountsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: int
        value: int
        def __init__(self, key: _Optional[int] = ..., value: _Optional[int] = ...) -> None: ...
    ACTIVE_COUNT_FIELD_NUMBER: _ClassVar[int]
    PHASE_COUNTS_FIELD_NUMBER: _ClassVar[int]
    AVG_DURATION_FIELD_NUMBER: _ClassVar[int]
    TOP_FAILING_AGENTS_FIELD_NUMBER: _ClassVar[int]
    active_count: int
    phase_counts: _containers.ScalarMap[int, int]
    avg_duration: _duration_pb2.Duration
    top_failing_agents: _containers.RepeatedCompositeFieldContainer[AgentFailureRank]
    def __init__(self, active_count: _Optional[int] = ..., phase_counts: _Optional[_Mapping[int, int]] = ..., avg_duration: _Optional[_Union[datetime.timedelta, _duration_pb2.Duration, _Mapping]] = ..., top_failing_agents: _Optional[_Iterable[_Union[AgentFailureRank, _Mapping]]] = ...) -> None: ...

class AgentFailureRank(_message.Message):
    __slots__ = ("agent_slug", "agent_name", "failure_count")
    AGENT_SLUG_FIELD_NUMBER: _ClassVar[int]
    AGENT_NAME_FIELD_NUMBER: _ClassVar[int]
    FAILURE_COUNT_FIELD_NUMBER: _ClassVar[int]
    agent_slug: str
    agent_name: str
    failure_count: int
    def __init__(self, agent_slug: _Optional[str] = ..., agent_name: _Optional[str] = ..., failure_count: _Optional[int] = ...) -> None: ...
