from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ValidationState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    VALIDATION_STATE_UNSPECIFIED: _ClassVar[ValidationState]
    VALIDATION_STATE_VALID: _ClassVar[ValidationState]
    VALIDATION_STATE_INVALID: _ClassVar[ValidationState]
VALIDATION_STATE_UNSPECIFIED: ValidationState
VALIDATION_STATE_VALID: ValidationState
VALIDATION_STATE_INVALID: ValidationState

class McpServerStatus(_message.Message):
    __slots__ = ("validation_state", "validation_message", "audit")
    VALIDATION_STATE_FIELD_NUMBER: _ClassVar[int]
    VALIDATION_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    validation_state: ValidationState
    validation_message: str
    audit: _status_pb2.ApiResourceAudit
    def __init__(self, validation_state: _Optional[_Union[ValidationState, str]] = ..., validation_message: _Optional[str] = ..., audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ...) -> None: ...
