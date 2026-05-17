from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class TransformEngine(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TRANSFORM_ENGINE_UNSPECIFIED: _ClassVar[TransformEngine]
    TRANSFORM_ENGINE_JQ: _ClassVar[TransformEngine]
    TRANSFORM_ENGINE_JSONATA: _ClassVar[TransformEngine]
    TRANSFORM_ENGINE_TEMPLATE: _ClassVar[TransformEngine]
TRANSFORM_ENGINE_UNSPECIFIED: TransformEngine
TRANSFORM_ENGINE_JQ: TransformEngine
TRANSFORM_ENGINE_JSONATA: TransformEngine
TRANSFORM_ENGINE_TEMPLATE: TransformEngine

class TransformTaskConfig(_message.Message):
    __slots__ = ("engine", "expression", "input")
    ENGINE_FIELD_NUMBER: _ClassVar[int]
    EXPRESSION_FIELD_NUMBER: _ClassVar[int]
    INPUT_FIELD_NUMBER: _ClassVar[int]
    engine: TransformEngine
    expression: str
    input: str
    def __init__(self, engine: _Optional[_Union[TransformEngine, str]] = ..., expression: _Optional[str] = ..., input: _Optional[str] = ...) -> None: ...
