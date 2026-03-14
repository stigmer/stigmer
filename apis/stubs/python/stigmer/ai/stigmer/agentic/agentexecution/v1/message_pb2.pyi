from ai.stigmer.agentic.agentexecution.v1 import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentMessage(_message.Message):
    __slots__ = ("type", "content", "timestamp", "tool_calls", "metadata", "is_streaming", "token_count", "generation_duration_ms", "input_tokens", "output_tokens", "cache_read_tokens", "estimated_cost_usd", "model")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALLS_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    IS_STREAMING_FIELD_NUMBER: _ClassVar[int]
    TOKEN_COUNT_FIELD_NUMBER: _ClassVar[int]
    GENERATION_DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    INPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    CACHE_READ_TOKENS_FIELD_NUMBER: _ClassVar[int]
    ESTIMATED_COST_USD_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    type: _enum_pb2.MessageType
    content: str
    timestamp: str
    tool_calls: _containers.RepeatedCompositeFieldContainer[ToolCall]
    metadata: _struct_pb2.Struct
    is_streaming: bool
    token_count: int
    generation_duration_ms: int
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    estimated_cost_usd: float
    model: str
    def __init__(self, type: _Optional[_Union[_enum_pb2.MessageType, str]] = ..., content: _Optional[str] = ..., timestamp: _Optional[str] = ..., tool_calls: _Optional[_Iterable[_Union[ToolCall, _Mapping]]] = ..., metadata: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., is_streaming: bool = ..., token_count: _Optional[int] = ..., generation_duration_ms: _Optional[int] = ..., input_tokens: _Optional[int] = ..., output_tokens: _Optional[int] = ..., cache_read_tokens: _Optional[int] = ..., estimated_cost_usd: _Optional[float] = ..., model: _Optional[str] = ...) -> None: ...

class ToolCall(_message.Message):
    __slots__ = ("id", "name", "args", "result", "status", "component_metadata", "started_at", "completed_at", "error", "requires_approval", "approval_message", "approval_requested_at", "approval_decided_at", "approved_by", "approval_action", "is_streaming", "mcp_server_slug")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    ARGS_FIELD_NUMBER: _ClassVar[int]
    RESULT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    COMPONENT_METADATA_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    REQUIRES_APPROVAL_FIELD_NUMBER: _ClassVar[int]
    APPROVAL_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    APPROVAL_REQUESTED_AT_FIELD_NUMBER: _ClassVar[int]
    APPROVAL_DECIDED_AT_FIELD_NUMBER: _ClassVar[int]
    APPROVED_BY_FIELD_NUMBER: _ClassVar[int]
    APPROVAL_ACTION_FIELD_NUMBER: _ClassVar[int]
    IS_STREAMING_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVER_SLUG_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    args: _struct_pb2.Struct
    result: str
    status: _enum_pb2.ToolCallStatus
    component_metadata: ComponentMetadata
    started_at: str
    completed_at: str
    error: str
    requires_approval: bool
    approval_message: str
    approval_requested_at: str
    approval_decided_at: str
    approved_by: str
    approval_action: _enum_pb2.ApprovalAction
    is_streaming: bool
    mcp_server_slug: str
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., args: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., result: _Optional[str] = ..., status: _Optional[_Union[_enum_pb2.ToolCallStatus, str]] = ..., component_metadata: _Optional[_Union[ComponentMetadata, _Mapping]] = ..., started_at: _Optional[str] = ..., completed_at: _Optional[str] = ..., error: _Optional[str] = ..., requires_approval: bool = ..., approval_message: _Optional[str] = ..., approval_requested_at: _Optional[str] = ..., approval_decided_at: _Optional[str] = ..., approved_by: _Optional[str] = ..., approval_action: _Optional[_Union[_enum_pb2.ApprovalAction, str]] = ..., is_streaming: bool = ..., mcp_server_slug: _Optional[str] = ...) -> None: ...

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
