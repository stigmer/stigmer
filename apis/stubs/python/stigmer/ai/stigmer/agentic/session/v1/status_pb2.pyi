from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SessionStatus(_message.Message):
    __slots__ = ("audit", "agent_id", "agent_version_hash", "vault_attachers", "state", "harness_state_id", "harness_state_id_history")
    class VaultAttachersEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_VERSION_HASH_FIELD_NUMBER: _ClassVar[int]
    VAULT_ATTACHERS_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    HARNESS_STATE_ID_FIELD_NUMBER: _ClassVar[int]
    HARNESS_STATE_ID_HISTORY_FIELD_NUMBER: _ClassVar[int]
    audit: _status_pb2.ApiResourceAudit
    agent_id: str
    agent_version_hash: str
    vault_attachers: _containers.ScalarMap[str, str]
    state: str
    harness_state_id: str
    harness_state_id_history: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ..., agent_id: _Optional[str] = ..., agent_version_hash: _Optional[str] = ..., vault_attachers: _Optional[_Mapping[str, str]] = ..., state: _Optional[str] = ..., harness_state_id: _Optional[str] = ..., harness_state_id_history: _Optional[_Iterable[str]] = ...) -> None: ...
