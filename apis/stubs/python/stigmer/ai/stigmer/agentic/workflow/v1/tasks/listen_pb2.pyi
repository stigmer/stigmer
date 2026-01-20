from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ListenTaskConfig(_message.Message):
    __slots__ = ("to",)
    TO_FIELD_NUMBER: _ClassVar[int]
    to: ListenTo
    def __init__(self, to: _Optional[_Union[ListenTo, _Mapping]] = ...) -> None: ...

class ListenTo(_message.Message):
    __slots__ = ("mode", "signals")
    MODE_FIELD_NUMBER: _ClassVar[int]
    SIGNALS_FIELD_NUMBER: _ClassVar[int]
    mode: str
    signals: _containers.RepeatedCompositeFieldContainer[SignalSpec]
    def __init__(self, mode: _Optional[str] = ..., signals: _Optional[_Iterable[_Union[SignalSpec, _Mapping]]] = ...) -> None: ...

class SignalSpec(_message.Message):
    __slots__ = ("id", "type")
    ID_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    id: str
    type: str
    def __init__(self, id: _Optional[str] = ..., type: _Optional[str] = ...) -> None: ...
