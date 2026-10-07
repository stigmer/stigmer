from ai.stigmer.agentic.credential.v1 import api_pb2 as _api_pb2
from ai.stigmer.agentic.credential.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.commons.rpc import pagination_pb2 as _pagination_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class CredentialId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class SetCredentialFieldsInput(_message.Message):
    __slots__ = ("credential_id", "fields")
    class FieldsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: _spec_pb2.CredentialField
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[_spec_pb2.CredentialField, _Mapping]] = ...) -> None: ...
    CREDENTIAL_ID_FIELD_NUMBER: _ClassVar[int]
    FIELDS_FIELD_NUMBER: _ClassVar[int]
    credential_id: str
    fields: _containers.MessageMap[str, _spec_pb2.CredentialField]
    def __init__(self, credential_id: _Optional[str] = ..., fields: _Optional[_Mapping[str, _spec_pb2.CredentialField]] = ...) -> None: ...

class RemoveCredentialFieldsInput(_message.Message):
    __slots__ = ("credential_id", "fields")
    CREDENTIAL_ID_FIELD_NUMBER: _ClassVar[int]
    FIELDS_FIELD_NUMBER: _ClassVar[int]
    credential_id: str
    fields: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, credential_id: _Optional[str] = ..., fields: _Optional[_Iterable[str]] = ...) -> None: ...

class RevealCredentialFieldInput(_message.Message):
    __slots__ = ("credential_id", "field")
    CREDENTIAL_ID_FIELD_NUMBER: _ClassVar[int]
    FIELD_FIELD_NUMBER: _ClassVar[int]
    credential_id: str
    field: str
    def __init__(self, credential_id: _Optional[str] = ..., field: _Optional[str] = ...) -> None: ...

class ListCredentialsInput(_message.Message):
    __slots__ = ("org", "page_info")
    ORG_FIELD_NUMBER: _ClassVar[int]
    PAGE_INFO_FIELD_NUMBER: _ClassVar[int]
    org: str
    page_info: _pagination_pb2.PageInfo
    def __init__(self, org: _Optional[str] = ..., page_info: _Optional[_Union[_pagination_pb2.PageInfo, _Mapping]] = ...) -> None: ...

class CredentialList(_message.Message):
    __slots__ = ("total_count", "items")
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    total_count: int
    items: _containers.RepeatedCompositeFieldContainer[_api_pb2.Credential]
    def __init__(self, total_count: _Optional[int] = ..., items: _Optional[_Iterable[_Union[_api_pb2.Credential, _Mapping]]] = ...) -> None: ...
