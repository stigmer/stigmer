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

class HumanInputTimeoutPolicy(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    HUMAN_INPUT_TIMEOUT_POLICY_UNSPECIFIED: _ClassVar[HumanInputTimeoutPolicy]
    HUMAN_INPUT_TIMEOUT_FAIL: _ClassVar[HumanInputTimeoutPolicy]
    HUMAN_INPUT_TIMEOUT_APPROVE: _ClassVar[HumanInputTimeoutPolicy]
    HUMAN_INPUT_TIMEOUT_DENY: _ClassVar[HumanInputTimeoutPolicy]
    HUMAN_INPUT_TIMEOUT_ESCALATE: _ClassVar[HumanInputTimeoutPolicy]
HUMAN_INPUT_TIMEOUT_POLICY_UNSPECIFIED: HumanInputTimeoutPolicy
HUMAN_INPUT_TIMEOUT_FAIL: HumanInputTimeoutPolicy
HUMAN_INPUT_TIMEOUT_APPROVE: HumanInputTimeoutPolicy
HUMAN_INPUT_TIMEOUT_DENY: HumanInputTimeoutPolicy
HUMAN_INPUT_TIMEOUT_ESCALATE: HumanInputTimeoutPolicy

class HumanInputOutcome(_message.Message):
    __slots__ = ("name", "label", "then")
    NAME_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    THEN_FIELD_NUMBER: _ClassVar[int]
    name: str
    label: str
    then: str
    def __init__(self, name: _Optional[str] = ..., label: _Optional[str] = ..., then: _Optional[str] = ...) -> None: ...

class HumanInputTaskConfig(_message.Message):
    __slots__ = ("prompt", "form_schema", "outcomes", "approvers", "timeout", "on_timeout", "notification_channels")
    PROMPT_FIELD_NUMBER: _ClassVar[int]
    FORM_SCHEMA_FIELD_NUMBER: _ClassVar[int]
    OUTCOMES_FIELD_NUMBER: _ClassVar[int]
    APPROVERS_FIELD_NUMBER: _ClassVar[int]
    TIMEOUT_FIELD_NUMBER: _ClassVar[int]
    ON_TIMEOUT_FIELD_NUMBER: _ClassVar[int]
    NOTIFICATION_CHANNELS_FIELD_NUMBER: _ClassVar[int]
    prompt: str
    form_schema: _struct_pb2.Struct
    outcomes: _containers.RepeatedCompositeFieldContainer[HumanInputOutcome]
    approvers: _containers.RepeatedScalarFieldContainer[str]
    timeout: int
    on_timeout: HumanInputTimeoutPolicy
    notification_channels: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, prompt: _Optional[str] = ..., form_schema: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., outcomes: _Optional[_Iterable[_Union[HumanInputOutcome, _Mapping]]] = ..., approvers: _Optional[_Iterable[str]] = ..., timeout: _Optional[int] = ..., on_timeout: _Optional[_Union[HumanInputTimeoutPolicy, str]] = ..., notification_channels: _Optional[_Iterable[str]] = ...) -> None: ...
