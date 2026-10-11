from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ContentBlock(_message.Message):
    __slots__ = ("type", "text", "source", "context", "title")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    type: str
    text: str
    source: ContentSource
    context: str
    title: str
    def __init__(self, type: _Optional[str] = ..., text: _Optional[str] = ..., source: _Optional[_Union[ContentSource, _Mapping]] = ..., context: _Optional[str] = ..., title: _Optional[str] = ...) -> None: ...

class ContentSource(_message.Message):
    __slots__ = ("type", "data", "media_type", "url", "file_id")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    MEDIA_TYPE_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    FILE_ID_FIELD_NUMBER: _ClassVar[int]
    type: str
    data: str
    media_type: str
    url: str
    file_id: str
    def __init__(self, type: _Optional[str] = ..., data: _Optional[str] = ..., media_type: _Optional[str] = ..., url: _Optional[str] = ..., file_id: _Optional[str] = ...) -> None: ...

class StopReason(_message.Message):
    __slots__ = ("type", "event_ids")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    EVENT_IDS_FIELD_NUMBER: _ClassVar[int]
    type: str
    event_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, type: _Optional[str] = ..., event_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class StopDetails(_message.Message):
    __slots__ = ("type", "category", "explanation")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    EXPLANATION_FIELD_NUMBER: _ClassVar[int]
    type: str
    category: str
    explanation: str
    def __init__(self, type: _Optional[str] = ..., category: _Optional[str] = ..., explanation: _Optional[str] = ...) -> None: ...

class SessionError(_message.Message):
    __slots__ = ("type", "message", "retry_status", "mcp_server_name")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    RETRY_STATUS_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVER_NAME_FIELD_NUMBER: _ClassVar[int]
    type: str
    message: str
    retry_status: RetryStatus
    mcp_server_name: str
    def __init__(self, type: _Optional[str] = ..., message: _Optional[str] = ..., retry_status: _Optional[_Union[RetryStatus, _Mapping]] = ..., mcp_server_name: _Optional[str] = ...) -> None: ...

class RetryStatus(_message.Message):
    __slots__ = ("type",)
    TYPE_FIELD_NUMBER: _ClassVar[int]
    type: str
    def __init__(self, type: _Optional[str] = ...) -> None: ...

class ToolEvaluation(_message.Message):
    __slots__ = ("type", "evaluated_permission")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    EVALUATED_PERMISSION_FIELD_NUMBER: _ClassVar[int]
    type: str
    evaluated_permission: AutoEvaluatedPermission
    def __init__(self, type: _Optional[str] = ..., evaluated_permission: _Optional[_Union[AutoEvaluatedPermission, _Mapping]] = ...) -> None: ...

class AutoEvaluatedPermission(_message.Message):
    __slots__ = ("type", "reason_code")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    REASON_CODE_FIELD_NUMBER: _ClassVar[int]
    type: str
    reason_code: str
    def __init__(self, type: _Optional[str] = ..., reason_code: _Optional[str] = ...) -> None: ...
