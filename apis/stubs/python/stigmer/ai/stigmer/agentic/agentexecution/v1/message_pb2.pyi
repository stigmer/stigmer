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
    __slots__ = ("type", "content", "timestamp", "tool_calls", "metadata", "is_streaming")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALLS_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    IS_STREAMING_FIELD_NUMBER: _ClassVar[int]
    type: _enum_pb2.MessageType
    content: str
    timestamp: str
    tool_calls: _containers.RepeatedCompositeFieldContainer[ToolCall]
    metadata: _struct_pb2.Struct
    is_streaming: bool
    def __init__(self, type: _Optional[_Union[_enum_pb2.MessageType, str]] = ..., content: _Optional[str] = ..., timestamp: _Optional[str] = ..., tool_calls: _Optional[_Iterable[_Union[ToolCall, _Mapping]]] = ..., metadata: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., is_streaming: bool = ...) -> None: ...

class ToolCall(_message.Message):
    __slots__ = ("id", "name", "args", "result", "status", "started_at", "completed_at", "error", "requires_approval", "approval_message", "approval_requested_at", "approval_decided_at", "approved_by", "approval_action", "is_streaming", "streaming_source", "mcp_server_slug", "args_preview")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    ARGS_FIELD_NUMBER: _ClassVar[int]
    RESULT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
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
    STREAMING_SOURCE_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVER_SLUG_FIELD_NUMBER: _ClassVar[int]
    ARGS_PREVIEW_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    args: _struct_pb2.Struct
    result: str
    status: _enum_pb2.ToolCallStatus
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
    streaming_source: _enum_pb2.ToolCallStreamingSource
    mcp_server_slug: str
    args_preview: str
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., args: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., result: _Optional[str] = ..., status: _Optional[_Union[_enum_pb2.ToolCallStatus, str]] = ..., started_at: _Optional[str] = ..., completed_at: _Optional[str] = ..., error: _Optional[str] = ..., requires_approval: bool = ..., approval_message: _Optional[str] = ..., approval_requested_at: _Optional[str] = ..., approval_decided_at: _Optional[str] = ..., approved_by: _Optional[str] = ..., approval_action: _Optional[_Union[_enum_pb2.ApprovalAction, str]] = ..., is_streaming: bool = ..., streaming_source: _Optional[_Union[_enum_pb2.ToolCallStreamingSource, str]] = ..., mcp_server_slug: _Optional[str] = ..., args_preview: _Optional[str] = ...) -> None: ...
