from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from ai.stigmer.commons.rpc import pagination_pb2 as _pagination_pb2
from ai.stigmer.iam.identityaccount.v1 import api_pb2 as _api_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class IdentityAccounts(_message.Message):
    __slots__ = ("entries",)
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.IdentityAccount]
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.IdentityAccount, _Mapping]]] = ...) -> None: ...

class IdentityAccountId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class IdentityAccountEmail(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class IdpId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class ListWithIdentityAccountIdReq(_message.Message):
    __slots__ = ("identity_account_id", "page")
    IDENTITY_ACCOUNT_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    identity_account_id: str
    page: _pagination_pb2.PageInfo
    def __init__(self, identity_account_id: _Optional[str] = ..., page: _Optional[_Union[_pagination_pb2.PageInfo, _Mapping]] = ...) -> None: ...

class IdentityAccountsList(_message.Message):
    __slots__ = ("total_pages", "entries")
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    total_pages: int
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.IdentityAccount]
    def __init__(self, total_pages: _Optional[int] = ..., entries: _Optional[_Iterable[_Union[_api_pb2.IdentityAccount, _Mapping]]] = ...) -> None: ...

class ListWithIdentityOrg(_message.Message):
    __slots__ = ("org", "page")
    ORG_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    org: str
    page: _pagination_pb2.PageInfo
    def __init__(self, org: _Optional[str] = ..., page: _Optional[_Union[_pagination_pb2.PageInfo, _Mapping]] = ...) -> None: ...

class ExternalSubLookup(_message.Message):
    __slots__ = ("org", "identity_provider_ref", "external_sub")
    ORG_FIELD_NUMBER: _ClassVar[int]
    IDENTITY_PROVIDER_REF_FIELD_NUMBER: _ClassVar[int]
    EXTERNAL_SUB_FIELD_NUMBER: _ClassVar[int]
    org: str
    identity_provider_ref: _io_pb2.ApiResourceReference
    external_sub: str
    def __init__(self, org: _Optional[str] = ..., identity_provider_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., external_sub: _Optional[str] = ...) -> None: ...

class CreateFederatedAccountInput(_message.Message):
    __slots__ = ("org", "identity_provider_ref", "external_sub", "email", "first_name", "last_name", "picture_url")
    ORG_FIELD_NUMBER: _ClassVar[int]
    IDENTITY_PROVIDER_REF_FIELD_NUMBER: _ClassVar[int]
    EXTERNAL_SUB_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    FIRST_NAME_FIELD_NUMBER: _ClassVar[int]
    LAST_NAME_FIELD_NUMBER: _ClassVar[int]
    PICTURE_URL_FIELD_NUMBER: _ClassVar[int]
    org: str
    identity_provider_ref: _io_pb2.ApiResourceReference
    external_sub: str
    email: str
    first_name: str
    last_name: str
    picture_url: str
    def __init__(self, org: _Optional[str] = ..., identity_provider_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., external_sub: _Optional[str] = ..., email: _Optional[str] = ..., first_name: _Optional[str] = ..., last_name: _Optional[str] = ..., picture_url: _Optional[str] = ...) -> None: ...

class UpdateFederatedAccountInput(_message.Message):
    __slots__ = ("org", "identity_provider_ref", "external_sub", "email", "first_name", "last_name", "picture_url")
    ORG_FIELD_NUMBER: _ClassVar[int]
    IDENTITY_PROVIDER_REF_FIELD_NUMBER: _ClassVar[int]
    EXTERNAL_SUB_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    FIRST_NAME_FIELD_NUMBER: _ClassVar[int]
    LAST_NAME_FIELD_NUMBER: _ClassVar[int]
    PICTURE_URL_FIELD_NUMBER: _ClassVar[int]
    org: str
    identity_provider_ref: _io_pb2.ApiResourceReference
    external_sub: str
    email: str
    first_name: str
    last_name: str
    picture_url: str
    def __init__(self, org: _Optional[str] = ..., identity_provider_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., external_sub: _Optional[str] = ..., email: _Optional[str] = ..., first_name: _Optional[str] = ..., last_name: _Optional[str] = ..., picture_url: _Optional[str] = ...) -> None: ...

class DeprovisionFederatedAccountInput(_message.Message):
    __slots__ = ("org", "identity_provider_ref", "external_sub", "delete_account")
    ORG_FIELD_NUMBER: _ClassVar[int]
    IDENTITY_PROVIDER_REF_FIELD_NUMBER: _ClassVar[int]
    EXTERNAL_SUB_FIELD_NUMBER: _ClassVar[int]
    DELETE_ACCOUNT_FIELD_NUMBER: _ClassVar[int]
    org: str
    identity_provider_ref: _io_pb2.ApiResourceReference
    external_sub: str
    delete_account: bool
    def __init__(self, org: _Optional[str] = ..., identity_provider_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., external_sub: _Optional[str] = ..., delete_account: bool = ...) -> None: ...
