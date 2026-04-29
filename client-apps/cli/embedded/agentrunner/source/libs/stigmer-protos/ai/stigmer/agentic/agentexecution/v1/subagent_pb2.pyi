from ai.stigmer.agentic.agentexecution.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.agentexecution.v1 import message_pb2 as _message_pb2
from ai.stigmer.agentic.agentexecution.v1 import todo_pb2 as _todo_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SubAgentExecution(_message.Message):
    __slots__ = ("id", "name", "input", "output", "status", "started_at", "completed_at", "error", "metadata", "messages", "subject", "todos")
    class TodosEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: _todo_pb2.TodoItem
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[_todo_pb2.TodoItem, _Mapping]] = ...) -> None: ...
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    INPUT_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_FIELD_NUMBER: _ClassVar[int]
    TODOS_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    input: str
    output: str
    status: _enum_pb2.SubAgentStatus
    started_at: str
    completed_at: str
    error: str
    metadata: _struct_pb2.Struct
    messages: _containers.RepeatedCompositeFieldContainer[_message_pb2.AgentMessage]
    subject: str
    todos: _containers.MessageMap[str, _todo_pb2.TodoItem]
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., input: _Optional[str] = ..., output: _Optional[str] = ..., status: _Optional[_Union[_enum_pb2.SubAgentStatus, str]] = ..., started_at: _Optional[str] = ..., completed_at: _Optional[str] = ..., error: _Optional[str] = ..., metadata: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., messages: _Optional[_Iterable[_Union[_message_pb2.AgentMessage, _Mapping]]] = ..., subject: _Optional[str] = ..., todos: _Optional[_Mapping[str, _todo_pb2.TodoItem]] = ...) -> None: ...
