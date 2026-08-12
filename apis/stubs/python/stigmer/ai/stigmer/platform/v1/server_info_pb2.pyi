from ai.stigmer.commons.rpc import method_options_pb2 as _method_options_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ServerEdition(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    server_edition_unspecified: _ClassVar[ServerEdition]
    oss: _ClassVar[ServerEdition]
    cloud: _ClassVar[ServerEdition]
server_edition_unspecified: ServerEdition
oss: ServerEdition
cloud: ServerEdition

class GetServerInfoInput(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetServerInfoOutput(_message.Message):
    __slots__ = ("edition", "version")
    EDITION_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    edition: ServerEdition
    version: str
    def __init__(self, edition: _Optional[_Union[ServerEdition, str]] = ..., version: _Optional[str] = ...) -> None: ...

class GetRunnerBootstrapConfigInput(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetRunnerBootstrapConfigOutput(_message.Message):
    __slots__ = ("temporal_address", "temporal_namespace", "runner_access_token", "token_type", "runner_access_token_expires_in_seconds", "payload_encryption_key", "payload_encryption_key_id", "payload_encryption_secondary_key", "payload_encryption_secondary_key_id")
    TEMPORAL_ADDRESS_FIELD_NUMBER: _ClassVar[int]
    TEMPORAL_NAMESPACE_FIELD_NUMBER: _ClassVar[int]
    RUNNER_ACCESS_TOKEN_FIELD_NUMBER: _ClassVar[int]
    TOKEN_TYPE_FIELD_NUMBER: _ClassVar[int]
    RUNNER_ACCESS_TOKEN_EXPIRES_IN_SECONDS_FIELD_NUMBER: _ClassVar[int]
    PAYLOAD_ENCRYPTION_KEY_FIELD_NUMBER: _ClassVar[int]
    PAYLOAD_ENCRYPTION_KEY_ID_FIELD_NUMBER: _ClassVar[int]
    PAYLOAD_ENCRYPTION_SECONDARY_KEY_FIELD_NUMBER: _ClassVar[int]
    PAYLOAD_ENCRYPTION_SECONDARY_KEY_ID_FIELD_NUMBER: _ClassVar[int]
    temporal_address: str
    temporal_namespace: str
    runner_access_token: str
    token_type: str
    runner_access_token_expires_in_seconds: int
    payload_encryption_key: str
    payload_encryption_key_id: str
    payload_encryption_secondary_key: str
    payload_encryption_secondary_key_id: str
    def __init__(self, temporal_address: _Optional[str] = ..., temporal_namespace: _Optional[str] = ..., runner_access_token: _Optional[str] = ..., token_type: _Optional[str] = ..., runner_access_token_expires_in_seconds: _Optional[int] = ..., payload_encryption_key: _Optional[str] = ..., payload_encryption_key_id: _Optional[str] = ..., payload_encryption_secondary_key: _Optional[str] = ..., payload_encryption_secondary_key_id: _Optional[str] = ...) -> None: ...

class GetRunnerScopedTokenInput(_message.Message):
    __slots__ = ("agent_execution_id", "workflow_execution_id", "pool_claim", "renewal")
    AGENT_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    WORKFLOW_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    POOL_CLAIM_FIELD_NUMBER: _ClassVar[int]
    RENEWAL_FIELD_NUMBER: _ClassVar[int]
    agent_execution_id: str
    workflow_execution_id: str
    pool_claim: PoolClaim
    renewal: TokenRenewal
    def __init__(self, agent_execution_id: _Optional[str] = ..., workflow_execution_id: _Optional[str] = ..., pool_claim: _Optional[_Union[PoolClaim, _Mapping]] = ..., renewal: _Optional[_Union[TokenRenewal, _Mapping]] = ...) -> None: ...

class PoolClaim(_message.Message):
    __slots__ = ("session_id",)
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    def __init__(self, session_id: _Optional[str] = ...) -> None: ...

class TokenRenewal(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetRunnerScopedTokenOutput(_message.Message):
    __slots__ = ("runner_scoped_token", "token_type", "expires_in_seconds")
    RUNNER_SCOPED_TOKEN_FIELD_NUMBER: _ClassVar[int]
    TOKEN_TYPE_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_IN_SECONDS_FIELD_NUMBER: _ClassVar[int]
    runner_scoped_token: str
    token_type: str
    expires_in_seconds: int
    def __init__(self, runner_scoped_token: _Optional[str] = ..., token_type: _Optional[str] = ..., expires_in_seconds: _Optional[int] = ...) -> None: ...
