from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SessionMemory(_message.Message):
    __slots__ = ("durable_summary", "workspace_digest", "changed_files", "open_tasks", "tool_observations", "recent_turns", "decisions", "failed_attempts")
    DURABLE_SUMMARY_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_DIGEST_FIELD_NUMBER: _ClassVar[int]
    CHANGED_FILES_FIELD_NUMBER: _ClassVar[int]
    OPEN_TASKS_FIELD_NUMBER: _ClassVar[int]
    TOOL_OBSERVATIONS_FIELD_NUMBER: _ClassVar[int]
    RECENT_TURNS_FIELD_NUMBER: _ClassVar[int]
    DECISIONS_FIELD_NUMBER: _ClassVar[int]
    FAILED_ATTEMPTS_FIELD_NUMBER: _ClassVar[int]
    durable_summary: str
    workspace_digest: str
    changed_files: _containers.RepeatedScalarFieldContainer[str]
    open_tasks: _containers.RepeatedScalarFieldContainer[str]
    tool_observations: _containers.RepeatedCompositeFieldContainer[ToolObservation]
    recent_turns: _containers.RepeatedCompositeFieldContainer[ConversationTurn]
    decisions: _containers.RepeatedScalarFieldContainer[str]
    failed_attempts: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, durable_summary: _Optional[str] = ..., workspace_digest: _Optional[str] = ..., changed_files: _Optional[_Iterable[str]] = ..., open_tasks: _Optional[_Iterable[str]] = ..., tool_observations: _Optional[_Iterable[_Union[ToolObservation, _Mapping]]] = ..., recent_turns: _Optional[_Iterable[_Union[ConversationTurn, _Mapping]]] = ..., decisions: _Optional[_Iterable[str]] = ..., failed_attempts: _Optional[_Iterable[str]] = ...) -> None: ...

class ToolObservation(_message.Message):
    __slots__ = ("command", "cwd", "exit_code", "summary")
    COMMAND_FIELD_NUMBER: _ClassVar[int]
    CWD_FIELD_NUMBER: _ClassVar[int]
    EXIT_CODE_FIELD_NUMBER: _ClassVar[int]
    SUMMARY_FIELD_NUMBER: _ClassVar[int]
    command: str
    cwd: str
    exit_code: int
    summary: str
    def __init__(self, command: _Optional[str] = ..., cwd: _Optional[str] = ..., exit_code: _Optional[int] = ..., summary: _Optional[str] = ...) -> None: ...

class ConversationTurn(_message.Message):
    __slots__ = ("role", "content", "timestamp")
    ROLE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    role: str
    content: str
    timestamp: str
    def __init__(self, role: _Optional[str] = ..., content: _Optional[str] = ..., timestamp: _Optional[str] = ...) -> None: ...
