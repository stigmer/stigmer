from ai.stigmer.agentic.session.v1 import event_content_pb2 as _event_content_pb2
from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SessionEvent(_message.Message):
    __slots__ = ("seq", "session_id", "run_id", "thread_id", "user_message", "session_status_running", "session_status_idle", "session_error", "agent_message", "agent_thinking", "agent_tool_use", "agent_tool_result", "agent_mcp_tool_use", "agent_mcp_tool_result", "session_thread_created", "session_thread_status_running", "session_thread_status_idle", "agent_thread_message_sent", "agent_thread_message_received", "agent_thread_context_compacted")
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
    def __init__(self, seq: _Optional[int] = ..., session_id: _Optional[str] = ..., run_id: _Optional[str] = ..., thread_id: _Optional[str] = ..., user_message: _Optional[_Union[UserMessageEvent, _Mapping]] = ..., session_status_running: _Optional[_Union[SessionStatusRunningEvent, _Mapping]] = ..., session_status_idle: _Optional[_Union[SessionStatusIdleEvent, _Mapping]] = ..., session_error: _Optional[_Union[SessionErrorEvent, _Mapping]] = ..., agent_message: _Optional[_Union[AgentMessageEvent, _Mapping]] = ..., agent_thinking: _Optional[_Union[AgentThinkingEvent, _Mapping]] = ..., agent_tool_use: _Optional[_Union[AgentToolUseEvent, _Mapping]] = ..., agent_tool_result: _Optional[_Union[AgentToolResultEvent, _Mapping]] = ..., agent_mcp_tool_use: _Optional[_Union[AgentMcpToolUseEvent, _Mapping]] = ..., agent_mcp_tool_result: _Optional[_Union[AgentMcpToolResultEvent, _Mapping]] = ..., session_thread_created: _Optional[_Union[SessionThreadCreatedEvent, _Mapping]] = ..., session_thread_status_running: _Optional[_Union[SessionThreadStatusRunningEvent, _Mapping]] = ..., session_thread_status_idle: _Optional[_Union[SessionThreadStatusIdleEvent, _Mapping]] = ..., agent_thread_message_sent: _Optional[_Union[AgentThreadMessageSentEvent, _Mapping]] = ..., agent_thread_message_received: _Optional[_Union[AgentThreadMessageReceivedEvent, _Mapping]] = ..., agent_thread_context_compacted: _Optional[_Union[AgentThreadContextCompactedEvent, _Mapping]] = ...) -> None: ...

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
