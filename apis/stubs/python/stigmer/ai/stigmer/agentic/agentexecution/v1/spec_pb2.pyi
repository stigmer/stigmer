from ai.stigmer.agentic.agentexecution.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.executioncontext.v1 import spec_pb2 as _spec_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentExecutionSpec(_message.Message):
    __slots__ = ("session_id", "agent_id", "message", "execution_config", "runtime_env", "callback_token", "auto_approve_all", "parent_workflow_id", "attachments", "workspace_file_refs", "activity_task_queue")
    class RuntimeEnvEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: _spec_pb2.ExecutionValue
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[_spec_pb2.ExecutionValue, _Mapping]] = ...) -> None: ...
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_CONFIG_FIELD_NUMBER: _ClassVar[int]
    RUNTIME_ENV_FIELD_NUMBER: _ClassVar[int]
    CALLBACK_TOKEN_FIELD_NUMBER: _ClassVar[int]
    AUTO_APPROVE_ALL_FIELD_NUMBER: _ClassVar[int]
    PARENT_WORKFLOW_ID_FIELD_NUMBER: _ClassVar[int]
    ATTACHMENTS_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_FILE_REFS_FIELD_NUMBER: _ClassVar[int]
    ACTIVITY_TASK_QUEUE_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    agent_id: str
    message: str
    execution_config: ExecutionConfig
    runtime_env: _containers.MessageMap[str, _spec_pb2.ExecutionValue]
    callback_token: bytes
    auto_approve_all: bool
    parent_workflow_id: str
    attachments: _containers.RepeatedCompositeFieldContainer[Attachment]
    workspace_file_refs: _containers.RepeatedScalarFieldContainer[str]
    activity_task_queue: str
    def __init__(self, session_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., message: _Optional[str] = ..., execution_config: _Optional[_Union[ExecutionConfig, _Mapping]] = ..., runtime_env: _Optional[_Mapping[str, _spec_pb2.ExecutionValue]] = ..., callback_token: _Optional[bytes] = ..., auto_approve_all: bool = ..., parent_workflow_id: _Optional[str] = ..., attachments: _Optional[_Iterable[_Union[Attachment, _Mapping]]] = ..., workspace_file_refs: _Optional[_Iterable[str]] = ..., activity_task_queue: _Optional[str] = ...) -> None: ...

class ExecutionConfig(_message.Message):
    __slots__ = ("model_name", "context_management", "max_tool_rounds", "max_tool_result_chars", "max_cost_usd", "interaction_mode")
    MODEL_NAME_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_MANAGEMENT_FIELD_NUMBER: _ClassVar[int]
    MAX_TOOL_ROUNDS_FIELD_NUMBER: _ClassVar[int]
    MAX_TOOL_RESULT_CHARS_FIELD_NUMBER: _ClassVar[int]
    MAX_COST_USD_FIELD_NUMBER: _ClassVar[int]
    INTERACTION_MODE_FIELD_NUMBER: _ClassVar[int]
    model_name: str
    context_management: ContextManagementConfig
    max_tool_rounds: int
    max_tool_result_chars: int
    max_cost_usd: float
    interaction_mode: _enum_pb2.InteractionMode
    def __init__(self, model_name: _Optional[str] = ..., context_management: _Optional[_Union[ContextManagementConfig, _Mapping]] = ..., max_tool_rounds: _Optional[int] = ..., max_tool_result_chars: _Optional[int] = ..., max_cost_usd: _Optional[float] = ..., interaction_mode: _Optional[_Union[_enum_pb2.InteractionMode, str]] = ...) -> None: ...

class ContextManagementConfig(_message.Message):
    __slots__ = ("disable_summarization", "custom_trigger_threshold", "custom_target_tokens")
    DISABLE_SUMMARIZATION_FIELD_NUMBER: _ClassVar[int]
    CUSTOM_TRIGGER_THRESHOLD_FIELD_NUMBER: _ClassVar[int]
    CUSTOM_TARGET_TOKENS_FIELD_NUMBER: _ClassVar[int]
    disable_summarization: bool
    custom_trigger_threshold: int
    custom_target_tokens: int
    def __init__(self, disable_summarization: bool = ..., custom_trigger_threshold: _Optional[int] = ..., custom_target_tokens: _Optional[int] = ...) -> None: ...

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
