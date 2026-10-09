import datetime

from ai.stigmer.agentic.run.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.run.v1 import invocation_pb2 as _invocation_pb2
from ai.stigmer.agentic.session.v1 import spec_pb2 as _spec_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class RunSpec(_message.Message):
    __slots__ = ("session_id", "session_spec", "message", "run_config", "interaction_mode", "build_from_plan", "structured_output_schema", "tools", "disallowed_tools", "append_system_prompt", "auto_approve_all", "attachments", "workspace_file_refs", "supersedes_run_id", "conversation_catchup")
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_SPEC_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    RUN_CONFIG_FIELD_NUMBER: _ClassVar[int]
    INTERACTION_MODE_FIELD_NUMBER: _ClassVar[int]
    BUILD_FROM_PLAN_FIELD_NUMBER: _ClassVar[int]
    STRUCTURED_OUTPUT_SCHEMA_FIELD_NUMBER: _ClassVar[int]
    TOOLS_FIELD_NUMBER: _ClassVar[int]
    DISALLOWED_TOOLS_FIELD_NUMBER: _ClassVar[int]
    APPEND_SYSTEM_PROMPT_FIELD_NUMBER: _ClassVar[int]
    AUTO_APPROVE_ALL_FIELD_NUMBER: _ClassVar[int]
    ATTACHMENTS_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_FILE_REFS_FIELD_NUMBER: _ClassVar[int]
    SUPERSEDES_RUN_ID_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_CATCHUP_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    session_spec: _spec_pb2.SessionSpec
    message: str
    run_config: _invocation_pb2.RunConfig
    interaction_mode: _enum_pb2.InteractionMode
    build_from_plan: bool
    structured_output_schema: _struct_pb2.Struct
    tools: _containers.RepeatedScalarFieldContainer[str]
    disallowed_tools: _containers.RepeatedScalarFieldContainer[str]
    append_system_prompt: str
    auto_approve_all: bool
    attachments: _containers.RepeatedCompositeFieldContainer[Attachment]
    workspace_file_refs: _containers.RepeatedScalarFieldContainer[str]
    supersedes_run_id: str
    conversation_catchup: ConversationCatchup
    def __init__(self, session_id: _Optional[str] = ..., session_spec: _Optional[_Union[_spec_pb2.SessionSpec, _Mapping]] = ..., message: _Optional[str] = ..., run_config: _Optional[_Union[_invocation_pb2.RunConfig, _Mapping]] = ..., interaction_mode: _Optional[_Union[_enum_pb2.InteractionMode, str]] = ..., build_from_plan: bool = ..., structured_output_schema: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., tools: _Optional[_Iterable[str]] = ..., disallowed_tools: _Optional[_Iterable[str]] = ..., append_system_prompt: _Optional[str] = ..., auto_approve_all: bool = ..., attachments: _Optional[_Iterable[_Union[Attachment, _Mapping]]] = ..., workspace_file_refs: _Optional[_Iterable[str]] = ..., supersedes_run_id: _Optional[str] = ..., conversation_catchup: _Optional[_Union[ConversationCatchup, _Mapping]] = ...) -> None: ...

class Attachment(_message.Message):
    __slots__ = ("filename", "storage_key", "mount_path", "content_type", "extract", "local_path")
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    STORAGE_KEY_FIELD_NUMBER: _ClassVar[int]
    MOUNT_PATH_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    EXTRACT_FIELD_NUMBER: _ClassVar[int]
    LOCAL_PATH_FIELD_NUMBER: _ClassVar[int]
    filename: str
    storage_key: str
    mount_path: str
    content_type: str
    extract: bool
    local_path: str
    def __init__(self, filename: _Optional[str] = ..., storage_key: _Optional[str] = ..., mount_path: _Optional[str] = ..., content_type: _Optional[str] = ..., extract: bool = ..., local_path: _Optional[str] = ...) -> None: ...

class ConversationCatchup(_message.Message):
    __slots__ = ("digest", "window_end")
    DIGEST_FIELD_NUMBER: _ClassVar[int]
    WINDOW_END_FIELD_NUMBER: _ClassVar[int]
    digest: str
    window_end: _timestamp_pb2.Timestamp
    def __init__(self, digest: _Optional[str] = ..., window_end: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class DeclaredPreferences(_message.Message):
    __slots__ = ("org_context", "user_context")
    ORG_CONTEXT_FIELD_NUMBER: _ClassVar[int]
    USER_CONTEXT_FIELD_NUMBER: _ClassVar[int]
    org_context: str
    user_context: str
    def __init__(self, org_context: _Optional[str] = ..., user_context: _Optional[str] = ...) -> None: ...

class RecalledMemories(_message.Message):
    __slots__ = ("enabled", "facts")
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    FACTS_FIELD_NUMBER: _ClassVar[int]
    enabled: bool
    facts: _containers.RepeatedCompositeFieldContainer[RecalledMemoryFact]
    def __init__(self, enabled: bool = ..., facts: _Optional[_Iterable[_Union[RecalledMemoryFact, _Mapping]]] = ...) -> None: ...

class RecalledMemoryFact(_message.Message):
    __slots__ = ("memory_id", "content")
    MEMORY_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    memory_id: str
    content: str
    def __init__(self, memory_id: _Optional[str] = ..., content: _Optional[str] = ...) -> None: ...
