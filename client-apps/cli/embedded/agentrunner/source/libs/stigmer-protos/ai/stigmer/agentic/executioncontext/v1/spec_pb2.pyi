from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ExecutionContextSpec(_message.Message):
    __slots__ = ("execution_id", "data")
    class DataEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: ExecutionValue
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[ExecutionValue, _Mapping]] = ...) -> None: ...
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    data: _containers.MessageMap[str, ExecutionValue]
    def __init__(self, execution_id: _Optional[str] = ..., data: _Optional[_Mapping[str, ExecutionValue]] = ...) -> None: ...

class ExecutionValue(_message.Message):
    __slots__ = ("value", "is_secret")
    VALUE_FIELD_NUMBER: _ClassVar[int]
    IS_SECRET_FIELD_NUMBER: _ClassVar[int]
    value: str
    is_secret: bool
    def __init__(self, value: _Optional[str] = ..., is_secret: bool = ...) -> None: ...
