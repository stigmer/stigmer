import datetime

from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class VaultConnectionSource(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    vault_connection_source_unspecified: _ClassVar[VaultConnectionSource]
    pasted: _ClassVar[VaultConnectionSource]
    sign_in: _ClassVar[VaultConnectionSource]
vault_connection_source_unspecified: VaultConnectionSource
pasted: VaultConnectionSource
sign_in: VaultConnectionSource

class VaultSpec(_message.Message):
    __slots__ = ("person", "org", "description", "external_id", "secrets", "connections")
    class SecretsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: VaultSecret
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[VaultSecret, _Mapping]] = ...) -> None: ...
    class ConnectionsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: VaultConnection
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[VaultConnection, _Mapping]] = ...) -> None: ...
    PERSON_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    EXTERNAL_ID_FIELD_NUMBER: _ClassVar[int]
    SECRETS_FIELD_NUMBER: _ClassVar[int]
    CONNECTIONS_FIELD_NUMBER: _ClassVar[int]
    person: str
    org: str
    description: str
    external_id: str
    secrets: _containers.MessageMap[str, VaultSecret]
    connections: _containers.MessageMap[str, VaultConnection]
    def __init__(self, person: _Optional[str] = ..., org: _Optional[str] = ..., description: _Optional[str] = ..., external_id: _Optional[str] = ..., secrets: _Optional[_Mapping[str, VaultSecret]] = ..., connections: _Optional[_Mapping[str, VaultConnection]] = ...) -> None: ...

class VaultSecret(_message.Message):
    __slots__ = ("value", "description", "saved_by", "saved_at")
    VALUE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    SAVED_BY_FIELD_NUMBER: _ClassVar[int]
    SAVED_AT_FIELD_NUMBER: _ClassVar[int]
    value: str
    description: str
    saved_by: str
    saved_at: _timestamp_pb2.Timestamp
    def __init__(self, value: _Optional[str] = ..., description: _Optional[str] = ..., saved_by: _Optional[str] = ..., saved_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class VaultConnection(_message.Message):
    __slots__ = ("token", "source", "sign_in", "description", "saved_by", "saved_at")
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    SIGN_IN_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    SAVED_BY_FIELD_NUMBER: _ClassVar[int]
    SAVED_AT_FIELD_NUMBER: _ClassVar[int]
    token: str
    source: VaultConnectionSource
    sign_in: VaultConnectionSignIn
    description: str
    saved_by: str
    saved_at: _timestamp_pb2.Timestamp
    def __init__(self, token: _Optional[str] = ..., source: _Optional[_Union[VaultConnectionSource, str]] = ..., sign_in: _Optional[_Union[VaultConnectionSignIn, _Mapping]] = ..., description: _Optional[str] = ..., saved_by: _Optional[str] = ..., saved_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class VaultConnectionSignIn(_message.Message):
    __slots__ = ("expires_at", "client_id", "auth_method", "token_endpoint", "refresh_token", "mcp_server_id", "local_program")
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    AUTH_METHOD_FIELD_NUMBER: _ClassVar[int]
    TOKEN_ENDPOINT_FIELD_NUMBER: _ClassVar[int]
    REFRESH_TOKEN_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVER_ID_FIELD_NUMBER: _ClassVar[int]
    LOCAL_PROGRAM_FIELD_NUMBER: _ClassVar[int]
    expires_at: int
    client_id: str
    auth_method: str
    token_endpoint: str
    refresh_token: str
    mcp_server_id: str
    local_program: bool
    def __init__(self, expires_at: _Optional[int] = ..., client_id: _Optional[str] = ..., auth_method: _Optional[str] = ..., token_endpoint: _Optional[str] = ..., refresh_token: _Optional[str] = ..., mcp_server_id: _Optional[str] = ..., local_program: bool = ...) -> None: ...
