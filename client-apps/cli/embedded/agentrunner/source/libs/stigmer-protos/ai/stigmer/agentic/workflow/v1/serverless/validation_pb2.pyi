import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ValidationState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    VALIDATION_STATE_UNSPECIFIED: _ClassVar[ValidationState]
    PENDING: _ClassVar[ValidationState]
    VALID: _ClassVar[ValidationState]
    INVALID: _ClassVar[ValidationState]
    FAILED: _ClassVar[ValidationState]
VALIDATION_STATE_UNSPECIFIED: ValidationState
PENDING: ValidationState
VALID: ValidationState
INVALID: ValidationState
FAILED: ValidationState

class ServerlessWorkflowValidation(_message.Message):
    __slots__ = ("state", "yaml", "errors", "warnings", "validated_at", "validation_workflow_id")
    STATE_FIELD_NUMBER: _ClassVar[int]
    YAML_FIELD_NUMBER: _ClassVar[int]
    ERRORS_FIELD_NUMBER: _ClassVar[int]
    WARNINGS_FIELD_NUMBER: _ClassVar[int]
    VALIDATED_AT_FIELD_NUMBER: _ClassVar[int]
    VALIDATION_WORKFLOW_ID_FIELD_NUMBER: _ClassVar[int]
    state: ValidationState
    yaml: str
    errors: _containers.RepeatedScalarFieldContainer[str]
    warnings: _containers.RepeatedScalarFieldContainer[str]
    validated_at: _timestamp_pb2.Timestamp
    validation_workflow_id: str
    def __init__(self, state: _Optional[_Union[ValidationState, str]] = ..., yaml: _Optional[str] = ..., errors: _Optional[_Iterable[str]] = ..., warnings: _Optional[_Iterable[str]] = ..., validated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., validation_workflow_id: _Optional[str] = ...) -> None: ...
