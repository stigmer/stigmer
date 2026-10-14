from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from ai.stigmer.iam.identityaccount.v1 import api_pb2 as _api_pb2
from ai.stigmer.iam.v1 import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import field_mask_pb2 as _field_mask_pb2
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

class IdentityAccountsList(_message.Message):
    __slots__ = ("entries", "next_page_token")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.IdentityAccount]
    next_page_token: str
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.IdentityAccount, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class ListServiceAccountsInput(_message.Message):
    __slots__ = ("org", "page_size", "page_token", "labels")
    class LabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ORG_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    org: str
    page_size: int
    page_token: str
    labels: _containers.ScalarMap[str, str]
    def __init__(self, org: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., labels: _Optional[_Mapping[str, str]] = ...) -> None: ...

class ExternalSubLookup(_message.Message):
    __slots__ = ("org", "federation_issuer_ref", "external_sub")
    ORG_FIELD_NUMBER: _ClassVar[int]
    FEDERATION_ISSUER_REF_FIELD_NUMBER: _ClassVar[int]
    EXTERNAL_SUB_FIELD_NUMBER: _ClassVar[int]
    org: str
    federation_issuer_ref: _io_pb2.ApiResourceReference
    external_sub: str
    def __init__(self, org: _Optional[str] = ..., federation_issuer_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., external_sub: _Optional[str] = ...) -> None: ...

class CreateFederatedAccountInput(_message.Message):
    __slots__ = ("org", "federation_issuer_ref", "external_sub", "email", "first_name", "last_name", "picture_url")
    ORG_FIELD_NUMBER: _ClassVar[int]
    FEDERATION_ISSUER_REF_FIELD_NUMBER: _ClassVar[int]
    EXTERNAL_SUB_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    FIRST_NAME_FIELD_NUMBER: _ClassVar[int]
    LAST_NAME_FIELD_NUMBER: _ClassVar[int]
    PICTURE_URL_FIELD_NUMBER: _ClassVar[int]
    org: str
    federation_issuer_ref: _io_pb2.ApiResourceReference
    external_sub: str
    email: str
    first_name: str
    last_name: str
    picture_url: str
    def __init__(self, org: _Optional[str] = ..., federation_issuer_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., external_sub: _Optional[str] = ..., email: _Optional[str] = ..., first_name: _Optional[str] = ..., last_name: _Optional[str] = ..., picture_url: _Optional[str] = ...) -> None: ...

class UpdateFederatedAccountInput(_message.Message):
    __slots__ = ("org", "federation_issuer_ref", "external_sub", "email", "first_name", "last_name", "picture_url")
    ORG_FIELD_NUMBER: _ClassVar[int]
    FEDERATION_ISSUER_REF_FIELD_NUMBER: _ClassVar[int]
    EXTERNAL_SUB_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    FIRST_NAME_FIELD_NUMBER: _ClassVar[int]
    LAST_NAME_FIELD_NUMBER: _ClassVar[int]
    PICTURE_URL_FIELD_NUMBER: _ClassVar[int]
    org: str
    federation_issuer_ref: _io_pb2.ApiResourceReference
    external_sub: str
    email: str
    first_name: str
    last_name: str
    picture_url: str
    def __init__(self, org: _Optional[str] = ..., federation_issuer_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., external_sub: _Optional[str] = ..., email: _Optional[str] = ..., first_name: _Optional[str] = ..., last_name: _Optional[str] = ..., picture_url: _Optional[str] = ...) -> None: ...

class DeprovisionFederatedAccountInput(_message.Message):
    __slots__ = ("org", "federation_issuer_ref", "external_sub", "delete_account")
    ORG_FIELD_NUMBER: _ClassVar[int]
    FEDERATION_ISSUER_REF_FIELD_NUMBER: _ClassVar[int]
    EXTERNAL_SUB_FIELD_NUMBER: _ClassVar[int]
    DELETE_ACCOUNT_FIELD_NUMBER: _ClassVar[int]
    org: str
    federation_issuer_ref: _io_pb2.ApiResourceReference
    external_sub: str
    delete_account: bool
    def __init__(self, org: _Optional[str] = ..., federation_issuer_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., external_sub: _Optional[str] = ..., delete_account: bool = ...) -> None: ...

class CreateServiceAccountInput(_message.Message):
    __slots__ = ("org", "name", "role")
    ORG_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    org: str
    name: str
    role: _enum_pb2.IamRole
    def __init__(self, org: _Optional[str] = ..., name: _Optional[str] = ..., role: _Optional[_Union[_enum_pb2.IamRole, str]] = ...) -> None: ...

class UpdateIdentityAccountInput(_message.Message):
    __slots__ = ("resource", "update_mask")
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    UPDATE_MASK_FIELD_NUMBER: _ClassVar[int]
    resource: _api_pb2.IdentityAccount
    update_mask: _field_mask_pb2.FieldMask
    def __init__(self, resource: _Optional[_Union[_api_pb2.IdentityAccount, _Mapping]] = ..., update_mask: _Optional[_Union[_field_mask_pb2.FieldMask, _Mapping]] = ...) -> None: ...
