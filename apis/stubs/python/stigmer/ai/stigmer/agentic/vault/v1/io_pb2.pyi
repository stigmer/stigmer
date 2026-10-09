from ai.stigmer.agentic.vault.v1 import api_pb2 as _api_pb2
from ai.stigmer.commons.rpc import pagination_pb2 as _pagination_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

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
    __slots__ = ("org", "page_info")
    ORG_FIELD_NUMBER: _ClassVar[int]
    PAGE_INFO_FIELD_NUMBER: _ClassVar[int]
    org: str
    page_info: _pagination_pb2.PageInfo
    def __init__(self, org: _Optional[str] = ..., page_info: _Optional[_Union[_pagination_pb2.PageInfo, _Mapping]] = ...) -> None: ...

class VaultList(_message.Message):
    __slots__ = ("total_count", "items")
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    total_count: int
    items: _containers.RepeatedCompositeFieldContainer[_api_pb2.Vault]
    def __init__(self, total_count: _Optional[int] = ..., items: _Optional[_Iterable[_Union[_api_pb2.Vault, _Mapping]]] = ...) -> None: ...
