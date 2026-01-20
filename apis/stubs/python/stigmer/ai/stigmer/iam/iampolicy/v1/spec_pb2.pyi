from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class IamPolicySpec(_message.Message):
    __slots__ = ("principal", "resource", "relation")
    PRINCIPAL_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    RELATION_FIELD_NUMBER: _ClassVar[int]
    principal: ApiResourceRef
    resource: ApiResourceRef
    relation: str
    def __init__(self, principal: _Optional[_Union[ApiResourceRef, _Mapping]] = ..., resource: _Optional[_Union[ApiResourceRef, _Mapping]] = ..., relation: _Optional[str] = ...) -> None: ...

class ApiResourceRef(_message.Message):
    __slots__ = ("kind", "id", "relation")
    KIND_FIELD_NUMBER: _ClassVar[int]
    ID_FIELD_NUMBER: _ClassVar[int]
    RELATION_FIELD_NUMBER: _ClassVar[int]
    kind: str
    id: str
    relation: str
    def __init__(self, kind: _Optional[str] = ..., id: _Optional[str] = ..., relation: _Optional[str] = ...) -> None: ...
