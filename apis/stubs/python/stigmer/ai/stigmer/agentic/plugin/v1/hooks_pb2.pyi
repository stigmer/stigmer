from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class HookFormat(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    HOOK_FORMAT_UNSPECIFIED: _ClassVar[HookFormat]
    HOOK_FORMAT_CLAUDE_CODE: _ClassVar[HookFormat]
    HOOK_FORMAT_CURSOR: _ClassVar[HookFormat]
HOOK_FORMAT_UNSPECIFIED: HookFormat
HOOK_FORMAT_CLAUDE_CODE: HookFormat
HOOK_FORMAT_CURSOR: HookFormat

class HookConfig(_message.Message):
    __slots__ = ("format", "groups")
    FORMAT_FIELD_NUMBER: _ClassVar[int]
    GROUPS_FIELD_NUMBER: _ClassVar[int]
    format: HookFormat
    groups: _containers.RepeatedCompositeFieldContainer[HookGroup]
    def __init__(self, format: _Optional[_Union[HookFormat, str]] = ..., groups: _Optional[_Iterable[_Union[HookGroup, _Mapping]]] = ...) -> None: ...

class HookGroup(_message.Message):
    __slots__ = ("event", "matcher", "handlers")
    EVENT_FIELD_NUMBER: _ClassVar[int]
    MATCHER_FIELD_NUMBER: _ClassVar[int]
    HANDLERS_FIELD_NUMBER: _ClassVar[int]
    event: str
    matcher: str
    handlers: _containers.RepeatedCompositeFieldContainer[HookHandler]
    def __init__(self, event: _Optional[str] = ..., matcher: _Optional[str] = ..., handlers: _Optional[_Iterable[_Union[HookHandler, _Mapping]]] = ...) -> None: ...

class HookHandler(_message.Message):
    __slots__ = ("command", "args", "timeout_seconds", "condition", "fail_closed")
    COMMAND_FIELD_NUMBER: _ClassVar[int]
    ARGS_FIELD_NUMBER: _ClassVar[int]
    TIMEOUT_SECONDS_FIELD_NUMBER: _ClassVar[int]
    CONDITION_FIELD_NUMBER: _ClassVar[int]
    FAIL_CLOSED_FIELD_NUMBER: _ClassVar[int]
    command: str
    args: _containers.RepeatedScalarFieldContainer[str]
    timeout_seconds: int
    condition: str
    fail_closed: bool
    def __init__(self, command: _Optional[str] = ..., args: _Optional[_Iterable[str]] = ..., timeout_seconds: _Optional[int] = ..., condition: _Optional[str] = ..., fail_closed: bool = ...) -> None: ...
