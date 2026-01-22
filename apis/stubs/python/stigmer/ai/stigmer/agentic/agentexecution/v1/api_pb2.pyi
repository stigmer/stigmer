from ai.stigmer.agentic.agentexecution.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.agentexecution.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.commons.apiresource import metadata_pb2 as _metadata_pb2
from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentExecution(_message.Message):
    __slots__ = ("api_version", "kind", "metadata", "spec", "status")
    API_VERSION_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    SPEC_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    api_version: str
    kind: str
    metadata: _metadata_pb2.ApiResourceMetadata
    spec: _spec_pb2.AgentExecutionSpec
    status: AgentExecutionStatus
    def __init__(self, api_version: _Optional[str] = ..., kind: _Optional[str] = ..., metadata: _Optional[_Union[_metadata_pb2.ApiResourceMetadata, _Mapping]] = ..., spec: _Optional[_Union[_spec_pb2.AgentExecutionSpec, _Mapping]] = ..., status: _Optional[_Union[AgentExecutionStatus, _Mapping]] = ...) -> None: ...

class AgentExecutionStatus(_message.Message):
    __slots__ = ("audit", "messages", "phase", "tool_calls", "sub_agent_executions", "error", "started_at", "completed_at", "todos", "callback_token")
    class TodosEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: TodoItem
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[TodoItem, _Mapping]] = ...) -> None: ...
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    PHASE_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALLS_FIELD_NUMBER: _ClassVar[int]
    SUB_AGENT_EXECUTIONS_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    TODOS_FIELD_NUMBER: _ClassVar[int]
    CALLBACK_TOKEN_FIELD_NUMBER: _ClassVar[int]
    audit: _status_pb2.ApiResourceAudit
    messages: _containers.RepeatedCompositeFieldContainer[AgentMessage]
    phase: _enum_pb2.ExecutionPhase
    tool_calls: _containers.RepeatedCompositeFieldContainer[ToolCall]
    sub_agent_executions: _containers.RepeatedCompositeFieldContainer[SubAgentExecution]
    error: str
    started_at: str
    completed_at: str
    todos: _containers.MessageMap[str, TodoItem]
    callback_token: bytes
    def __init__(self, audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ..., messages: _Optional[_Iterable[_Union[AgentMessage, _Mapping]]] = ..., phase: _Optional[_Union[_enum_pb2.ExecutionPhase, str]] = ..., tool_calls: _Optional[_Iterable[_Union[ToolCall, _Mapping]]] = ..., sub_agent_executions: _Optional[_Iterable[_Union[SubAgentExecution, _Mapping]]] = ..., error: _Optional[str] = ..., started_at: _Optional[str] = ..., completed_at: _Optional[str] = ..., todos: _Optional[_Mapping[str, TodoItem]] = ..., callback_token: _Optional[bytes] = ...) -> None: ...

class TodoItem(_message.Message):
    __slots__ = ("id", "content", "status", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    content: str
    status: _enum_pb2.TodoStatus
    created_at: str
    updated_at: str
    def __init__(self, id: _Optional[str] = ..., content: _Optional[str] = ..., status: _Optional[_Union[_enum_pb2.TodoStatus, str]] = ..., created_at: _Optional[str] = ..., updated_at: _Optional[str] = ...) -> None: ...

class AgentMessage(_message.Message):
    __slots__ = ("type", "content", "timestamp", "tool_calls", "metadata")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALLS_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    type: _enum_pb2.MessageType
    content: str
    timestamp: str
    tool_calls: _containers.RepeatedCompositeFieldContainer[ToolCall]
    metadata: _struct_pb2.Struct
    def __init__(self, type: _Optional[_Union[_enum_pb2.MessageType, str]] = ..., content: _Optional[str] = ..., timestamp: _Optional[str] = ..., tool_calls: _Optional[_Iterable[_Union[ToolCall, _Mapping]]] = ..., metadata: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...) -> None: ...

class ToolCall(_message.Message):
    __slots__ = ("id", "name", "args", "result", "status", "component_metadata", "started_at", "completed_at", "error")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    ARGS_FIELD_NUMBER: _ClassVar[int]
    RESULT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    COMPONENT_METADATA_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    args: _struct_pb2.Struct
    result: str
    status: _enum_pb2.ToolCallStatus
    component_metadata: ComponentMetadata
    started_at: str
    completed_at: str
    error: str
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., args: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., result: _Optional[str] = ..., status: _Optional[_Union[_enum_pb2.ToolCallStatus, str]] = ..., component_metadata: _Optional[_Union[ComponentMetadata, _Mapping]] = ..., started_at: _Optional[str] = ..., completed_at: _Optional[str] = ..., error: _Optional[str] = ...) -> None: ...

class ComponentMetadata(_message.Message):
    __slots__ = ("component_type", "component_group", "layout_hint", "metadata")
    COMPONENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    COMPONENT_GROUP_FIELD_NUMBER: _ClassVar[int]
    LAYOUT_HINT_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    component_type: str
    component_group: str
    layout_hint: str
    metadata: _struct_pb2.Struct
    def __init__(self, component_type: _Optional[str] = ..., component_group: _Optional[str] = ..., layout_hint: _Optional[str] = ..., metadata: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...) -> None: ...

class SubAgentExecution(_message.Message):
    __slots__ = ("id", "name", "input", "output", "status", "started_at", "completed_at", "error", "metadata")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    INPUT_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    input: str
    output: str
    status: _enum_pb2.SubAgentStatus
    started_at: str
    completed_at: str
    error: str
    metadata: _struct_pb2.Struct
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., input: _Optional[str] = ..., output: _Optional[str] = ..., status: _Optional[_Union[_enum_pb2.SubAgentStatus, str]] = ..., started_at: _Optional[str] = ..., completed_at: _Optional[str] = ..., error: _Optional[str] = ..., metadata: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...) -> None: ...
