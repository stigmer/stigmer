from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class EnvironmentSpec(_message.Message):
    __slots__ = ("description", "data")
    class DataEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: EnvironmentValue
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[EnvironmentValue, _Mapping]] = ...) -> None: ...
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    description: str
    data: _containers.MessageMap[str, EnvironmentValue]
    def __init__(self, description: _Optional[str] = ..., data: _Optional[_Mapping[str, EnvironmentValue]] = ...) -> None: ...

class EnvironmentValue(_message.Message):
    __slots__ = ("value", "is_secret", "description")
    VALUE_FIELD_NUMBER: _ClassVar[int]
    IS_SECRET_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    value: str
    is_secret: bool
    description: str
    def __init__(self, value: _Optional[str] = ..., is_secret: bool = ..., description: _Optional[str] = ...) -> None: ...
