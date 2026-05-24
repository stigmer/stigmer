import datetime

from ai.stigmer.agentic.agentexecution.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.workflowexecution.v1 import api_pb2 as _api_pb2
from ai.stigmer.agentic.workflowexecution.v1 import enum_pb2 as _enum_pb2_1
from ai.stigmer.agentic.workflowexecution.v1 import event_pb2 as _event_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import duration_pb2 as _duration_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ExecutionSortField(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    EXECUTION_SORT_FIELD_UNSPECIFIED: _ClassVar[ExecutionSortField]
    EXECUTION_SORT_FIELD_STARTED_AT: _ClassVar[ExecutionSortField]
    EXECUTION_SORT_FIELD_DURATION: _ClassVar[ExecutionSortField]
    EXECUTION_SORT_FIELD_COST: _ClassVar[ExecutionSortField]
    EXECUTION_SORT_FIELD_STATUS: _ClassVar[ExecutionSortField]

class SummaryTimeWindow(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SUMMARY_TIME_WINDOW_UNSPECIFIED: _ClassVar[SummaryTimeWindow]
    SUMMARY_TIME_WINDOW_LAST_24H: _ClassVar[SummaryTimeWindow]
    SUMMARY_TIME_WINDOW_LAST_7D: _ClassVar[SummaryTimeWindow]
    SUMMARY_TIME_WINDOW_LAST_30D: _ClassVar[SummaryTimeWindow]
    SUMMARY_TIME_WINDOW_ALL_TIME: _ClassVar[SummaryTimeWindow]
EXECUTION_SORT_FIELD_UNSPECIFIED: ExecutionSortField
EXECUTION_SORT_FIELD_STARTED_AT: ExecutionSortField
EXECUTION_SORT_FIELD_DURATION: ExecutionSortField
EXECUTION_SORT_FIELD_COST: ExecutionSortField
EXECUTION_SORT_FIELD_STATUS: ExecutionSortField
SUMMARY_TIME_WINDOW_UNSPECIFIED: SummaryTimeWindow
SUMMARY_TIME_WINDOW_LAST_24H: SummaryTimeWindow
SUMMARY_TIME_WINDOW_LAST_7D: SummaryTimeWindow
SUMMARY_TIME_WINDOW_LAST_30D: SummaryTimeWindow
SUMMARY_TIME_WINDOW_ALL_TIME: SummaryTimeWindow

class WorkflowExecutionId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class WorkflowId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class WorkflowExecutionList(_message.Message):
    __slots__ = ("total_pages", "entries")
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    total_pages: int
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.WorkflowExecution]
    def __init__(self, total_pages: _Optional[int] = ..., entries: _Optional[_Iterable[_Union[_api_pb2.WorkflowExecution, _Mapping]]] = ...) -> None: ...

class ListWorkflowExecutionsRequest(_message.Message):
    __slots__ = ("page_size", "page_token", "phase", "tags", "filter", "sort_field", "sort_ascending")
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    PHASE_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    FILTER_FIELD_NUMBER: _ClassVar[int]
    SORT_FIELD_FIELD_NUMBER: _ClassVar[int]
    SORT_ASCENDING_FIELD_NUMBER: _ClassVar[int]
    page_size: int
    page_token: str
    phase: _enum_pb2_1.ExecutionPhase
    tags: _containers.RepeatedScalarFieldContainer[str]
    filter: ExecutionFilterCriteria
    sort_field: ExecutionSortField
    sort_ascending: bool
    def __init__(self, page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., phase: _Optional[_Union[_enum_pb2_1.ExecutionPhase, str]] = ..., tags: _Optional[_Iterable[str]] = ..., filter: _Optional[_Union[ExecutionFilterCriteria, _Mapping]] = ..., sort_field: _Optional[_Union[ExecutionSortField, str]] = ..., sort_ascending: bool = ...) -> None: ...

class ListWorkflowExecutionsByWorkflowRequest(_message.Message):
    __slots__ = ("workflow_id", "page_size", "page_token", "filter", "sort_field", "sort_ascending")
    WORKFLOW_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    FILTER_FIELD_NUMBER: _ClassVar[int]
    SORT_FIELD_FIELD_NUMBER: _ClassVar[int]
    SORT_ASCENDING_FIELD_NUMBER: _ClassVar[int]
    workflow_id: str
    page_size: int
    page_token: str
    filter: ExecutionFilterCriteria
    sort_field: ExecutionSortField
    sort_ascending: bool
    def __init__(self, workflow_id: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., filter: _Optional[_Union[ExecutionFilterCriteria, _Mapping]] = ..., sort_field: _Optional[_Union[ExecutionSortField, str]] = ..., sort_ascending: bool = ...) -> None: ...

class WorkflowExecutionUpdateStatusInput(_message.Message):
    __slots__ = ("execution_id", "status", "events")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    EVENTS_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    status: _api_pb2.WorkflowExecutionStatus
    events: _containers.RepeatedCompositeFieldContainer[_event_pb2.WorkflowExecutionEvent]
    def __init__(self, execution_id: _Optional[str] = ..., status: _Optional[_Union[_api_pb2.WorkflowExecutionStatus, _Mapping]] = ..., events: _Optional[_Iterable[_Union[_event_pb2.WorkflowExecutionEvent, _Mapping]]] = ...) -> None: ...

class SubmitWorkflowApprovalInput(_message.Message):
    __slots__ = ("execution_id", "tool_call_id", "action", "comment")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    COMMENT_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    tool_call_id: str
    action: _enum_pb2.ApprovalAction
    comment: str
    def __init__(self, execution_id: _Optional[str] = ..., tool_call_id: _Optional[str] = ..., action: _Optional[_Union[_enum_pb2.ApprovalAction, str]] = ..., comment: _Optional[str] = ...) -> None: ...

class SubmitWorkflowTaskApprovalInput(_message.Message):
    __slots__ = ("execution_id", "task_name", "outcome", "form_data", "reviewer", "comment")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_NAME_FIELD_NUMBER: _ClassVar[int]
    OUTCOME_FIELD_NUMBER: _ClassVar[int]
    FORM_DATA_FIELD_NUMBER: _ClassVar[int]
    REVIEWER_FIELD_NUMBER: _ClassVar[int]
    COMMENT_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    task_name: str
    outcome: str
    form_data: _struct_pb2.Struct
    reviewer: str
    comment: str
    def __init__(self, execution_id: _Optional[str] = ..., task_name: _Optional[str] = ..., outcome: _Optional[str] = ..., form_data: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., reviewer: _Optional[str] = ..., comment: _Optional[str] = ...) -> None: ...

class SubscribeWorkflowExecutionRequest(_message.Message):
    __slots__ = ("execution_id",)
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    def __init__(self, execution_id: _Optional[str] = ...) -> None: ...

class CancelWorkflowExecutionInput(_message.Message):
    __slots__ = ("id", "reason")
    ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    id: str
    reason: str
    def __init__(self, id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class TerminateWorkflowExecutionInput(_message.Message):
    __slots__ = ("id", "reason")
    ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    id: str
    reason: str
    def __init__(self, id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class RecoverWorkflowExecutionInput(_message.Message):
    __slots__ = ("id", "reason")
    ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    id: str
    reason: str
    def __init__(self, id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class PauseWorkflowExecutionInput(_message.Message):
    __slots__ = ("id", "reason")
    ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    id: str
    reason: str
    def __init__(self, id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class ResumeWorkflowExecutionInput(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class SendSignalInput(_message.Message):
    __slots__ = ("execution_id", "signal_name", "payload", "idempotency_key")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    SIGNAL_NAME_FIELD_NUMBER: _ClassVar[int]
    PAYLOAD_FIELD_NUMBER: _ClassVar[int]
    IDEMPOTENCY_KEY_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    signal_name: str
    payload: _struct_pb2.Struct
    idempotency_key: str
    def __init__(self, execution_id: _Optional[str] = ..., signal_name: _Optional[str] = ..., payload: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., idempotency_key: _Optional[str] = ...) -> None: ...

class GetEventLogRequest(_message.Message):
    __slots__ = ("execution_id", "after_sequence", "event_types", "task_name", "page_size")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    AFTER_SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    EVENT_TYPES_FIELD_NUMBER: _ClassVar[int]
    TASK_NAME_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    after_sequence: int
    event_types: _containers.RepeatedScalarFieldContainer[_event_pb2.WorkflowEventType]
    task_name: str
    page_size: int
    def __init__(self, execution_id: _Optional[str] = ..., after_sequence: _Optional[int] = ..., event_types: _Optional[_Iterable[_Union[_event_pb2.WorkflowEventType, str]]] = ..., task_name: _Optional[str] = ..., page_size: _Optional[int] = ...) -> None: ...

class GetEventLogResponse(_message.Message):
    __slots__ = ("events", "has_more", "latest_sequence")
    EVENTS_FIELD_NUMBER: _ClassVar[int]
    HAS_MORE_FIELD_NUMBER: _ClassVar[int]
    LATEST_SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    events: _containers.RepeatedCompositeFieldContainer[_event_pb2.WorkflowExecutionEvent]
    has_more: bool
    latest_sequence: int
    def __init__(self, events: _Optional[_Iterable[_Union[_event_pb2.WorkflowExecutionEvent, _Mapping]]] = ..., has_more: bool = ..., latest_sequence: _Optional[int] = ...) -> None: ...

class SubscribeEventsRequest(_message.Message):
    __slots__ = ("execution_id", "after_sequence", "event_types")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    AFTER_SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    EVENT_TYPES_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    after_sequence: int
    event_types: _containers.RepeatedScalarFieldContainer[_event_pb2.WorkflowEventType]
    def __init__(self, execution_id: _Optional[str] = ..., after_sequence: _Optional[int] = ..., event_types: _Optional[_Iterable[_Union[_event_pb2.WorkflowEventType, str]]] = ...) -> None: ...

class ExecutionFilterCriteria(_message.Message):
    __slots__ = ("phases", "started_after", "started_before", "min_duration", "max_duration", "min_cost_micros", "max_cost_micros", "failed_task_name", "has_retries")
    PHASES_FIELD_NUMBER: _ClassVar[int]
    STARTED_AFTER_FIELD_NUMBER: _ClassVar[int]
    STARTED_BEFORE_FIELD_NUMBER: _ClassVar[int]
    MIN_DURATION_FIELD_NUMBER: _ClassVar[int]
    MAX_DURATION_FIELD_NUMBER: _ClassVar[int]
    MIN_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    MAX_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    FAILED_TASK_NAME_FIELD_NUMBER: _ClassVar[int]
    HAS_RETRIES_FIELD_NUMBER: _ClassVar[int]
    phases: _containers.RepeatedScalarFieldContainer[_enum_pb2_1.ExecutionPhase]
    started_after: _timestamp_pb2.Timestamp
    started_before: _timestamp_pb2.Timestamp
    min_duration: _duration_pb2.Duration
    max_duration: _duration_pb2.Duration
    min_cost_micros: int
    max_cost_micros: int
    failed_task_name: str
    has_retries: bool
    def __init__(self, phases: _Optional[_Iterable[_Union[_enum_pb2_1.ExecutionPhase, str]]] = ..., started_after: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., started_before: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., min_duration: _Optional[_Union[datetime.timedelta, _duration_pb2.Duration, _Mapping]] = ..., max_duration: _Optional[_Union[datetime.timedelta, _duration_pb2.Duration, _Mapping]] = ..., min_cost_micros: _Optional[int] = ..., max_cost_micros: _Optional[int] = ..., failed_task_name: _Optional[str] = ..., has_retries: bool = ...) -> None: ...

class GetExecutionSummaryRequest(_message.Message):
    __slots__ = ("org", "time_window", "workflow_id")
    ORG_FIELD_NUMBER: _ClassVar[int]
    TIME_WINDOW_FIELD_NUMBER: _ClassVar[int]
    WORKFLOW_ID_FIELD_NUMBER: _ClassVar[int]
    org: str
    time_window: SummaryTimeWindow
    workflow_id: str
    def __init__(self, org: _Optional[str] = ..., time_window: _Optional[_Union[SummaryTimeWindow, str]] = ..., workflow_id: _Optional[str] = ...) -> None: ...

class ExecutionSummary(_message.Message):
    __slots__ = ("active_count", "phase_counts", "total_cost", "avg_duration", "top_failing_workflows", "cost_by_workflow", "total_count", "success_rate")
    class PhaseCountsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: int
        value: int
        def __init__(self, key: _Optional[int] = ..., value: _Optional[int] = ...) -> None: ...
    ACTIVE_COUNT_FIELD_NUMBER: _ClassVar[int]
    PHASE_COUNTS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COST_FIELD_NUMBER: _ClassVar[int]
    AVG_DURATION_FIELD_NUMBER: _ClassVar[int]
    TOP_FAILING_WORKFLOWS_FIELD_NUMBER: _ClassVar[int]
    COST_BY_WORKFLOW_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    SUCCESS_RATE_FIELD_NUMBER: _ClassVar[int]
    active_count: int
    phase_counts: _containers.ScalarMap[int, int]
    total_cost: WorkflowCostSummary
    avg_duration: _duration_pb2.Duration
    top_failing_workflows: _containers.RepeatedCompositeFieldContainer[WorkflowFailureRank]
    cost_by_workflow: _containers.RepeatedCompositeFieldContainer[WorkflowCostBreakdown]
    total_count: int
    success_rate: float
    def __init__(self, active_count: _Optional[int] = ..., phase_counts: _Optional[_Mapping[int, int]] = ..., total_cost: _Optional[_Union[WorkflowCostSummary, _Mapping]] = ..., avg_duration: _Optional[_Union[datetime.timedelta, _duration_pb2.Duration, _Mapping]] = ..., top_failing_workflows: _Optional[_Iterable[_Union[WorkflowFailureRank, _Mapping]]] = ..., cost_by_workflow: _Optional[_Iterable[_Union[WorkflowCostBreakdown, _Mapping]]] = ..., total_count: _Optional[int] = ..., success_rate: _Optional[float] = ...) -> None: ...

class WorkflowCostSummary(_message.Message):
    __slots__ = ("total_cost_usd", "total_input_tokens", "total_output_tokens")
    TOTAL_COST_USD_FIELD_NUMBER: _ClassVar[int]
    TOTAL_INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    total_cost_usd: float
    total_input_tokens: int
    total_output_tokens: int
    def __init__(self, total_cost_usd: _Optional[float] = ..., total_input_tokens: _Optional[int] = ..., total_output_tokens: _Optional[int] = ...) -> None: ...

class WorkflowFailureRank(_message.Message):
    __slots__ = ("workflow_slug", "workflow_name", "failure_count")
    WORKFLOW_SLUG_FIELD_NUMBER: _ClassVar[int]
    WORKFLOW_NAME_FIELD_NUMBER: _ClassVar[int]
    FAILURE_COUNT_FIELD_NUMBER: _ClassVar[int]
    workflow_slug: str
    workflow_name: str
    failure_count: int
    def __init__(self, workflow_slug: _Optional[str] = ..., workflow_name: _Optional[str] = ..., failure_count: _Optional[int] = ...) -> None: ...

class WorkflowCostBreakdown(_message.Message):
    __slots__ = ("workflow_slug", "workflow_name", "total_cost_usd", "execution_count")
    WORKFLOW_SLUG_FIELD_NUMBER: _ClassVar[int]
    WORKFLOW_NAME_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COST_USD_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_COUNT_FIELD_NUMBER: _ClassVar[int]
    workflow_slug: str
    workflow_name: str
    total_cost_usd: float
    execution_count: int
    def __init__(self, workflow_slug: _Optional[str] = ..., workflow_name: _Optional[str] = ..., total_cost_usd: _Optional[float] = ..., execution_count: _Optional[int] = ...) -> None: ...

class ListPendingApprovalsRequest(_message.Message):
    __slots__ = ("org", "page_size", "page_token")
    ORG_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    org: str
    page_size: int
    page_token: str
    def __init__(self, org: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

class PendingApproval(_message.Message):
    __slots__ = ("execution_id", "workflow_name", "task_name", "requester", "requested_at", "timeout_at", "form_schema")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    WORKFLOW_NAME_FIELD_NUMBER: _ClassVar[int]
    TASK_NAME_FIELD_NUMBER: _ClassVar[int]
    REQUESTER_FIELD_NUMBER: _ClassVar[int]
    REQUESTED_AT_FIELD_NUMBER: _ClassVar[int]
    TIMEOUT_AT_FIELD_NUMBER: _ClassVar[int]
    FORM_SCHEMA_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    workflow_name: str
    task_name: str
    requester: str
    requested_at: _timestamp_pb2.Timestamp
    timeout_at: _timestamp_pb2.Timestamp
    form_schema: _struct_pb2.Struct
    def __init__(self, execution_id: _Optional[str] = ..., workflow_name: _Optional[str] = ..., task_name: _Optional[str] = ..., requester: _Optional[str] = ..., requested_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., timeout_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., form_schema: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...) -> None: ...

class PendingApprovalsList(_message.Message):
    __slots__ = ("entries", "total_count", "next_page_token")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[PendingApproval]
    total_count: int
    next_page_token: str
    def __init__(self, entries: _Optional[_Iterable[_Union[PendingApproval, _Mapping]]] = ..., total_count: _Optional[int] = ..., next_page_token: _Optional[str] = ...) -> None: ...
