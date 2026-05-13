from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ValidationFailPolicy(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    VALIDATION_FAIL_POLICY_UNSPECIFIED: _ClassVar[ValidationFailPolicy]
    VALIDATION_FAIL_RAISE: _ClassVar[ValidationFailPolicy]
    VALIDATION_FAIL_BRANCH: _ClassVar[ValidationFailPolicy]
    VALIDATION_FAIL_WARN: _ClassVar[ValidationFailPolicy]
VALIDATION_FAIL_POLICY_UNSPECIFIED: ValidationFailPolicy
VALIDATION_FAIL_RAISE: ValidationFailPolicy
VALIDATION_FAIL_BRANCH: ValidationFailPolicy
VALIDATION_FAIL_WARN: ValidationFailPolicy

class ValidationRule(_message.Message):
    __slots__ = ("name", "expression", "message")
    NAME_FIELD_NUMBER: _ClassVar[int]
    EXPRESSION_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    name: str
    expression: str
    message: str
    def __init__(self, name: _Optional[str] = ..., expression: _Optional[str] = ..., message: _Optional[str] = ...) -> None: ...

class ValidateTaskConfig(_message.Message):
    __slots__ = ("input", "schema", "rules", "on_fail", "fallback_task")
    INPUT_FIELD_NUMBER: _ClassVar[int]
    SCHEMA_FIELD_NUMBER: _ClassVar[int]
    RULES_FIELD_NUMBER: _ClassVar[int]
    ON_FAIL_FIELD_NUMBER: _ClassVar[int]
    FALLBACK_TASK_FIELD_NUMBER: _ClassVar[int]
    input: str
    schema: _struct_pb2.Struct
    rules: _containers.RepeatedCompositeFieldContainer[ValidationRule]
    on_fail: ValidationFailPolicy
    fallback_task: str
    def __init__(self, input: _Optional[str] = ..., schema: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., rules: _Optional[_Iterable[_Union[ValidationRule, _Mapping]]] = ..., on_fail: _Optional[_Union[ValidationFailPolicy, str]] = ..., fallback_task: _Optional[str] = ...) -> None: ...
