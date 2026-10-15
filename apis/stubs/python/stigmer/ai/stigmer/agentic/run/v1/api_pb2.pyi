from ai.stigmer.agentic.run.v1 import artifact_pb2 as _artifact_pb2
from ai.stigmer.agentic.run.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.run.v1 import eval_case_pb2 as _eval_case_pb2
from ai.stigmer.agentic.run.v1 import filereview_pb2 as _filereview_pb2
from ai.stigmer.agentic.run.v1 import invocation_pb2 as _invocation_pb2
from ai.stigmer.agentic.run.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.agentic.run.v1 import usage_pb2 as _usage_pb2
from ai.stigmer.agentic.run.v1 import writeback_pb2 as _writeback_pb2
from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from ai.stigmer.commons.apiresource import metadata_pb2 as _metadata_pb2
from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Run(_message.Message):
    __slots__ = ("api_version", "kind", "metadata", "spec", "status")
    API_VERSION_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    SPEC_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    api_version: str
    kind: str
    metadata: _metadata_pb2.ApiResourceMetadata
    spec: _spec_pb2.RunSpec
    status: RunStatus
    def __init__(self, api_version: _Optional[str] = ..., kind: _Optional[str] = ..., metadata: _Optional[_Union[_metadata_pb2.ApiResourceMetadata, _Mapping]] = ..., spec: _Optional[_Union[_spec_pb2.RunSpec, _Mapping]] = ..., status: _Optional[_Union[RunStatus, _Mapping]] = ...) -> None: ...

class RunStatus(_message.Message):
    __slots__ = ("audit", "phase", "error", "started_at", "completed_at", "artifacts", "workspace_write_backs", "setup_progress", "streaming_usage", "file_change_progress", "file_changes", "agent_id", "agent_version_hash", "loaded_versions", "declared_preferences", "recalled_memories", "run_config", "approval_mode", "credentials", "eval_files", "stop_cause")
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    PHASE_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    ARTIFACTS_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_WRITE_BACKS_FIELD_NUMBER: _ClassVar[int]
    SETUP_PROGRESS_FIELD_NUMBER: _ClassVar[int]
    STREAMING_USAGE_FIELD_NUMBER: _ClassVar[int]
    FILE_CHANGE_PROGRESS_FIELD_NUMBER: _ClassVar[int]
    FILE_CHANGES_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_VERSION_HASH_FIELD_NUMBER: _ClassVar[int]
    LOADED_VERSIONS_FIELD_NUMBER: _ClassVar[int]
    DECLARED_PREFERENCES_FIELD_NUMBER: _ClassVar[int]
    RECALLED_MEMORIES_FIELD_NUMBER: _ClassVar[int]
    RUN_CONFIG_FIELD_NUMBER: _ClassVar[int]
    APPROVAL_MODE_FIELD_NUMBER: _ClassVar[int]
    CREDENTIALS_FIELD_NUMBER: _ClassVar[int]
    EVAL_FILES_FIELD_NUMBER: _ClassVar[int]
    STOP_CAUSE_FIELD_NUMBER: _ClassVar[int]
    audit: _status_pb2.ApiResourceAudit
    phase: _enum_pb2.RunPhase
    error: str
    started_at: str
    completed_at: str
    artifacts: _containers.RepeatedCompositeFieldContainer[_artifact_pb2.RunArtifact]
    workspace_write_backs: _containers.RepeatedCompositeFieldContainer[_writeback_pb2.WorkspaceWriteBack]
    setup_progress: SetupProgress
    streaming_usage: _usage_pb2.StreamingUsageSummary
    file_change_progress: _filereview_pb2.FileChangeProgress
    file_changes: _containers.RepeatedCompositeFieldContainer[_filereview_pb2.FileChangeSet]
    agent_id: str
    agent_version_hash: str
    loaded_versions: LoadedVersions
    declared_preferences: _spec_pb2.DeclaredPreferences
    recalled_memories: _spec_pb2.RecalledMemories
    run_config: _invocation_pb2.RunConfig
    approval_mode: _enum_pb2.ApprovalMode
    credentials: RunCredentials
    eval_files: _eval_case_pb2.EvalFiles
    stop_cause: str
    def __init__(self, audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ..., phase: _Optional[_Union[_enum_pb2.RunPhase, str]] = ..., error: _Optional[str] = ..., started_at: _Optional[str] = ..., completed_at: _Optional[str] = ..., artifacts: _Optional[_Iterable[_Union[_artifact_pb2.RunArtifact, _Mapping]]] = ..., workspace_write_backs: _Optional[_Iterable[_Union[_writeback_pb2.WorkspaceWriteBack, _Mapping]]] = ..., setup_progress: _Optional[_Union[SetupProgress, _Mapping]] = ..., streaming_usage: _Optional[_Union[_usage_pb2.StreamingUsageSummary, _Mapping]] = ..., file_change_progress: _Optional[_Union[_filereview_pb2.FileChangeProgress, _Mapping]] = ..., file_changes: _Optional[_Iterable[_Union[_filereview_pb2.FileChangeSet, _Mapping]]] = ..., agent_id: _Optional[str] = ..., agent_version_hash: _Optional[str] = ..., loaded_versions: _Optional[_Union[LoadedVersions, _Mapping]] = ..., declared_preferences: _Optional[_Union[_spec_pb2.DeclaredPreferences, _Mapping]] = ..., recalled_memories: _Optional[_Union[_spec_pb2.RecalledMemories, _Mapping]] = ..., run_config: _Optional[_Union[_invocation_pb2.RunConfig, _Mapping]] = ..., approval_mode: _Optional[_Union[_enum_pb2.ApprovalMode, str]] = ..., credentials: _Optional[_Union[RunCredentials, _Mapping]] = ..., eval_files: _Optional[_Union[_eval_case_pb2.EvalFiles, _Mapping]] = ..., stop_cause: _Optional[str] = ...) -> None: ...

class LoadedVersions(_message.Message):
    __slots__ = ("skills", "plugins")
    SKILLS_FIELD_NUMBER: _ClassVar[int]
    PLUGINS_FIELD_NUMBER: _ClassVar[int]
    skills: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    plugins: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    def __init__(self, skills: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ..., plugins: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ...) -> None: ...

class RunCredentials(_message.Message):
    __slots__ = ("person", "sources")
    PERSON_FIELD_NUMBER: _ClassVar[int]
    SOURCES_FIELD_NUMBER: _ClassVar[int]
    person: str
    sources: _containers.RepeatedCompositeFieldContainer[RunValueSource]
    def __init__(self, person: _Optional[str] = ..., sources: _Optional[_Iterable[_Union[RunValueSource, _Mapping]]] = ...) -> None: ...

class RunValueSource(_message.Message):
    __slots__ = ("key", "declarer", "origin", "vault_id", "entry", "login", "plain_value")
    KEY_FIELD_NUMBER: _ClassVar[int]
    DECLARER_FIELD_NUMBER: _ClassVar[int]
    ORIGIN_FIELD_NUMBER: _ClassVar[int]
    VAULT_ID_FIELD_NUMBER: _ClassVar[int]
    ENTRY_FIELD_NUMBER: _ClassVar[int]
    LOGIN_FIELD_NUMBER: _ClassVar[int]
    PLAIN_VALUE_FIELD_NUMBER: _ClassVar[int]
    key: str
    declarer: RunValueDeclarer
    origin: _enum_pb2.RunValueOrigin
    vault_id: str
    entry: str
    login: bool
    plain_value: str
    def __init__(self, key: _Optional[str] = ..., declarer: _Optional[_Union[RunValueDeclarer, _Mapping]] = ..., origin: _Optional[_Union[_enum_pb2.RunValueOrigin, str]] = ..., vault_id: _Optional[str] = ..., entry: _Optional[str] = ..., login: bool = ..., plain_value: _Optional[str] = ...) -> None: ...

class RunValueDeclarer(_message.Message):
    __slots__ = ("kind", "name", "repository_url", "plugin_id", "server", "plugin_digest", "agent_id", "agent_version")
    KIND_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    REPOSITORY_URL_FIELD_NUMBER: _ClassVar[int]
    PLUGIN_ID_FIELD_NUMBER: _ClassVar[int]
    SERVER_FIELD_NUMBER: _ClassVar[int]
    PLUGIN_DIGEST_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_VERSION_FIELD_NUMBER: _ClassVar[int]
    kind: _enum_pb2.RunValueDeclarerKind
    name: str
    repository_url: str
    plugin_id: str
    server: str
    plugin_digest: str
    agent_id: str
    agent_version: str
    def __init__(self, kind: _Optional[_Union[_enum_pb2.RunValueDeclarerKind, str]] = ..., name: _Optional[str] = ..., repository_url: _Optional[str] = ..., plugin_id: _Optional[str] = ..., server: _Optional[str] = ..., plugin_digest: _Optional[str] = ..., agent_id: _Optional[str] = ..., agent_version: _Optional[str] = ...) -> None: ...

class SetupProgress(_message.Message):
    __slots__ = ("current_phase",)
    CURRENT_PHASE_FIELD_NUMBER: _ClassVar[int]
    current_phase: str
    def __init__(self, current_phase: _Optional[str] = ...) -> None: ...
