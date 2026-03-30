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
    EXECUTION_TERMINATED: _ClassVar[ExecutionPhase]
    EXECUTION_WAITING_FOR_APPROVAL: _ClassVar[ExecutionPhase]
    EXECUTION_PAUSED: _ClassVar[ExecutionPhase]

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
    TOOL_CALL_WAITING_APPROVAL: _ClassVar[ToolCallStatus]
    TOOL_CALL_SKIPPED: _ClassVar[ToolCallStatus]

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
    SUB_AGENT_CANCELLED: _ClassVar[SubAgentStatus]

class ExecutionArtifactKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    EXECUTION_ARTIFACT_KIND_UNSPECIFIED: _ClassVar[ExecutionArtifactKind]
    EXECUTION_ARTIFACT_KIND_FILE: _ClassVar[ExecutionArtifactKind]
    EXECUTION_ARTIFACT_KIND_DIRECTORY: _ClassVar[ExecutionArtifactKind]

class SummarizationSource(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SUMMARIZATION_SOURCE_UNSPECIFIED: _ClassVar[SummarizationSource]
    graph_start: _ClassVar[SummarizationSource]
    mid_execution: _ClassVar[SummarizationSource]

class ToolCallStreamingSource(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TOOL_CALL_STREAMING_SOURCE_UNSPECIFIED: _ClassVar[ToolCallStreamingSource]
    TOOL_CALL_STREAMING_SOURCE_INPUT: _ClassVar[ToolCallStreamingSource]
    TOOL_CALL_STREAMING_SOURCE_OUTPUT: _ClassVar[ToolCallStreamingSource]

class ApprovalAction(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    APPROVAL_ACTION_UNSPECIFIED: _ClassVar[ApprovalAction]
    APPROVAL_ACTION_APPROVE: _ClassVar[ApprovalAction]
    APPROVAL_ACTION_SKIP: _ClassVar[ApprovalAction]
    APPROVAL_ACTION_REJECT: _ClassVar[ApprovalAction]
EXECUTION_PHASE_UNSPECIFIED: ExecutionPhase
EXECUTION_PENDING: ExecutionPhase
EXECUTION_IN_PROGRESS: ExecutionPhase
EXECUTION_COMPLETED: ExecutionPhase
EXECUTION_FAILED: ExecutionPhase
EXECUTION_CANCELLED: ExecutionPhase
EXECUTION_TERMINATED: ExecutionPhase
EXECUTION_WAITING_FOR_APPROVAL: ExecutionPhase
EXECUTION_PAUSED: ExecutionPhase
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
TOOL_CALL_WAITING_APPROVAL: ToolCallStatus
TOOL_CALL_SKIPPED: ToolCallStatus
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
SUB_AGENT_CANCELLED: SubAgentStatus
EXECUTION_ARTIFACT_KIND_UNSPECIFIED: ExecutionArtifactKind
EXECUTION_ARTIFACT_KIND_FILE: ExecutionArtifactKind
EXECUTION_ARTIFACT_KIND_DIRECTORY: ExecutionArtifactKind
SUMMARIZATION_SOURCE_UNSPECIFIED: SummarizationSource
graph_start: SummarizationSource
mid_execution: SummarizationSource
TOOL_CALL_STREAMING_SOURCE_UNSPECIFIED: ToolCallStreamingSource
TOOL_CALL_STREAMING_SOURCE_INPUT: ToolCallStreamingSource
TOOL_CALL_STREAMING_SOURCE_OUTPUT: ToolCallStreamingSource
APPROVAL_ACTION_UNSPECIFIED: ApprovalAction
APPROVAL_ACTION_APPROVE: ApprovalAction
APPROVAL_ACTION_SKIP: ApprovalAction
APPROVAL_ACTION_REJECT: ApprovalAction
