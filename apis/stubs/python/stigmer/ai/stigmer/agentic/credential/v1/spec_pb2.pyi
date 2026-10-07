from ai.stigmer.agentic.credential.v1 import requirement_pb2 as _requirement_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class CredentialSpec(_message.Message):
    __slots__ = ("person", "org", "description", "fields", "serves")
    class FieldsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: CredentialField
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[CredentialField, _Mapping]] = ...) -> None: ...
    PERSON_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    FIELDS_FIELD_NUMBER: _ClassVar[int]
    SERVES_FIELD_NUMBER: _ClassVar[int]
    person: str
    org: str
    description: str
    fields: _containers.MessageMap[str, CredentialField]
    serves: _containers.RepeatedCompositeFieldContainer[_requirement_pb2.CredentialTarget]
    def __init__(self, person: _Optional[str] = ..., org: _Optional[str] = ..., description: _Optional[str] = ..., fields: _Optional[_Mapping[str, CredentialField]] = ..., serves: _Optional[_Iterable[_Union[_requirement_pb2.CredentialTarget, _Mapping]]] = ...) -> None: ...

class CredentialField(_message.Message):
    __slots__ = ("value", "plain", "description")
    VALUE_FIELD_NUMBER: _ClassVar[int]
    PLAIN_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    value: str
    plain: bool
    description: str
    def __init__(self, value: _Optional[str] = ..., plain: bool = ..., description: _Optional[str] = ...) -> None: ...
