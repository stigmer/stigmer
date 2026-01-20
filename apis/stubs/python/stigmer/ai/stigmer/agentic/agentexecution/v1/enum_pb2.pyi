from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class ExecutionPhase(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    EXECUTION_PHASE_UNSPECIFIED: _ClassVar[ExecutionPhase]
    EXECUTION_PENDING: _ClassVar[ExecutionPhase]
    EXECUTION_IN_PROGRESS: _ClassVar[ExecutionPhase]
    EXECUTION_COMPLETED: _ClassVar[ExecutionPhase]
    EXECUTION_FAILED: _ClassVar[ExecutionPhase]
    EXECUTION_CANCELLED: _ClassVar[ExecutionPhase]

class MessageType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    MESSAGE_TYPE_UNSPECIFIED: _ClassVar[MessageType]
    MESSAGE_HUMAN: _ClassVar[MessageType]
    MESSAGE_AI: _ClassVar[MessageType]
    MESSAGE_TOOL: _ClassVar[MessageType]
    MESSAGE_SYSTEM: _ClassVar[MessageType]

class ToolCallStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TOOL_CALL_STATUS_UNSPECIFIED: _ClassVar[ToolCallStatus]
    TOOL_CALL_PENDING: _ClassVar[ToolCallStatus]
    TOOL_CALL_RUNNING: _ClassVar[ToolCallStatus]
    TOOL_CALL_COMPLETED: _ClassVar[ToolCallStatus]
    TOOL_CALL_FAILED: _ClassVar[ToolCallStatus]

class TodoStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TODO_STATUS_UNSPECIFIED: _ClassVar[TodoStatus]
    TODO_PENDING: _ClassVar[TodoStatus]
    TODO_IN_PROGRESS: _ClassVar[TodoStatus]
    TODO_COMPLETED: _ClassVar[TodoStatus]
    TODO_CANCELLED: _ClassVar[TodoStatus]

class SubAgentStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SUB_AGENT_STATUS_UNSPECIFIED: _ClassVar[SubAgentStatus]
    SUB_AGENT_PENDING: _ClassVar[SubAgentStatus]
    SUB_AGENT_IN_PROGRESS: _ClassVar[SubAgentStatus]
    SUB_AGENT_COMPLETED: _ClassVar[SubAgentStatus]
    SUB_AGENT_FAILED: _ClassVar[SubAgentStatus]
EXECUTION_PHASE_UNSPECIFIED: ExecutionPhase
EXECUTION_PENDING: ExecutionPhase
EXECUTION_IN_PROGRESS: ExecutionPhase
EXECUTION_COMPLETED: ExecutionPhase
EXECUTION_FAILED: ExecutionPhase
EXECUTION_CANCELLED: ExecutionPhase
MESSAGE_TYPE_UNSPECIFIED: MessageType
MESSAGE_HUMAN: MessageType
MESSAGE_AI: MessageType
MESSAGE_TOOL: MessageType
MESSAGE_SYSTEM: MessageType
TOOL_CALL_STATUS_UNSPECIFIED: ToolCallStatus
TOOL_CALL_PENDING: ToolCallStatus
TOOL_CALL_RUNNING: ToolCallStatus
TOOL_CALL_COMPLETED: ToolCallStatus
TOOL_CALL_FAILED: ToolCallStatus
TODO_STATUS_UNSPECIFIED: TodoStatus
TODO_PENDING: TodoStatus
TODO_IN_PROGRESS: TodoStatus
TODO_COMPLETED: TodoStatus
TODO_CANCELLED: TodoStatus
SUB_AGENT_STATUS_UNSPECIFIED: SubAgentStatus
SUB_AGENT_PENDING: SubAgentStatus
SUB_AGENT_IN_PROGRESS: SubAgentStatus
SUB_AGENT_COMPLETED: SubAgentStatus
SUB_AGENT_FAILED: SubAgentStatus
