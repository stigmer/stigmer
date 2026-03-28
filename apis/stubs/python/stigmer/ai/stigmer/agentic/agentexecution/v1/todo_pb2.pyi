from ai.stigmer.agentic.agentexecution.v1 import enum_pb2 as _enum_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

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
