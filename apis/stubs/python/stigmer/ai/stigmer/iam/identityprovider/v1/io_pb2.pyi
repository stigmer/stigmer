from ai.stigmer.iam.identityprovider.v1 import api_pb2 as _api_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class IdentityProviderId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class IdentityProviders(_message.Message):
    __slots__ = ("entries",)
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.IdentityProvider]
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.IdentityProvider, _Mapping]]] = ...) -> None: ...

class IdentityProviderList(_message.Message):
    __slots__ = ("total_pages", "entries")
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    total_pages: int
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.IdentityProvider]
    def __init__(self, total_pages: _Optional[int] = ..., entries: _Optional[_Iterable[_Union[_api_pb2.IdentityProvider, _Mapping]]] = ...) -> None: ...

class ListIdentityProvidersByOrgInput(_message.Message):
    __slots__ = ("org",)
    ORG_FIELD_NUMBER: _ClassVar[int]
    org: str
    def __init__(self, org: _Optional[str] = ...) -> None: ...

class OrganizationSsoLookup(_message.Message):
    __slots__ = ("org",)
    ORG_FIELD_NUMBER: _ClassVar[int]
    org: str
    def __init__(self, org: _Optional[str] = ...) -> None: ...

class SsoProviderInfo(_message.Message):
    __slots__ = ("display_name", "oidc_client_id", "issuer")
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    OIDC_CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    ISSUER_FIELD_NUMBER: _ClassVar[int]
    display_name: str
    oidc_client_id: str
    issuer: str
    def __init__(self, display_name: _Optional[str] = ..., oidc_client_id: _Optional[str] = ..., issuer: _Optional[str] = ...) -> None: ...
