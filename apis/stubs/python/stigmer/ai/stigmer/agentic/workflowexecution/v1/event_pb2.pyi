from ai.stigmer.agentic.agentexecution.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.workflow.v1 import enum_pb2 as _enum_pb2_1
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class WorkflowEventType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    workflow_event_type_unspecified: _ClassVar[WorkflowEventType]
    execution_started: _ClassVar[WorkflowEventType]
    execution_completed: _ClassVar[WorkflowEventType]
    execution_failed: _ClassVar[WorkflowEventType]
    execution_paused: _ClassVar[WorkflowEventType]
    execution_resumed: _ClassVar[WorkflowEventType]
    execution_cancelled: _ClassVar[WorkflowEventType]
    execution_terminated: _ClassVar[WorkflowEventType]
    task_started: _ClassVar[WorkflowEventType]
    task_completed: _ClassVar[WorkflowEventType]
    task_failed: _ClassVar[WorkflowEventType]
    task_skipped: _ClassVar[WorkflowEventType]
    task_retrying: _ClassVar[WorkflowEventType]
    agent_call_started: _ClassVar[WorkflowEventType]
    agent_call_progress: _ClassVar[WorkflowEventType]
    agent_call_completed: _ClassVar[WorkflowEventType]
    approval_requested: _ClassVar[WorkflowEventType]
    approval_resolved: _ClassVar[WorkflowEventType]
    budget_checkpoint: _ClassVar[WorkflowEventType]
    signal_received: _ClassVar[WorkflowEventType]
    event_emitted: _ClassVar[WorkflowEventType]
    artifact_created: _ClassVar[WorkflowEventType]
workflow_event_type_unspecified: WorkflowEventType
execution_started: WorkflowEventType
execution_completed: WorkflowEventType
execution_failed: WorkflowEventType
execution_paused: WorkflowEventType
execution_resumed: WorkflowEventType
execution_cancelled: WorkflowEventType
execution_terminated: WorkflowEventType
task_started: WorkflowEventType
task_completed: WorkflowEventType
task_failed: WorkflowEventType
task_skipped: WorkflowEventType
task_retrying: WorkflowEventType
agent_call_started: WorkflowEventType
agent_call_progress: WorkflowEventType
agent_call_completed: WorkflowEventType
approval_requested: WorkflowEventType
approval_resolved: WorkflowEventType
budget_checkpoint: WorkflowEventType
signal_received: WorkflowEventType
event_emitted: WorkflowEventType
artifact_created: WorkflowEventType

class WorkflowExecutionEvent(_message.Message):
    __slots__ = ("event_id", "event_type", "sequence_number", "occurred_at", "task_name", "execution_started", "execution_completed", "execution_failed", "execution_paused", "execution_resumed", "execution_cancelled", "execution_terminated", "task_started", "task_completed", "task_failed", "task_skipped", "task_retrying", "agent_call_started", "agent_call_progress", "agent_call_completed", "approval_requested", "approval_resolved", "budget_checkpoint", "signal_received", "event_emitted", "artifact_created")
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    EVENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    SEQUENCE_NUMBER_FIELD_NUMBER: _ClassVar[int]
    OCCURRED_AT_FIELD_NUMBER: _ClassVar[int]
    TASK_NAME_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_STARTED_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_COMPLETED_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_FAILED_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_PAUSED_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_RESUMED_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_CANCELLED_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_TERMINATED_FIELD_NUMBER: _ClassVar[int]
    TASK_STARTED_FIELD_NUMBER: _ClassVar[int]
    TASK_COMPLETED_FIELD_NUMBER: _ClassVar[int]
    TASK_FAILED_FIELD_NUMBER: _ClassVar[int]
    TASK_SKIPPED_FIELD_NUMBER: _ClassVar[int]
    TASK_RETRYING_FIELD_NUMBER: _ClassVar[int]
    AGENT_CALL_STARTED_FIELD_NUMBER: _ClassVar[int]
    AGENT_CALL_PROGRESS_FIELD_NUMBER: _ClassVar[int]
    AGENT_CALL_COMPLETED_FIELD_NUMBER: _ClassVar[int]
    APPROVAL_REQUESTED_FIELD_NUMBER: _ClassVar[int]
    APPROVAL_RESOLVED_FIELD_NUMBER: _ClassVar[int]
    BUDGET_CHECKPOINT_FIELD_NUMBER: _ClassVar[int]
    SIGNAL_RECEIVED_FIELD_NUMBER: _ClassVar[int]
    EVENT_EMITTED_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_CREATED_FIELD_NUMBER: _ClassVar[int]
    event_id: str
    event_type: WorkflowEventType
    sequence_number: int
    occurred_at: str
    task_name: str
    execution_started: ExecutionStartedPayload
    execution_completed: ExecutionCompletedPayload
    execution_failed: ExecutionFailedPayload
    execution_paused: ExecutionPausedPayload
    execution_resumed: ExecutionResumedPayload
    execution_cancelled: ExecutionCancelledPayload
    execution_terminated: ExecutionTerminatedPayload
    task_started: TaskStartedPayload
    task_completed: TaskCompletedPayload
    task_failed: TaskFailedPayload
    task_skipped: TaskSkippedPayload
    task_retrying: TaskRetryingPayload
    agent_call_started: AgentCallStartedPayload
    agent_call_progress: AgentCallProgressPayload
    agent_call_completed: AgentCallCompletedPayload
    approval_requested: ApprovalRequestedPayload
    approval_resolved: ApprovalResolvedPayload
    budget_checkpoint: BudgetCheckpointPayload
    signal_received: SignalReceivedPayload
    event_emitted: EventEmittedPayload
    artifact_created: ArtifactCreatedPayload
    def __init__(self, event_id: _Optional[str] = ..., event_type: _Optional[_Union[WorkflowEventType, str]] = ..., sequence_number: _Optional[int] = ..., occurred_at: _Optional[str] = ..., task_name: _Optional[str] = ..., execution_started: _Optional[_Union[ExecutionStartedPayload, _Mapping]] = ..., execution_completed: _Optional[_Union[ExecutionCompletedPayload, _Mapping]] = ..., execution_failed: _Optional[_Union[ExecutionFailedPayload, _Mapping]] = ..., execution_paused: _Optional[_Union[ExecutionPausedPayload, _Mapping]] = ..., execution_resumed: _Optional[_Union[ExecutionResumedPayload, _Mapping]] = ..., execution_cancelled: _Optional[_Union[ExecutionCancelledPayload, _Mapping]] = ..., execution_terminated: _Optional[_Union[ExecutionTerminatedPayload, _Mapping]] = ..., task_started: _Optional[_Union[TaskStartedPayload, _Mapping]] = ..., task_completed: _Optional[_Union[TaskCompletedPayload, _Mapping]] = ..., task_failed: _Optional[_Union[TaskFailedPayload, _Mapping]] = ..., task_skipped: _Optional[_Union[TaskSkippedPayload, _Mapping]] = ..., task_retrying: _Optional[_Union[TaskRetryingPayload, _Mapping]] = ..., agent_call_started: _Optional[_Union[AgentCallStartedPayload, _Mapping]] = ..., agent_call_progress: _Optional[_Union[AgentCallProgressPayload, _Mapping]] = ..., agent_call_completed: _Optional[_Union[AgentCallCompletedPayload, _Mapping]] = ..., approval_requested: _Optional[_Union[ApprovalRequestedPayload, _Mapping]] = ..., approval_resolved: _Optional[_Union[ApprovalResolvedPayload, _Mapping]] = ..., budget_checkpoint: _Optional[_Union[BudgetCheckpointPayload, _Mapping]] = ..., signal_received: _Optional[_Union[SignalReceivedPayload, _Mapping]] = ..., event_emitted: _Optional[_Union[EventEmittedPayload, _Mapping]] = ..., artifact_created: _Optional[_Union[ArtifactCreatedPayload, _Mapping]] = ...) -> None: ...

class ExecutionStartedPayload(_message.Message):
    __slots__ = ("total_tasks", "workflow_id", "workflow_instance_id")
    TOTAL_TASKS_FIELD_NUMBER: _ClassVar[int]
    WORKFLOW_ID_FIELD_NUMBER: _ClassVar[int]
    WORKFLOW_INSTANCE_ID_FIELD_NUMBER: _ClassVar[int]
    total_tasks: int
    workflow_id: str
    workflow_instance_id: str
    def __init__(self, total_tasks: _Optional[int] = ..., workflow_id: _Optional[str] = ..., workflow_instance_id: _Optional[str] = ...) -> None: ...

class ExecutionCompletedPayload(_message.Message):
    __slots__ = ("output_summary", "duration_ms", "total_cost_micros", "total_tokens")
    OUTPUT_SUMMARY_FIELD_NUMBER: _ClassVar[int]
    DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_TOKENS_FIELD_NUMBER: _ClassVar[int]
    output_summary: _struct_pb2.Struct
    duration_ms: int
    total_cost_micros: int
    total_tokens: int
    def __init__(self, output_summary: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., duration_ms: _Optional[int] = ..., total_cost_micros: _Optional[int] = ..., total_tokens: _Optional[int] = ...) -> None: ...

class ExecutionFailedPayload(_message.Message):
    __slots__ = ("error", "failed_task_name", "duration_ms")
    ERROR_FIELD_NUMBER: _ClassVar[int]
    FAILED_TASK_NAME_FIELD_NUMBER: _ClassVar[int]
    DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    error: str
    failed_task_name: str
    duration_ms: int
    def __init__(self, error: _Optional[str] = ..., failed_task_name: _Optional[str] = ..., duration_ms: _Optional[int] = ...) -> None: ...

class ExecutionPausedPayload(_message.Message):
    __slots__ = ("reason", "paused_by")
    REASON_FIELD_NUMBER: _ClassVar[int]
    PAUSED_BY_FIELD_NUMBER: _ClassVar[int]
    reason: str
    paused_by: str
    def __init__(self, reason: _Optional[str] = ..., paused_by: _Optional[str] = ...) -> None: ...

class ExecutionResumedPayload(_message.Message):
    __slots__ = ("resumed_by",)
    RESUMED_BY_FIELD_NUMBER: _ClassVar[int]
    resumed_by: str
    def __init__(self, resumed_by: _Optional[str] = ...) -> None: ...

class ExecutionCancelledPayload(_message.Message):
    __slots__ = ("reason", "cancelled_by")
    REASON_FIELD_NUMBER: _ClassVar[int]
    CANCELLED_BY_FIELD_NUMBER: _ClassVar[int]
    reason: str
    cancelled_by: str
    def __init__(self, reason: _Optional[str] = ..., cancelled_by: _Optional[str] = ...) -> None: ...

class ExecutionTerminatedPayload(_message.Message):
    __slots__ = ("reason", "terminated_by")
    REASON_FIELD_NUMBER: _ClassVar[int]
    TERMINATED_BY_FIELD_NUMBER: _ClassVar[int]
    reason: str
    terminated_by: str
    def __init__(self, reason: _Optional[str] = ..., terminated_by: _Optional[str] = ...) -> None: ...

class TaskStartedPayload(_message.Message):
    __slots__ = ("task_kind", "input_summary", "attempt_number")
    TASK_KIND_FIELD_NUMBER: _ClassVar[int]
    INPUT_SUMMARY_FIELD_NUMBER: _ClassVar[int]
    ATTEMPT_NUMBER_FIELD_NUMBER: _ClassVar[int]
    task_kind: _enum_pb2_1.WorkflowTaskKind
    input_summary: _struct_pb2.Struct
    attempt_number: int
    def __init__(self, task_kind: _Optional[_Union[_enum_pb2_1.WorkflowTaskKind, str]] = ..., input_summary: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., attempt_number: _Optional[int] = ...) -> None: ...

class TaskCompletedPayload(_message.Message):
    __slots__ = ("task_kind", "duration_ms", "output_summary", "cost_micros", "tokens_used")
    TASK_KIND_FIELD_NUMBER: _ClassVar[int]
    DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_SUMMARY_FIELD_NUMBER: _ClassVar[int]
    COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    TOKENS_USED_FIELD_NUMBER: _ClassVar[int]
    task_kind: _enum_pb2_1.WorkflowTaskKind
    duration_ms: int
    output_summary: _struct_pb2.Struct
    cost_micros: int
    tokens_used: int
    def __init__(self, task_kind: _Optional[_Union[_enum_pb2_1.WorkflowTaskKind, str]] = ..., duration_ms: _Optional[int] = ..., output_summary: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., cost_micros: _Optional[int] = ..., tokens_used: _Optional[int] = ...) -> None: ...

class TaskFailedPayload(_message.Message):
    __slots__ = ("task_kind", "error", "attempt_number", "max_attempts", "will_retry", "duration_ms")
    TASK_KIND_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    ATTEMPT_NUMBER_FIELD_NUMBER: _ClassVar[int]
    MAX_ATTEMPTS_FIELD_NUMBER: _ClassVar[int]
    WILL_RETRY_FIELD_NUMBER: _ClassVar[int]
    DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    task_kind: _enum_pb2_1.WorkflowTaskKind
    error: str
    attempt_number: int
    max_attempts: int
    will_retry: bool
    duration_ms: int
    def __init__(self, task_kind: _Optional[_Union[_enum_pb2_1.WorkflowTaskKind, str]] = ..., error: _Optional[str] = ..., attempt_number: _Optional[int] = ..., max_attempts: _Optional[int] = ..., will_retry: bool = ..., duration_ms: _Optional[int] = ...) -> None: ...

class TaskSkippedPayload(_message.Message):
    __slots__ = ("task_kind", "reason")
    TASK_KIND_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    task_kind: _enum_pb2_1.WorkflowTaskKind
    reason: str
    def __init__(self, task_kind: _Optional[_Union[_enum_pb2_1.WorkflowTaskKind, str]] = ..., reason: _Optional[str] = ...) -> None: ...

class TaskRetryingPayload(_message.Message):
    __slots__ = ("failed_attempt", "next_attempt", "delay_ms")
    FAILED_ATTEMPT_FIELD_NUMBER: _ClassVar[int]
    NEXT_ATTEMPT_FIELD_NUMBER: _ClassVar[int]
    DELAY_MS_FIELD_NUMBER: _ClassVar[int]
    failed_attempt: int
    next_attempt: int
    delay_ms: int
    def __init__(self, failed_attempt: _Optional[int] = ..., next_attempt: _Optional[int] = ..., delay_ms: _Optional[int] = ...) -> None: ...

class AgentCallStartedPayload(_message.Message):
    __slots__ = ("child_execution_id", "agent_slug", "message_summary")
    CHILD_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_SLUG_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_SUMMARY_FIELD_NUMBER: _ClassVar[int]
    child_execution_id: str
    agent_slug: str
    message_summary: str
    def __init__(self, child_execution_id: _Optional[str] = ..., agent_slug: _Optional[str] = ..., message_summary: _Optional[str] = ...) -> None: ...

class AgentCallProgressPayload(_message.Message):
    __slots__ = ("child_execution_id", "agent_phase", "current_tool_name", "tokens_consumed", "messages_count", "tool_calls_count")
    CHILD_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_PHASE_FIELD_NUMBER: _ClassVar[int]
    CURRENT_TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    TOKENS_CONSUMED_FIELD_NUMBER: _ClassVar[int]
    MESSAGES_COUNT_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALLS_COUNT_FIELD_NUMBER: _ClassVar[int]
    child_execution_id: str
    agent_phase: _enum_pb2.ExecutionPhase
    current_tool_name: str
    tokens_consumed: int
    messages_count: int
    tool_calls_count: int
    def __init__(self, child_execution_id: _Optional[str] = ..., agent_phase: _Optional[_Union[_enum_pb2.ExecutionPhase, str]] = ..., current_tool_name: _Optional[str] = ..., tokens_consumed: _Optional[int] = ..., messages_count: _Optional[int] = ..., tool_calls_count: _Optional[int] = ...) -> None: ...

class AgentCallCompletedPayload(_message.Message):
    __slots__ = ("child_execution_id", "agent_phase", "duration_ms", "tokens_consumed", "cost_micros", "error")
    CHILD_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_PHASE_FIELD_NUMBER: _ClassVar[int]
    DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    TOKENS_CONSUMED_FIELD_NUMBER: _ClassVar[int]
    COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    child_execution_id: str
    agent_phase: _enum_pb2.ExecutionPhase
    duration_ms: int
    tokens_consumed: int
    cost_micros: int
    error: str
    def __init__(self, child_execution_id: _Optional[str] = ..., agent_phase: _Optional[_Union[_enum_pb2.ExecutionPhase, str]] = ..., duration_ms: _Optional[int] = ..., tokens_consumed: _Optional[int] = ..., cost_micros: _Optional[int] = ..., error: _Optional[str] = ...) -> None: ...

class HumanInputOutcomeInfo(_message.Message):
    __slots__ = ("name", "label")
    NAME_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    name: str
    label: str
    def __init__(self, name: _Optional[str] = ..., label: _Optional[str] = ...) -> None: ...

class ApprovalRequestedPayload(_message.Message):
    __slots__ = ("prompt", "approvers", "timeout_seconds", "tool_call_id", "child_execution_id", "outcomes", "form_schema", "payload", "ui_hint", "payload_artifact_id")
    PROMPT_FIELD_NUMBER: _ClassVar[int]
    APPROVERS_FIELD_NUMBER: _ClassVar[int]
    TIMEOUT_SECONDS_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    CHILD_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    OUTCOMES_FIELD_NUMBER: _ClassVar[int]
    FORM_SCHEMA_FIELD_NUMBER: _ClassVar[int]
    PAYLOAD_FIELD_NUMBER: _ClassVar[int]
    UI_HINT_FIELD_NUMBER: _ClassVar[int]
    PAYLOAD_ARTIFACT_ID_FIELD_NUMBER: _ClassVar[int]
    prompt: str
    approvers: _containers.RepeatedScalarFieldContainer[str]
    timeout_seconds: int
    tool_call_id: str
    child_execution_id: str
    outcomes: _containers.RepeatedCompositeFieldContainer[HumanInputOutcomeInfo]
    form_schema: _struct_pb2.Struct
    payload: _struct_pb2.Value
    ui_hint: str
    payload_artifact_id: str
    def __init__(self, prompt: _Optional[str] = ..., approvers: _Optional[_Iterable[str]] = ..., timeout_seconds: _Optional[int] = ..., tool_call_id: _Optional[str] = ..., child_execution_id: _Optional[str] = ..., outcomes: _Optional[_Iterable[_Union[HumanInputOutcomeInfo, _Mapping]]] = ..., form_schema: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., payload: _Optional[_Union[_struct_pb2.Value, _Mapping]] = ..., ui_hint: _Optional[str] = ..., payload_artifact_id: _Optional[str] = ...) -> None: ...

class ApprovalResolvedPayload(_message.Message):
    __slots__ = ("action", "resolved_by", "comment", "wait_duration_ms")
    ACTION_FIELD_NUMBER: _ClassVar[int]
    RESOLVED_BY_FIELD_NUMBER: _ClassVar[int]
    COMMENT_FIELD_NUMBER: _ClassVar[int]
    WAIT_DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    action: _enum_pb2.ApprovalAction
    resolved_by: str
    comment: str
    wait_duration_ms: int
    def __init__(self, action: _Optional[_Union[_enum_pb2.ApprovalAction, str]] = ..., resolved_by: _Optional[str] = ..., comment: _Optional[str] = ..., wait_duration_ms: _Optional[int] = ...) -> None: ...

class BudgetCheckpointPayload(_message.Message):
    __slots__ = ("cost_consumed_micros", "cost_remaining_micros", "tokens_consumed", "tokens_remaining", "threshold_breached", "on_exceeded_policy")
    COST_CONSUMED_MICROS_FIELD_NUMBER: _ClassVar[int]
    COST_REMAINING_MICROS_FIELD_NUMBER: _ClassVar[int]
    TOKENS_CONSUMED_FIELD_NUMBER: _ClassVar[int]
    TOKENS_REMAINING_FIELD_NUMBER: _ClassVar[int]
    THRESHOLD_BREACHED_FIELD_NUMBER: _ClassVar[int]
    ON_EXCEEDED_POLICY_FIELD_NUMBER: _ClassVar[int]
    cost_consumed_micros: int
    cost_remaining_micros: int
    tokens_consumed: int
    tokens_remaining: int
    threshold_breached: bool
    on_exceeded_policy: _enum_pb2_1.BudgetExceededPolicy
    def __init__(self, cost_consumed_micros: _Optional[int] = ..., cost_remaining_micros: _Optional[int] = ..., tokens_consumed: _Optional[int] = ..., tokens_remaining: _Optional[int] = ..., threshold_breached: bool = ..., on_exceeded_policy: _Optional[_Union[_enum_pb2_1.BudgetExceededPolicy, str]] = ...) -> None: ...

class SignalReceivedPayload(_message.Message):
    __slots__ = ("signal_name", "payload_summary")
    SIGNAL_NAME_FIELD_NUMBER: _ClassVar[int]
    PAYLOAD_SUMMARY_FIELD_NUMBER: _ClassVar[int]
    signal_name: str
    payload_summary: _struct_pb2.Struct
    def __init__(self, signal_name: _Optional[str] = ..., payload_summary: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...) -> None: ...

class EventEmittedPayload(_message.Message):
    __slots__ = ("event_type", "event_source", "event_subject")
    EVENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    EVENT_SOURCE_FIELD_NUMBER: _ClassVar[int]
    EVENT_SUBJECT_FIELD_NUMBER: _ClassVar[int]
    event_type: str
    event_source: str
    event_subject: str
    def __init__(self, event_type: _Optional[str] = ..., event_source: _Optional[str] = ..., event_subject: _Optional[str] = ...) -> None: ...

class ArtifactCreatedPayload(_message.Message):
    __slots__ = ("artifact_id", "display_name", "content_type", "size_bytes")
    ARTIFACT_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    artifact_id: str
    display_name: str
    content_type: str
    size_bytes: int
    def __init__(self, artifact_id: _Optional[str] = ..., display_name: _Optional[str] = ..., content_type: _Optional[str] = ..., size_bytes: _Optional[int] = ...) -> None: ...
