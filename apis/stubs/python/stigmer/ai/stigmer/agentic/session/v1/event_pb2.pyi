import datetime

from ai.stigmer.agentic.session.v1 import event_content_pb2 as _event_content_pb2
from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import duration_pb2 as _duration_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SessionEvent(_message.Message):
    __slots__ = ("seq", "session_id", "run_id", "thread_id", "user_message", "session_status_running", "session_status_idle", "session_error", "agent_message", "agent_thinking", "agent_tool_use", "agent_tool_result", "agent_mcp_tool_use", "agent_mcp_tool_result", "session_thread_created", "session_thread_status_running", "session_thread_status_idle", "agent_thread_message_sent", "agent_thread_message_received", "agent_thread_context_compacted", "user_tool_confirmation", "user_interrupt", "stigmer_agent_thinking", "stigmer_permission_asked", "stigmer_harness_note", "stigmer_agent_structured_output", "stigmer_memory_recalled", "stigmer_file_review_changes", "stigmer_file_review_decided", "stigmer_file_review_reconciled", "stigmer_permission_grant", "stigmer_run_status", "stigmer_tool_result_full_output")
    SEQ_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    THREAD_ID_FIELD_NUMBER: _ClassVar[int]
    USER_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    SESSION_STATUS_RUNNING_FIELD_NUMBER: _ClassVar[int]
    SESSION_STATUS_IDLE_FIELD_NUMBER: _ClassVar[int]
    SESSION_ERROR_FIELD_NUMBER: _ClassVar[int]
    AGENT_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    AGENT_THINKING_FIELD_NUMBER: _ClassVar[int]
    AGENT_TOOL_USE_FIELD_NUMBER: _ClassVar[int]
    AGENT_TOOL_RESULT_FIELD_NUMBER: _ClassVar[int]
    AGENT_MCP_TOOL_USE_FIELD_NUMBER: _ClassVar[int]
    AGENT_MCP_TOOL_RESULT_FIELD_NUMBER: _ClassVar[int]
    SESSION_THREAD_CREATED_FIELD_NUMBER: _ClassVar[int]
    SESSION_THREAD_STATUS_RUNNING_FIELD_NUMBER: _ClassVar[int]
    SESSION_THREAD_STATUS_IDLE_FIELD_NUMBER: _ClassVar[int]
    AGENT_THREAD_MESSAGE_SENT_FIELD_NUMBER: _ClassVar[int]
    AGENT_THREAD_MESSAGE_RECEIVED_FIELD_NUMBER: _ClassVar[int]
    AGENT_THREAD_CONTEXT_COMPACTED_FIELD_NUMBER: _ClassVar[int]
    USER_TOOL_CONFIRMATION_FIELD_NUMBER: _ClassVar[int]
    USER_INTERRUPT_FIELD_NUMBER: _ClassVar[int]
    STIGMER_AGENT_THINKING_FIELD_NUMBER: _ClassVar[int]
    STIGMER_PERMISSION_ASKED_FIELD_NUMBER: _ClassVar[int]
    STIGMER_HARNESS_NOTE_FIELD_NUMBER: _ClassVar[int]
    STIGMER_AGENT_STRUCTURED_OUTPUT_FIELD_NUMBER: _ClassVar[int]
    STIGMER_MEMORY_RECALLED_FIELD_NUMBER: _ClassVar[int]
    STIGMER_FILE_REVIEW_CHANGES_FIELD_NUMBER: _ClassVar[int]
    STIGMER_FILE_REVIEW_DECIDED_FIELD_NUMBER: _ClassVar[int]
    STIGMER_FILE_REVIEW_RECONCILED_FIELD_NUMBER: _ClassVar[int]
    STIGMER_PERMISSION_GRANT_FIELD_NUMBER: _ClassVar[int]
    STIGMER_RUN_STATUS_FIELD_NUMBER: _ClassVar[int]
    STIGMER_TOOL_RESULT_FULL_OUTPUT_FIELD_NUMBER: _ClassVar[int]
    seq: int
    session_id: str
    run_id: str
    thread_id: str
    user_message: UserMessageEvent
    session_status_running: SessionStatusRunningEvent
    session_status_idle: SessionStatusIdleEvent
    session_error: SessionErrorEvent
    agent_message: AgentMessageEvent
    agent_thinking: AgentThinkingEvent
    agent_tool_use: AgentToolUseEvent
    agent_tool_result: AgentToolResultEvent
    agent_mcp_tool_use: AgentMcpToolUseEvent
    agent_mcp_tool_result: AgentMcpToolResultEvent
    session_thread_created: SessionThreadCreatedEvent
    session_thread_status_running: SessionThreadStatusRunningEvent
    session_thread_status_idle: SessionThreadStatusIdleEvent
    agent_thread_message_sent: AgentThreadMessageSentEvent
    agent_thread_message_received: AgentThreadMessageReceivedEvent
    agent_thread_context_compacted: AgentThreadContextCompactedEvent
    user_tool_confirmation: UserToolConfirmationEvent
    user_interrupt: UserInterruptEvent
    stigmer_agent_thinking: StigmerAgentThinkingEvent
    stigmer_permission_asked: StigmerPermissionAskedEvent
    stigmer_harness_note: StigmerHarnessNoteEvent
    stigmer_agent_structured_output: StigmerAgentStructuredOutputEvent
    stigmer_memory_recalled: StigmerMemoryRecalledEvent
    stigmer_file_review_changes: StigmerFileReviewChangesEvent
    stigmer_file_review_decided: StigmerFileReviewDecidedEvent
    stigmer_file_review_reconciled: StigmerFileReviewReconciledEvent
    stigmer_permission_grant: StigmerPermissionGrantEvent
    stigmer_run_status: StigmerRunStatusEvent
    stigmer_tool_result_full_output: StigmerToolResultFullOutputEvent
    def __init__(self, seq: _Optional[int] = ..., session_id: _Optional[str] = ..., run_id: _Optional[str] = ..., thread_id: _Optional[str] = ..., user_message: _Optional[_Union[UserMessageEvent, _Mapping]] = ..., session_status_running: _Optional[_Union[SessionStatusRunningEvent, _Mapping]] = ..., session_status_idle: _Optional[_Union[SessionStatusIdleEvent, _Mapping]] = ..., session_error: _Optional[_Union[SessionErrorEvent, _Mapping]] = ..., agent_message: _Optional[_Union[AgentMessageEvent, _Mapping]] = ..., agent_thinking: _Optional[_Union[AgentThinkingEvent, _Mapping]] = ..., agent_tool_use: _Optional[_Union[AgentToolUseEvent, _Mapping]] = ..., agent_tool_result: _Optional[_Union[AgentToolResultEvent, _Mapping]] = ..., agent_mcp_tool_use: _Optional[_Union[AgentMcpToolUseEvent, _Mapping]] = ..., agent_mcp_tool_result: _Optional[_Union[AgentMcpToolResultEvent, _Mapping]] = ..., session_thread_created: _Optional[_Union[SessionThreadCreatedEvent, _Mapping]] = ..., session_thread_status_running: _Optional[_Union[SessionThreadStatusRunningEvent, _Mapping]] = ..., session_thread_status_idle: _Optional[_Union[SessionThreadStatusIdleEvent, _Mapping]] = ..., agent_thread_message_sent: _Optional[_Union[AgentThreadMessageSentEvent, _Mapping]] = ..., agent_thread_message_received: _Optional[_Union[AgentThreadMessageReceivedEvent, _Mapping]] = ..., agent_thread_context_compacted: _Optional[_Union[AgentThreadContextCompactedEvent, _Mapping]] = ..., user_tool_confirmation: _Optional[_Union[UserToolConfirmationEvent, _Mapping]] = ..., user_interrupt: _Optional[_Union[UserInterruptEvent, _Mapping]] = ..., stigmer_agent_thinking: _Optional[_Union[StigmerAgentThinkingEvent, _Mapping]] = ..., stigmer_permission_asked: _Optional[_Union[StigmerPermissionAskedEvent, _Mapping]] = ..., stigmer_harness_note: _Optional[_Union[StigmerHarnessNoteEvent, _Mapping]] = ..., stigmer_agent_structured_output: _Optional[_Union[StigmerAgentStructuredOutputEvent, _Mapping]] = ..., stigmer_memory_recalled: _Optional[_Union[StigmerMemoryRecalledEvent, _Mapping]] = ..., stigmer_file_review_changes: _Optional[_Union[StigmerFileReviewChangesEvent, _Mapping]] = ..., stigmer_file_review_decided: _Optional[_Union[StigmerFileReviewDecidedEvent, _Mapping]] = ..., stigmer_file_review_reconciled: _Optional[_Union[StigmerFileReviewReconciledEvent, _Mapping]] = ..., stigmer_permission_grant: _Optional[_Union[StigmerPermissionGrantEvent, _Mapping]] = ..., stigmer_run_status: _Optional[_Union[StigmerRunStatusEvent, _Mapping]] = ..., stigmer_tool_result_full_output: _Optional[_Union[StigmerToolResultFullOutputEvent, _Mapping]] = ...) -> None: ...

class UserMessageEvent(_message.Message):
    __slots__ = ("id", "content", "processed_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    content: _containers.RepeatedCompositeFieldContainer[_event_content_pb2.ContentBlock]
    processed_at: str
    def __init__(self, id: _Optional[str] = ..., content: _Optional[_Iterable[_Union[_event_content_pb2.ContentBlock, _Mapping]]] = ..., processed_at: _Optional[str] = ...) -> None: ...

class SessionStatusRunningEvent(_message.Message):
    __slots__ = ("id", "processed_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    processed_at: str
    def __init__(self, id: _Optional[str] = ..., processed_at: _Optional[str] = ...) -> None: ...

class SessionStatusIdleEvent(_message.Message):
    __slots__ = ("id", "processed_at", "stop_reason", "stop_details")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    STOP_REASON_FIELD_NUMBER: _ClassVar[int]
    STOP_DETAILS_FIELD_NUMBER: _ClassVar[int]
    id: str
    processed_at: str
    stop_reason: _event_content_pb2.StopReason
    stop_details: _event_content_pb2.StopDetails
    def __init__(self, id: _Optional[str] = ..., processed_at: _Optional[str] = ..., stop_reason: _Optional[_Union[_event_content_pb2.StopReason, _Mapping]] = ..., stop_details: _Optional[_Union[_event_content_pb2.StopDetails, _Mapping]] = ...) -> None: ...

class SessionErrorEvent(_message.Message):
    __slots__ = ("id", "processed_at", "error")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    id: str
    processed_at: str
    error: _event_content_pb2.SessionError
    def __init__(self, id: _Optional[str] = ..., processed_at: _Optional[str] = ..., error: _Optional[_Union[_event_content_pb2.SessionError, _Mapping]] = ...) -> None: ...

class AgentMessageEvent(_message.Message):
    __slots__ = ("id", "content", "processed_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    content: _containers.RepeatedCompositeFieldContainer[_event_content_pb2.ContentBlock]
    processed_at: str
    def __init__(self, id: _Optional[str] = ..., content: _Optional[_Iterable[_Union[_event_content_pb2.ContentBlock, _Mapping]]] = ..., processed_at: _Optional[str] = ...) -> None: ...

class AgentThinkingEvent(_message.Message):
    __slots__ = ("id", "processed_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    processed_at: str
    def __init__(self, id: _Optional[str] = ..., processed_at: _Optional[str] = ...) -> None: ...

class AgentToolUseEvent(_message.Message):
    __slots__ = ("id", "input", "name", "processed_at", "evaluated_permission", "evaluation", "session_thread_id")
    ID_FIELD_NUMBER: _ClassVar[int]
    INPUT_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    EVALUATED_PERMISSION_FIELD_NUMBER: _ClassVar[int]
    EVALUATION_FIELD_NUMBER: _ClassVar[int]
    SESSION_THREAD_ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    input: _struct_pb2.Struct
    name: str
    processed_at: str
    evaluated_permission: str
    evaluation: _event_content_pb2.ToolEvaluation
    session_thread_id: str
    def __init__(self, id: _Optional[str] = ..., input: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., name: _Optional[str] = ..., processed_at: _Optional[str] = ..., evaluated_permission: _Optional[str] = ..., evaluation: _Optional[_Union[_event_content_pb2.ToolEvaluation, _Mapping]] = ..., session_thread_id: _Optional[str] = ...) -> None: ...

class AgentToolResultEvent(_message.Message):
    __slots__ = ("id", "processed_at", "tool_use_id", "content", "is_error")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    TOOL_USE_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    IS_ERROR_FIELD_NUMBER: _ClassVar[int]
    id: str
    processed_at: str
    tool_use_id: str
    content: _containers.RepeatedCompositeFieldContainer[_event_content_pb2.ContentBlock]
    is_error: bool
    def __init__(self, id: _Optional[str] = ..., processed_at: _Optional[str] = ..., tool_use_id: _Optional[str] = ..., content: _Optional[_Iterable[_Union[_event_content_pb2.ContentBlock, _Mapping]]] = ..., is_error: bool = ...) -> None: ...

class AgentMcpToolUseEvent(_message.Message):
    __slots__ = ("id", "input", "mcp_server_name", "name", "processed_at", "evaluated_permission", "evaluation", "session_thread_id")
    ID_FIELD_NUMBER: _ClassVar[int]
    INPUT_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVER_NAME_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    EVALUATED_PERMISSION_FIELD_NUMBER: _ClassVar[int]
    EVALUATION_FIELD_NUMBER: _ClassVar[int]
    SESSION_THREAD_ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    input: _struct_pb2.Struct
    mcp_server_name: str
    name: str
    processed_at: str
    evaluated_permission: str
    evaluation: _event_content_pb2.ToolEvaluation
    session_thread_id: str
    def __init__(self, id: _Optional[str] = ..., input: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., mcp_server_name: _Optional[str] = ..., name: _Optional[str] = ..., processed_at: _Optional[str] = ..., evaluated_permission: _Optional[str] = ..., evaluation: _Optional[_Union[_event_content_pb2.ToolEvaluation, _Mapping]] = ..., session_thread_id: _Optional[str] = ...) -> None: ...

class AgentMcpToolResultEvent(_message.Message):
    __slots__ = ("id", "mcp_tool_use_id", "processed_at", "content", "is_error")
    ID_FIELD_NUMBER: _ClassVar[int]
    MCP_TOOL_USE_ID_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    IS_ERROR_FIELD_NUMBER: _ClassVar[int]
    id: str
    mcp_tool_use_id: str
    processed_at: str
    content: _containers.RepeatedCompositeFieldContainer[_event_content_pb2.ContentBlock]
    is_error: bool
    def __init__(self, id: _Optional[str] = ..., mcp_tool_use_id: _Optional[str] = ..., processed_at: _Optional[str] = ..., content: _Optional[_Iterable[_Union[_event_content_pb2.ContentBlock, _Mapping]]] = ..., is_error: bool = ...) -> None: ...

class SessionThreadCreatedEvent(_message.Message):
    __slots__ = ("id", "agent_name", "processed_at", "session_thread_id")
    ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_NAME_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    SESSION_THREAD_ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    agent_name: str
    processed_at: str
    session_thread_id: str
    def __init__(self, id: _Optional[str] = ..., agent_name: _Optional[str] = ..., processed_at: _Optional[str] = ..., session_thread_id: _Optional[str] = ...) -> None: ...

class SessionThreadStatusRunningEvent(_message.Message):
    __slots__ = ("id", "agent_name", "processed_at", "session_thread_id")
    ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_NAME_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    SESSION_THREAD_ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    agent_name: str
    processed_at: str
    session_thread_id: str
    def __init__(self, id: _Optional[str] = ..., agent_name: _Optional[str] = ..., processed_at: _Optional[str] = ..., session_thread_id: _Optional[str] = ...) -> None: ...

class SessionThreadStatusIdleEvent(_message.Message):
    __slots__ = ("id", "agent_name", "processed_at", "session_thread_id", "stop_reason", "stop_details")
    ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_NAME_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    SESSION_THREAD_ID_FIELD_NUMBER: _ClassVar[int]
    STOP_REASON_FIELD_NUMBER: _ClassVar[int]
    STOP_DETAILS_FIELD_NUMBER: _ClassVar[int]
    id: str
    agent_name: str
    processed_at: str
    session_thread_id: str
    stop_reason: _event_content_pb2.StopReason
    stop_details: _event_content_pb2.StopDetails
    def __init__(self, id: _Optional[str] = ..., agent_name: _Optional[str] = ..., processed_at: _Optional[str] = ..., session_thread_id: _Optional[str] = ..., stop_reason: _Optional[_Union[_event_content_pb2.StopReason, _Mapping]] = ..., stop_details: _Optional[_Union[_event_content_pb2.StopDetails, _Mapping]] = ...) -> None: ...

class AgentThreadMessageSentEvent(_message.Message):
    __slots__ = ("id", "content", "processed_at", "to_session_thread_id", "to_agent_name")
    ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    TO_SESSION_THREAD_ID_FIELD_NUMBER: _ClassVar[int]
    TO_AGENT_NAME_FIELD_NUMBER: _ClassVar[int]
    id: str
    content: _containers.RepeatedCompositeFieldContainer[_event_content_pb2.ContentBlock]
    processed_at: str
    to_session_thread_id: str
    to_agent_name: str
    def __init__(self, id: _Optional[str] = ..., content: _Optional[_Iterable[_Union[_event_content_pb2.ContentBlock, _Mapping]]] = ..., processed_at: _Optional[str] = ..., to_session_thread_id: _Optional[str] = ..., to_agent_name: _Optional[str] = ...) -> None: ...

class AgentThreadMessageReceivedEvent(_message.Message):
    __slots__ = ("id", "content", "from_session_thread_id", "processed_at", "from_agent_name")
    ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    FROM_SESSION_THREAD_ID_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    FROM_AGENT_NAME_FIELD_NUMBER: _ClassVar[int]
    id: str
    content: _containers.RepeatedCompositeFieldContainer[_event_content_pb2.ContentBlock]
    from_session_thread_id: str
    processed_at: str
    from_agent_name: str
    def __init__(self, id: _Optional[str] = ..., content: _Optional[_Iterable[_Union[_event_content_pb2.ContentBlock, _Mapping]]] = ..., from_session_thread_id: _Optional[str] = ..., processed_at: _Optional[str] = ..., from_agent_name: _Optional[str] = ...) -> None: ...

class AgentThreadContextCompactedEvent(_message.Message):
    __slots__ = ("id", "processed_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    processed_at: str
    def __init__(self, id: _Optional[str] = ..., processed_at: _Optional[str] = ...) -> None: ...

class UserToolConfirmationEvent(_message.Message):
    __slots__ = ("id", "result", "tool_use_id", "deny_message", "processed_at", "session_thread_id")
    ID_FIELD_NUMBER: _ClassVar[int]
    RESULT_FIELD_NUMBER: _ClassVar[int]
    TOOL_USE_ID_FIELD_NUMBER: _ClassVar[int]
    DENY_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    SESSION_THREAD_ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    result: str
    tool_use_id: str
    deny_message: str
    processed_at: str
    session_thread_id: str
    def __init__(self, id: _Optional[str] = ..., result: _Optional[str] = ..., tool_use_id: _Optional[str] = ..., deny_message: _Optional[str] = ..., processed_at: _Optional[str] = ..., session_thread_id: _Optional[str] = ...) -> None: ...

class UserInterruptEvent(_message.Message):
    __slots__ = ("id", "processed_at", "session_thread_id")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    SESSION_THREAD_ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    processed_at: str
    session_thread_id: str
    def __init__(self, id: _Optional[str] = ..., processed_at: _Optional[str] = ..., session_thread_id: _Optional[str] = ...) -> None: ...

class StigmerAgentThinkingEvent(_message.Message):
    __slots__ = ("id", "processed_at", "thinking_id", "text")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    THINKING_ID_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    id: str
    processed_at: str
    thinking_id: str
    text: str
    def __init__(self, id: _Optional[str] = ..., processed_at: _Optional[str] = ..., thinking_id: _Optional[str] = ..., text: _Optional[str] = ...) -> None: ...

class StigmerPermissionAskedEvent(_message.Message):
    __slots__ = ("id", "processed_at", "tool_use_id", "message", "args_preview", "policy_source", "policy_hook", "content_digest")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    TOOL_USE_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    ARGS_PREVIEW_FIELD_NUMBER: _ClassVar[int]
    POLICY_SOURCE_FIELD_NUMBER: _ClassVar[int]
    POLICY_HOOK_FIELD_NUMBER: _ClassVar[int]
    CONTENT_DIGEST_FIELD_NUMBER: _ClassVar[int]
    id: str
    processed_at: str
    tool_use_id: str
    message: str
    args_preview: str
    policy_source: str
    policy_hook: str
    content_digest: str
    def __init__(self, id: _Optional[str] = ..., processed_at: _Optional[str] = ..., tool_use_id: _Optional[str] = ..., message: _Optional[str] = ..., args_preview: _Optional[str] = ..., policy_source: _Optional[str] = ..., policy_hook: _Optional[str] = ..., content_digest: _Optional[str] = ...) -> None: ...

class StigmerHarnessNoteEvent(_message.Message):
    __slots__ = ("id", "processed_at", "text")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    id: str
    processed_at: str
    text: str
    def __init__(self, id: _Optional[str] = ..., processed_at: _Optional[str] = ..., text: _Optional[str] = ...) -> None: ...

class StigmerAgentStructuredOutputEvent(_message.Message):
    __slots__ = ("id", "processed_at", "output")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_FIELD_NUMBER: _ClassVar[int]
    id: str
    processed_at: str
    output: _struct_pb2.Struct
    def __init__(self, id: _Optional[str] = ..., processed_at: _Optional[str] = ..., output: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...) -> None: ...

class StigmerMemoryRecalledEvent(_message.Message):
    __slots__ = ("id", "processed_at", "selection_active", "injected_memory_ids", "embedding_model")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    SELECTION_ACTIVE_FIELD_NUMBER: _ClassVar[int]
    INJECTED_MEMORY_IDS_FIELD_NUMBER: _ClassVar[int]
    EMBEDDING_MODEL_FIELD_NUMBER: _ClassVar[int]
    id: str
    processed_at: str
    selection_active: bool
    injected_memory_ids: _containers.RepeatedScalarFieldContainer[str]
    embedding_model: str
    def __init__(self, id: _Optional[str] = ..., processed_at: _Optional[str] = ..., selection_active: bool = ..., injected_memory_ids: _Optional[_Iterable[str]] = ..., embedding_model: _Optional[str] = ...) -> None: ...

class ToolOutputDelta(_message.Message):
    __slots__ = ("tool_use_id", "delta")
    TOOL_USE_ID_FIELD_NUMBER: _ClassVar[int]
    DELTA_FIELD_NUMBER: _ClassVar[int]
    tool_use_id: str
    delta: str
    def __init__(self, tool_use_id: _Optional[str] = ..., delta: _Optional[str] = ...) -> None: ...

class RunLiveness(_message.Message):
    __slots__ = ("run_id", "operations", "awaiting_model_for")
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    OPERATIONS_FIELD_NUMBER: _ClassVar[int]
    AWAITING_MODEL_FOR_FIELD_NUMBER: _ClassVar[int]
    run_id: str
    operations: _containers.RepeatedCompositeFieldContainer[RunOpenOperation]
    awaiting_model_for: _duration_pb2.Duration
    def __init__(self, run_id: _Optional[str] = ..., operations: _Optional[_Iterable[_Union[RunOpenOperation, _Mapping]]] = ..., awaiting_model_for: _Optional[_Union[datetime.timedelta, _duration_pb2.Duration, _Mapping]] = ...) -> None: ...

class RunOpenOperation(_message.Message):
    __slots__ = ("tool_use_id", "name", "elapsed", "thread_id")
    TOOL_USE_ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    ELAPSED_FIELD_NUMBER: _ClassVar[int]
    THREAD_ID_FIELD_NUMBER: _ClassVar[int]
    tool_use_id: str
    name: str
    elapsed: _duration_pb2.Duration
    thread_id: str
    def __init__(self, tool_use_id: _Optional[str] = ..., name: _Optional[str] = ..., elapsed: _Optional[_Union[datetime.timedelta, _duration_pb2.Duration, _Mapping]] = ..., thread_id: _Optional[str] = ...) -> None: ...

class EventStart(_message.Message):
    __slots__ = ("event",)
    EVENT_FIELD_NUMBER: _ClassVar[int]
    event: EventPreview
    def __init__(self, event: _Optional[_Union[EventPreview, _Mapping]] = ...) -> None: ...

class EventPreview(_message.Message):
    __slots__ = ("id", "type")
    ID_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    id: str
    type: str
    def __init__(self, id: _Optional[str] = ..., type: _Optional[str] = ...) -> None: ...

class StigmerFileReviewChangesEvent(_message.Message):
    __slots__ = ("id", "processed_at", "change_set_id", "files", "aggregate_digest")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    CHANGE_SET_ID_FIELD_NUMBER: _ClassVar[int]
    FILES_FIELD_NUMBER: _ClassVar[int]
    AGGREGATE_DIGEST_FIELD_NUMBER: _ClassVar[int]
    id: str
    processed_at: str
    change_set_id: str
    files: _containers.RepeatedCompositeFieldContainer[StigmerFileReviewChange]
    aggregate_digest: str
    def __init__(self, id: _Optional[str] = ..., processed_at: _Optional[str] = ..., change_set_id: _Optional[str] = ..., files: _Optional[_Iterable[_Union[StigmerFileReviewChange, _Mapping]]] = ..., aggregate_digest: _Optional[str] = ...) -> None: ...

class StigmerFileReviewChange(_message.Message):
    __slots__ = ("file_change_id", "path", "previous_path", "change", "digest", "lines_added", "lines_removed", "reviewable")
    FILE_CHANGE_ID_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    PREVIOUS_PATH_FIELD_NUMBER: _ClassVar[int]
    CHANGE_FIELD_NUMBER: _ClassVar[int]
    DIGEST_FIELD_NUMBER: _ClassVar[int]
    LINES_ADDED_FIELD_NUMBER: _ClassVar[int]
    LINES_REMOVED_FIELD_NUMBER: _ClassVar[int]
    REVIEWABLE_FIELD_NUMBER: _ClassVar[int]
    file_change_id: str
    path: str
    previous_path: str
    change: str
    digest: str
    lines_added: int
    lines_removed: int
    reviewable: str
    def __init__(self, file_change_id: _Optional[str] = ..., path: _Optional[str] = ..., previous_path: _Optional[str] = ..., change: _Optional[str] = ..., digest: _Optional[str] = ..., lines_added: _Optional[int] = ..., lines_removed: _Optional[int] = ..., reviewable: _Optional[str] = ...) -> None: ...

class StigmerFileReviewDecidedEvent(_message.Message):
    __slots__ = ("id", "processed_at", "change_set_id", "scope", "file_change_id", "action", "expected_digest", "origin", "reason", "decided_by")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    CHANGE_SET_ID_FIELD_NUMBER: _ClassVar[int]
    SCOPE_FIELD_NUMBER: _ClassVar[int]
    FILE_CHANGE_ID_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    EXPECTED_DIGEST_FIELD_NUMBER: _ClassVar[int]
    ORIGIN_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    DECIDED_BY_FIELD_NUMBER: _ClassVar[int]
    id: str
    processed_at: str
    change_set_id: str
    scope: str
    file_change_id: str
    action: str
    expected_digest: str
    origin: str
    reason: str
    decided_by: str
    def __init__(self, id: _Optional[str] = ..., processed_at: _Optional[str] = ..., change_set_id: _Optional[str] = ..., scope: _Optional[str] = ..., file_change_id: _Optional[str] = ..., action: _Optional[str] = ..., expected_digest: _Optional[str] = ..., origin: _Optional[str] = ..., reason: _Optional[str] = ..., decided_by: _Optional[str] = ...) -> None: ...

class StigmerFileReviewReconciledEvent(_message.Message):
    __slots__ = ("id", "processed_at", "change_set_id", "undone_paths", "failure", "failure_detail")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    CHANGE_SET_ID_FIELD_NUMBER: _ClassVar[int]
    UNDONE_PATHS_FIELD_NUMBER: _ClassVar[int]
    FAILURE_FIELD_NUMBER: _ClassVar[int]
    FAILURE_DETAIL_FIELD_NUMBER: _ClassVar[int]
    id: str
    processed_at: str
    change_set_id: str
    undone_paths: _containers.RepeatedScalarFieldContainer[str]
    failure: str
    failure_detail: str
    def __init__(self, id: _Optional[str] = ..., processed_at: _Optional[str] = ..., change_set_id: _Optional[str] = ..., undone_paths: _Optional[_Iterable[str]] = ..., failure: _Optional[str] = ..., failure_detail: _Optional[str] = ...) -> None: ...

class StigmerPermissionGrantEvent(_message.Message):
    __slots__ = ("id", "processed_at", "tool_use_id", "scope", "lease")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    TOOL_USE_ID_FIELD_NUMBER: _ClassVar[int]
    SCOPE_FIELD_NUMBER: _ClassVar[int]
    LEASE_FIELD_NUMBER: _ClassVar[int]
    id: str
    processed_at: str
    tool_use_id: str
    scope: str
    lease: StigmerPermissionLease
    def __init__(self, id: _Optional[str] = ..., processed_at: _Optional[str] = ..., tool_use_id: _Optional[str] = ..., scope: _Optional[str] = ..., lease: _Optional[_Union[StigmerPermissionLease, _Mapping]] = ...) -> None: ...

class StigmerPermissionLease(_message.Message):
    __slots__ = ("category", "server", "hook", "tool")
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    SERVER_FIELD_NUMBER: _ClassVar[int]
    HOOK_FIELD_NUMBER: _ClassVar[int]
    TOOL_FIELD_NUMBER: _ClassVar[int]
    category: str
    server: str
    hook: str
    tool: str
    def __init__(self, category: _Optional[str] = ..., server: _Optional[str] = ..., hook: _Optional[str] = ..., tool: _Optional[str] = ...) -> None: ...

class EventDelta(_message.Message):
    __slots__ = ("delta", "event_id")
    DELTA_FIELD_NUMBER: _ClassVar[int]
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    delta: DeltaContent
    event_id: str
    def __init__(self, delta: _Optional[_Union[DeltaContent, _Mapping]] = ..., event_id: _Optional[str] = ...) -> None: ...

class DeltaContent(_message.Message):
    __slots__ = ("content", "type", "index")
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    INDEX_FIELD_NUMBER: _ClassVar[int]
    content: _event_content_pb2.ContentBlock
    type: str
    index: int
    def __init__(self, content: _Optional[_Union[_event_content_pb2.ContentBlock, _Mapping]] = ..., type: _Optional[str] = ..., index: _Optional[int] = ...) -> None: ...

class StigmerRunStatusEvent(_message.Message):
    __slots__ = ("id", "processed_at", "phase", "stop_cause", "error")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    PHASE_FIELD_NUMBER: _ClassVar[int]
    STOP_CAUSE_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    id: str
    processed_at: str
    phase: str
    stop_cause: str
    error: str
    def __init__(self, id: _Optional[str] = ..., processed_at: _Optional[str] = ..., phase: _Optional[str] = ..., stop_cause: _Optional[str] = ..., error: _Optional[str] = ...) -> None: ...

class StigmerToolResultFullOutputEvent(_message.Message):
    __slots__ = ("id", "processed_at", "tool_use_id", "storage_key", "size_bytes", "content_hash", "mime_type", "is_image")
    ID_FIELD_NUMBER: _ClassVar[int]
    PROCESSED_AT_FIELD_NUMBER: _ClassVar[int]
    TOOL_USE_ID_FIELD_NUMBER: _ClassVar[int]
    STORAGE_KEY_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    CONTENT_HASH_FIELD_NUMBER: _ClassVar[int]
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    IS_IMAGE_FIELD_NUMBER: _ClassVar[int]
    id: str
    processed_at: str
    tool_use_id: str
    storage_key: str
    size_bytes: int
    content_hash: str
    mime_type: str
    is_image: bool
    def __init__(self, id: _Optional[str] = ..., processed_at: _Optional[str] = ..., tool_use_id: _Optional[str] = ..., storage_key: _Optional[str] = ..., size_bytes: _Optional[int] = ..., content_hash: _Optional[str] = ..., mime_type: _Optional[str] = ..., is_image: bool = ...) -> None: ...
