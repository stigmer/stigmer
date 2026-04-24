from ai.stigmer.agentic.agent.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.agentic.session.v1 import workspace_pb2 as _workspace_pb2
from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SessionSpec(_message.Message):
    __slots__ = ("agent_instance_id", "subject", "thread_id", "sandbox_id", "metadata", "workspace_entries", "mcp_server_usages", "runner_id", "skill_refs")
    class MetadataEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    AGENT_INSTANCE_ID_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_FIELD_NUMBER: _ClassVar[int]
    THREAD_ID_FIELD_NUMBER: _ClassVar[int]
    SANDBOX_ID_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_ENTRIES_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVER_USAGES_FIELD_NUMBER: _ClassVar[int]
    RUNNER_ID_FIELD_NUMBER: _ClassVar[int]
    SKILL_REFS_FIELD_NUMBER: _ClassVar[int]
    agent_instance_id: str
    subject: str
    thread_id: str
    sandbox_id: str
    metadata: _containers.ScalarMap[str, str]
    workspace_entries: _containers.RepeatedCompositeFieldContainer[_workspace_pb2.WorkspaceEntry]
    mcp_server_usages: _containers.RepeatedCompositeFieldContainer[_spec_pb2.McpServerUsage]
    runner_id: str
    skill_refs: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    def __init__(self, agent_instance_id: _Optional[str] = ..., subject: _Optional[str] = ..., thread_id: _Optional[str] = ..., sandbox_id: _Optional[str] = ..., metadata: _Optional[_Mapping[str, str]] = ..., workspace_entries: _Optional[_Iterable[_Union[_workspace_pb2.WorkspaceEntry, _Mapping]]] = ..., mcp_server_usages: _Optional[_Iterable[_Union[_spec_pb2.McpServerUsage, _Mapping]]] = ..., runner_id: _Optional[str] = ..., skill_refs: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ...) -> None: ...
