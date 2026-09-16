from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PluginState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    PLUGIN_STATE_UNSPECIFIED: _ClassVar[PluginState]
    PLUGIN_STATE_INSTALLING: _ClassVar[PluginState]
    PLUGIN_STATE_READY: _ClassVar[PluginState]
    PLUGIN_STATE_FAILED: _ClassVar[PluginState]
PLUGIN_STATE_UNSPECIFIED: PluginState
PLUGIN_STATE_INSTALLING: PluginState
PLUGIN_STATE_READY: PluginState
PLUGIN_STATE_FAILED: PluginState

class PluginStatus(_message.Message):
    __slots__ = ("audit", "digest", "artifact_storage_key", "state", "error", "materialized", "warnings")
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    DIGEST_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_STORAGE_KEY_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    MATERIALIZED_FIELD_NUMBER: _ClassVar[int]
    WARNINGS_FIELD_NUMBER: _ClassVar[int]
    audit: _status_pb2.ApiResourceAudit
    digest: str
    artifact_storage_key: str
    state: PluginState
    error: str
    materialized: PluginMaterialization
    warnings: _containers.RepeatedCompositeFieldContainer[PluginWarning]
    def __init__(self, audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ..., digest: _Optional[str] = ..., artifact_storage_key: _Optional[str] = ..., state: _Optional[_Union[PluginState, str]] = ..., error: _Optional[str] = ..., materialized: _Optional[_Union[PluginMaterialization, _Mapping]] = ..., warnings: _Optional[_Iterable[_Union[PluginWarning, _Mapping]]] = ...) -> None: ...

class PluginMaterialization(_message.Message):
    __slots__ = ("skills", "mcp_servers", "agents", "workflows")
    SKILLS_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVERS_FIELD_NUMBER: _ClassVar[int]
    AGENTS_FIELD_NUMBER: _ClassVar[int]
    WORKFLOWS_FIELD_NUMBER: _ClassVar[int]
    skills: int
    mcp_servers: int
    agents: int
    workflows: int
    def __init__(self, skills: _Optional[int] = ..., mcp_servers: _Optional[int] = ..., agents: _Optional[int] = ..., workflows: _Optional[int] = ...) -> None: ...

class PluginWarning(_message.Message):
    __slots__ = ("kind", "message", "path")
    KIND_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    kind: str
    message: str
    path: str
    def __init__(self, kind: _Optional[str] = ..., message: _Optional[str] = ..., path: _Optional[str] = ...) -> None: ...
