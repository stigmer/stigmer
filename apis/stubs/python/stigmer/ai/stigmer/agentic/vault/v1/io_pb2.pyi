import datetime

from ai.stigmer.agentic.vault.v1 import api_pb2 as _api_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import field_mask_pb2 as _field_mask_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SignInReturn(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    sign_in_return_unspecified: _ClassVar[SignInReturn]
    web: _ClassVar[SignInReturn]
    desktop: _ClassVar[SignInReturn]
    loopback: _ClassVar[SignInReturn]
sign_in_return_unspecified: SignInReturn
web: SignInReturn
desktop: SignInReturn
loopback: SignInReturn

class VaultTarget(_message.Message):
    __slots__ = ("org", "id", "mine")
    ORG_FIELD_NUMBER: _ClassVar[int]
    ID_FIELD_NUMBER: _ClassVar[int]
    MINE_FIELD_NUMBER: _ClassVar[int]
    org: str
    id: str
    mine: bool
    def __init__(self, org: _Optional[str] = ..., id: _Optional[str] = ..., mine: bool = ...) -> None: ...

class VaultSecretInput(_message.Message):
    __slots__ = ("value", "description")
    VALUE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    value: str
    description: str
    def __init__(self, value: _Optional[str] = ..., description: _Optional[str] = ...) -> None: ...

class SetVaultSecretsInput(_message.Message):
    __slots__ = ("vault", "secrets")
    class SecretsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: VaultSecretInput
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[VaultSecretInput, _Mapping]] = ...) -> None: ...
    VAULT_FIELD_NUMBER: _ClassVar[int]
    SECRETS_FIELD_NUMBER: _ClassVar[int]
    vault: VaultTarget
    secrets: _containers.MessageMap[str, VaultSecretInput]
    def __init__(self, vault: _Optional[_Union[VaultTarget, _Mapping]] = ..., secrets: _Optional[_Mapping[str, VaultSecretInput]] = ...) -> None: ...

class RemoveVaultSecretsInput(_message.Message):
    __slots__ = ("vault", "names")
    VAULT_FIELD_NUMBER: _ClassVar[int]
    NAMES_FIELD_NUMBER: _ClassVar[int]
    vault: VaultTarget
    names: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, vault: _Optional[_Union[VaultTarget, _Mapping]] = ..., names: _Optional[_Iterable[str]] = ...) -> None: ...

class SetVaultConnectionInput(_message.Message):
    __slots__ = ("vault", "address", "token", "description")
    VAULT_FIELD_NUMBER: _ClassVar[int]
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    vault: VaultTarget
    address: str
    token: str
    description: str
    def __init__(self, vault: _Optional[_Union[VaultTarget, _Mapping]] = ..., address: _Optional[str] = ..., token: _Optional[str] = ..., description: _Optional[str] = ...) -> None: ...

class RemoveVaultConnectionsInput(_message.Message):
    __slots__ = ("vault", "addresses")
    VAULT_FIELD_NUMBER: _ClassVar[int]
    ADDRESSES_FIELD_NUMBER: _ClassVar[int]
    vault: VaultTarget
    addresses: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, vault: _Optional[_Union[VaultTarget, _Mapping]] = ..., addresses: _Optional[_Iterable[str]] = ...) -> None: ...

class GetMyVaultInput(_message.Message):
    __slots__ = ("org",)
    ORG_FIELD_NUMBER: _ClassVar[int]
    org: str
    def __init__(self, org: _Optional[str] = ...) -> None: ...

class GetVaultByExternalIdInput(_message.Message):
    __slots__ = ("org", "external_id")
    ORG_FIELD_NUMBER: _ClassVar[int]
    EXTERNAL_ID_FIELD_NUMBER: _ClassVar[int]
    org: str
    external_id: str
    def __init__(self, org: _Optional[str] = ..., external_id: _Optional[str] = ...) -> None: ...

class ListVaultsRequest(_message.Message):
    __slots__ = ("org", "page_size", "page_token")
    ORG_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    org: str
    page_size: int
    page_token: str
    def __init__(self, org: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

class VaultList(_message.Message):
    __slots__ = ("entries", "next_page_token")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.Vault]
    next_page_token: str
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.Vault, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class StartSignInInput(_message.Message):
    __slots__ = ("vault", "address", "return_to", "loopback_port")
    VAULT_FIELD_NUMBER: _ClassVar[int]
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    RETURN_TO_FIELD_NUMBER: _ClassVar[int]
    LOOPBACK_PORT_FIELD_NUMBER: _ClassVar[int]
    vault: VaultTarget
    address: str
    return_to: SignInReturn
    loopback_port: int
    def __init__(self, vault: _Optional[_Union[VaultTarget, _Mapping]] = ..., address: _Optional[str] = ..., return_to: _Optional[_Union[SignInReturn, str]] = ..., loopback_port: _Optional[int] = ...) -> None: ...

class StartSignInOutput(_message.Message):
    __slots__ = ("authorization_url", "state", "provider_name", "scopes")
    AUTHORIZATION_URL_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_NAME_FIELD_NUMBER: _ClassVar[int]
    SCOPES_FIELD_NUMBER: _ClassVar[int]
    authorization_url: str
    state: str
    provider_name: str
    scopes: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, authorization_url: _Optional[str] = ..., state: _Optional[str] = ..., provider_name: _Optional[str] = ..., scopes: _Optional[_Iterable[str]] = ...) -> None: ...

class CompleteSignInInput(_message.Message):
    __slots__ = ("state", "code")
    STATE_FIELD_NUMBER: _ClassVar[int]
    CODE_FIELD_NUMBER: _ClassVar[int]
    state: str
    code: str
    def __init__(self, state: _Optional[str] = ..., code: _Optional[str] = ...) -> None: ...

class CompleteSignInOutput(_message.Message):
    __slots__ = ("address", "description")
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    address: str
    description: str
    def __init__(self, address: _Optional[str] = ..., description: _Optional[str] = ...) -> None: ...

class CreateConnectLinkInput(_message.Message):
    __slots__ = ("org", "vault_id", "address", "return_url", "expires_in_seconds")
    ORG_FIELD_NUMBER: _ClassVar[int]
    VAULT_ID_FIELD_NUMBER: _ClassVar[int]
    ADDRESS_FIELD_NUMBER: _ClassVar[int]
    RETURN_URL_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_IN_SECONDS_FIELD_NUMBER: _ClassVar[int]
    org: str
    vault_id: str
    address: str
    return_url: str
    expires_in_seconds: int
    def __init__(self, org: _Optional[str] = ..., vault_id: _Optional[str] = ..., address: _Optional[str] = ..., return_url: _Optional[str] = ..., expires_in_seconds: _Optional[int] = ...) -> None: ...

class ConnectLink(_message.Message):
    __slots__ = ("url", "expires_at")
    URL_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    url: str
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, url: _Optional[str] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class UpdateVaultInput(_message.Message):
    __slots__ = ("resource", "update_mask")
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    UPDATE_MASK_FIELD_NUMBER: _ClassVar[int]
    resource: _api_pb2.Vault
    update_mask: _field_mask_pb2.FieldMask
    def __init__(self, resource: _Optional[_Union[_api_pb2.Vault, _Mapping]] = ..., update_mask: _Optional[_Union[_field_mask_pb2.FieldMask, _Mapping]] = ...) -> None: ...
