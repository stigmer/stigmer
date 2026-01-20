from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SwitchTaskConfig(_message.Message):
    __slots__ = ("cases",)
    CASES_FIELD_NUMBER: _ClassVar[int]
    cases: _containers.RepeatedCompositeFieldContainer[SwitchCase]
    def __init__(self, cases: _Optional[_Iterable[_Union[SwitchCase, _Mapping]]] = ...) -> None: ...

class SwitchCase(_message.Message):
    __slots__ = ("name", "when", "then")
    NAME_FIELD_NUMBER: _ClassVar[int]
    WHEN_FIELD_NUMBER: _ClassVar[int]
    THEN_FIELD_NUMBER: _ClassVar[int]
    name: str
    when: str
    then: str
    def __init__(self, name: _Optional[str] = ..., when: _Optional[str] = ..., then: _Optional[str] = ...) -> None: ...
