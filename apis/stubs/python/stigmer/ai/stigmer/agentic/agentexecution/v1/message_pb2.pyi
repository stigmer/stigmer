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
    __slots__ = ("id", "name", "args", "result", "status", "started_at", "completed_at", "error", "requires_approval", "approval_message", "approval_requested_at", "approval_decided_at", "approved_by", "approval_action", "is_streaming", "streaming_source", "mcp_server_slug", "args_preview", "tool_kind", "output_ref", "approval_policy_source", "policy_engine_version", "approval_content_digest", "file_change_set_id")
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
    TOOL_KIND_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_REF_FIELD_NUMBER: _ClassVar[int]
    APPROVAL_POLICY_SOURCE_FIELD_NUMBER: _ClassVar[int]
    POLICY_ENGINE_VERSION_FIELD_NUMBER: _ClassVar[int]
    APPROVAL_CONTENT_DIGEST_FIELD_NUMBER: _ClassVar[int]
    FILE_CHANGE_SET_ID_FIELD_NUMBER: _ClassVar[int]
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
    tool_kind: _enum_pb2.ToolKind
    output_ref: ToolCallOutputRef
    approval_policy_source: _enum_pb2.ApprovalPolicySource
    policy_engine_version: str
    approval_content_digest: str
    file_change_set_id: str
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., args: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., result: _Optional[str] = ..., status: _Optional[_Union[_enum_pb2.ToolCallStatus, str]] = ..., started_at: _Optional[str] = ..., completed_at: _Optional[str] = ..., error: _Optional[str] = ..., requires_approval: bool = ..., approval_message: _Optional[str] = ..., approval_requested_at: _Optional[str] = ..., approval_decided_at: _Optional[str] = ..., approved_by: _Optional[str] = ..., approval_action: _Optional[_Union[_enum_pb2.ApprovalAction, str]] = ..., is_streaming: bool = ..., streaming_source: _Optional[_Union[_enum_pb2.ToolCallStreamingSource, str]] = ..., mcp_server_slug: _Optional[str] = ..., args_preview: _Optional[str] = ..., tool_kind: _Optional[_Union[_enum_pb2.ToolKind, str]] = ..., output_ref: _Optional[_Union[ToolCallOutputRef, _Mapping]] = ..., approval_policy_source: _Optional[_Union[_enum_pb2.ApprovalPolicySource, str]] = ..., policy_engine_version: _Optional[str] = ..., approval_content_digest: _Optional[str] = ..., file_change_set_id: _Optional[str] = ...) -> None: ...

class ToolCallOutputRef(_message.Message):
    __slots__ = ("storage_key", "size_bytes", "content_hash", "mime_type", "is_image", "truncated_preview")
    STORAGE_KEY_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    CONTENT_HASH_FIELD_NUMBER: _ClassVar[int]
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    IS_IMAGE_FIELD_NUMBER: _ClassVar[int]
    TRUNCATED_PREVIEW_FIELD_NUMBER: _ClassVar[int]
    storage_key: str
    size_bytes: int
    content_hash: str
    mime_type: str
    is_image: bool
    truncated_preview: str
    def __init__(self, storage_key: _Optional[str] = ..., size_bytes: _Optional[int] = ..., content_hash: _Optional[str] = ..., mime_type: _Optional[str] = ..., is_image: bool = ..., truncated_preview: _Optional[str] = ...) -> None: ...

class FileChange(_message.Message):
    __slots__ = ("path", "absolute_path", "change_type", "capture_level", "before", "after", "unified_diff", "lines_added", "lines_removed", "rename_from")
    PATH_FIELD_NUMBER: _ClassVar[int]
    ABSOLUTE_PATH_FIELD_NUMBER: _ClassVar[int]
    CHANGE_TYPE_FIELD_NUMBER: _ClassVar[int]
    CAPTURE_LEVEL_FIELD_NUMBER: _ClassVar[int]
    BEFORE_FIELD_NUMBER: _ClassVar[int]
    AFTER_FIELD_NUMBER: _ClassVar[int]
    UNIFIED_DIFF_FIELD_NUMBER: _ClassVar[int]
    LINES_ADDED_FIELD_NUMBER: _ClassVar[int]
    LINES_REMOVED_FIELD_NUMBER: _ClassVar[int]
    RENAME_FROM_FIELD_NUMBER: _ClassVar[int]
    path: str
    absolute_path: str
    change_type: _enum_pb2.FileChangeType
    capture_level: _enum_pb2.FileChangeCaptureLevel
    before: FileContent
    after: FileContent
    unified_diff: str
    lines_added: int
    lines_removed: int
    rename_from: str
    def __init__(self, path: _Optional[str] = ..., absolute_path: _Optional[str] = ..., change_type: _Optional[_Union[_enum_pb2.FileChangeType, str]] = ..., capture_level: _Optional[_Union[_enum_pb2.FileChangeCaptureLevel, str]] = ..., before: _Optional[_Union[FileContent, _Mapping]] = ..., after: _Optional[_Union[FileContent, _Mapping]] = ..., unified_diff: _Optional[str] = ..., lines_added: _Optional[int] = ..., lines_removed: _Optional[int] = ..., rename_from: _Optional[str] = ...) -> None: ...

class FileContent(_message.Message):
    __slots__ = ("inline", "ref", "is_binary")
    INLINE_FIELD_NUMBER: _ClassVar[int]
    REF_FIELD_NUMBER: _ClassVar[int]
    IS_BINARY_FIELD_NUMBER: _ClassVar[int]
    inline: str
    ref: ToolCallOutputRef
    is_binary: bool
    def __init__(self, inline: _Optional[str] = ..., ref: _Optional[_Union[ToolCallOutputRef, _Mapping]] = ..., is_binary: bool = ...) -> None: ...
