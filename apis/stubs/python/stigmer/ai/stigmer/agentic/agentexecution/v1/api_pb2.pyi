from ai.stigmer.agentic.agentexecution.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.agentexecution.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.commons.apiresource import metadata_pb2 as _metadata_pb2
from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ApprovalAction(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    APPROVAL_ACTION_UNSPECIFIED: _ClassVar[ApprovalAction]
    APPROVAL_ACTION_APPROVE: _ClassVar[ApprovalAction]
    APPROVAL_ACTION_SKIP: _ClassVar[ApprovalAction]
    APPROVAL_ACTION_REJECT: _ClassVar[ApprovalAction]
APPROVAL_ACTION_UNSPECIFIED: ApprovalAction
APPROVAL_ACTION_APPROVE: ApprovalAction
APPROVAL_ACTION_SKIP: ApprovalAction
APPROVAL_ACTION_REJECT: ApprovalAction

class AgentExecution(_message.Message):
    __slots__ = ("api_version", "kind", "metadata", "spec", "status")
    API_VERSION_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    SPEC_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    api_version: str
    kind: str
    metadata: _metadata_pb2.ApiResourceMetadata
    spec: _spec_pb2.AgentExecutionSpec
    status: AgentExecutionStatus
    def __init__(self, api_version: _Optional[str] = ..., kind: _Optional[str] = ..., metadata: _Optional[_Union[_metadata_pb2.ApiResourceMetadata, _Mapping]] = ..., spec: _Optional[_Union[_spec_pb2.AgentExecutionSpec, _Mapping]] = ..., status: _Optional[_Union[AgentExecutionStatus, _Mapping]] = ...) -> None: ...

class AgentExecutionStatus(_message.Message):
    __slots__ = ("audit", "messages", "phase", "tool_calls", "sub_agent_executions", "error", "started_at", "completed_at", "todos", "callback_token", "usage", "resolved_context", "pending_approvals", "context_info", "artifacts")
    class TodosEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: TodoItem
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[TodoItem, _Mapping]] = ...) -> None: ...
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    PHASE_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALLS_FIELD_NUMBER: _ClassVar[int]
    SUB_AGENT_EXECUTIONS_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    TODOS_FIELD_NUMBER: _ClassVar[int]
    CALLBACK_TOKEN_FIELD_NUMBER: _ClassVar[int]
    USAGE_FIELD_NUMBER: _ClassVar[int]
    RESOLVED_CONTEXT_FIELD_NUMBER: _ClassVar[int]
    PENDING_APPROVALS_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_INFO_FIELD_NUMBER: _ClassVar[int]
    ARTIFACTS_FIELD_NUMBER: _ClassVar[int]
    audit: _status_pb2.ApiResourceAudit
    messages: _containers.RepeatedCompositeFieldContainer[AgentMessage]
    phase: _enum_pb2.ExecutionPhase
    tool_calls: _containers.RepeatedCompositeFieldContainer[ToolCall]
    sub_agent_executions: _containers.RepeatedCompositeFieldContainer[SubAgentExecution]
    error: str
    started_at: str
    completed_at: str
    todos: _containers.MessageMap[str, TodoItem]
    callback_token: bytes
    usage: UsageMetrics
    resolved_context: ResolvedExecutionContext
    pending_approvals: _containers.RepeatedCompositeFieldContainer[PendingApproval]
    context_info: ContextInfo
    artifacts: _containers.RepeatedCompositeFieldContainer[ExecutionArtifact]
    def __init__(self, audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ..., messages: _Optional[_Iterable[_Union[AgentMessage, _Mapping]]] = ..., phase: _Optional[_Union[_enum_pb2.ExecutionPhase, str]] = ..., tool_calls: _Optional[_Iterable[_Union[ToolCall, _Mapping]]] = ..., sub_agent_executions: _Optional[_Iterable[_Union[SubAgentExecution, _Mapping]]] = ..., error: _Optional[str] = ..., started_at: _Optional[str] = ..., completed_at: _Optional[str] = ..., todos: _Optional[_Mapping[str, TodoItem]] = ..., callback_token: _Optional[bytes] = ..., usage: _Optional[_Union[UsageMetrics, _Mapping]] = ..., resolved_context: _Optional[_Union[ResolvedExecutionContext, _Mapping]] = ..., pending_approvals: _Optional[_Iterable[_Union[PendingApproval, _Mapping]]] = ..., context_info: _Optional[_Union[ContextInfo, _Mapping]] = ..., artifacts: _Optional[_Iterable[_Union[ExecutionArtifact, _Mapping]]] = ...) -> None: ...

class TodoItem(_message.Message):
    __slots__ = ("id", "content", "status", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    content: str
    status: _enum_pb2.TodoStatus
    created_at: str
    updated_at: str
    def __init__(self, id: _Optional[str] = ..., content: _Optional[str] = ..., status: _Optional[_Union[_enum_pb2.TodoStatus, str]] = ..., created_at: _Optional[str] = ..., updated_at: _Optional[str] = ...) -> None: ...

class AgentMessage(_message.Message):
    __slots__ = ("type", "content", "timestamp", "tool_calls", "metadata", "is_streaming", "token_count", "generation_duration_ms")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALLS_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    IS_STREAMING_FIELD_NUMBER: _ClassVar[int]
    TOKEN_COUNT_FIELD_NUMBER: _ClassVar[int]
    GENERATION_DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    type: _enum_pb2.MessageType
    content: str
    timestamp: str
    tool_calls: _containers.RepeatedCompositeFieldContainer[ToolCall]
    metadata: _struct_pb2.Struct
    is_streaming: bool
    token_count: int
    generation_duration_ms: int
    def __init__(self, type: _Optional[_Union[_enum_pb2.MessageType, str]] = ..., content: _Optional[str] = ..., timestamp: _Optional[str] = ..., tool_calls: _Optional[_Iterable[_Union[ToolCall, _Mapping]]] = ..., metadata: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., is_streaming: bool = ..., token_count: _Optional[int] = ..., generation_duration_ms: _Optional[int] = ...) -> None: ...

class ToolCall(_message.Message):
    __slots__ = ("id", "name", "args", "result", "status", "component_metadata", "started_at", "completed_at", "error", "requires_approval", "approval_message", "approval_requested_at", "approval_decided_at", "approved_by", "approval_action", "is_streaming", "mcp_server_slug")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    ARGS_FIELD_NUMBER: _ClassVar[int]
    RESULT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    COMPONENT_METADATA_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    REQUIRES_APPROVAL_FIELD_NUMBER: _ClassVar[int]
    APPROVAL_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    APPROVAL_REQUESTED_AT_FIELD_NUMBER: _ClassVar[int]
    APPROVAL_DECIDED_AT_FIELD_NUMBER: _ClassVar[int]
    APPROVED_BY_FIELD_NUMBER: _ClassVar[int]
    APPROVAL_ACTION_FIELD_NUMBER: _ClassVar[int]
    IS_STREAMING_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVER_SLUG_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    args: _struct_pb2.Struct
    result: str
    status: _enum_pb2.ToolCallStatus
    component_metadata: ComponentMetadata
    started_at: str
    completed_at: str
    error: str
    requires_approval: bool
    approval_message: str
    approval_requested_at: str
    approval_decided_at: str
    approved_by: str
    approval_action: ApprovalAction
    is_streaming: bool
    mcp_server_slug: str
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., args: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., result: _Optional[str] = ..., status: _Optional[_Union[_enum_pb2.ToolCallStatus, str]] = ..., component_metadata: _Optional[_Union[ComponentMetadata, _Mapping]] = ..., started_at: _Optional[str] = ..., completed_at: _Optional[str] = ..., error: _Optional[str] = ..., requires_approval: bool = ..., approval_message: _Optional[str] = ..., approval_requested_at: _Optional[str] = ..., approval_decided_at: _Optional[str] = ..., approved_by: _Optional[str] = ..., approval_action: _Optional[_Union[ApprovalAction, str]] = ..., is_streaming: bool = ..., mcp_server_slug: _Optional[str] = ...) -> None: ...

class ComponentMetadata(_message.Message):
    __slots__ = ("component_type", "component_group", "layout_hint", "metadata")
    COMPONENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    COMPONENT_GROUP_FIELD_NUMBER: _ClassVar[int]
    LAYOUT_HINT_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    component_type: str
    component_group: str
    layout_hint: str
    metadata: _struct_pb2.Struct
    def __init__(self, component_type: _Optional[str] = ..., component_group: _Optional[str] = ..., layout_hint: _Optional[str] = ..., metadata: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...) -> None: ...

class SubAgentExecution(_message.Message):
    __slots__ = ("id", "name", "input", "output", "status", "started_at", "completed_at", "error", "metadata", "tool_calls", "messages", "usage", "subject", "pending_approvals")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    INPUT_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALLS_FIELD_NUMBER: _ClassVar[int]
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    USAGE_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_FIELD_NUMBER: _ClassVar[int]
    PENDING_APPROVALS_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    input: str
    output: str
    status: _enum_pb2.SubAgentStatus
    started_at: str
    completed_at: str
    error: str
    metadata: _struct_pb2.Struct
    tool_calls: _containers.RepeatedCompositeFieldContainer[ToolCall]
    messages: _containers.RepeatedCompositeFieldContainer[AgentMessage]
    usage: UsageMetrics
    subject: str
    pending_approvals: _containers.RepeatedCompositeFieldContainer[PendingApproval]
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., input: _Optional[str] = ..., output: _Optional[str] = ..., status: _Optional[_Union[_enum_pb2.SubAgentStatus, str]] = ..., started_at: _Optional[str] = ..., completed_at: _Optional[str] = ..., error: _Optional[str] = ..., metadata: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., tool_calls: _Optional[_Iterable[_Union[ToolCall, _Mapping]]] = ..., messages: _Optional[_Iterable[_Union[AgentMessage, _Mapping]]] = ..., usage: _Optional[_Union[UsageMetrics, _Mapping]] = ..., subject: _Optional[str] = ..., pending_approvals: _Optional[_Iterable[_Union[PendingApproval, _Mapping]]] = ...) -> None: ...

class UsageMetrics(_message.Message):
    __slots__ = ("prompt_tokens", "completion_tokens", "total_tokens", "llm_call_count", "primary_model")
    PROMPT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    COMPLETION_TOKENS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_TOKENS_FIELD_NUMBER: _ClassVar[int]
    LLM_CALL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PRIMARY_MODEL_FIELD_NUMBER: _ClassVar[int]
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    llm_call_count: int
    primary_model: str
    def __init__(self, prompt_tokens: _Optional[int] = ..., completion_tokens: _Optional[int] = ..., total_tokens: _Optional[int] = ..., llm_call_count: _Optional[int] = ..., primary_model: _Optional[str] = ...) -> None: ...

class ResolvedExecutionContext(_message.Message):
    __slots__ = ("environment_keys", "mcp_servers", "skill_names")
    class McpServersEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: McpServerResolutionStatus
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[McpServerResolutionStatus, _Mapping]] = ...) -> None: ...
    ENVIRONMENT_KEYS_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVERS_FIELD_NUMBER: _ClassVar[int]
    SKILL_NAMES_FIELD_NUMBER: _ClassVar[int]
    environment_keys: _containers.RepeatedScalarFieldContainer[str]
    mcp_servers: _containers.MessageMap[str, McpServerResolutionStatus]
    skill_names: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, environment_keys: _Optional[_Iterable[str]] = ..., mcp_servers: _Optional[_Mapping[str, McpServerResolutionStatus]] = ..., skill_names: _Optional[_Iterable[str]] = ...) -> None: ...

class McpServerResolutionStatus(_message.Message):
    __slots__ = ("resolved", "message", "enabled_tool_count")
    RESOLVED_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    ENABLED_TOOL_COUNT_FIELD_NUMBER: _ClassVar[int]
    resolved: bool
    message: str
    enabled_tool_count: int
    def __init__(self, resolved: bool = ..., message: _Optional[str] = ..., enabled_tool_count: _Optional[int] = ...) -> None: ...

class SummarizationEvent(_message.Message):
    __slots__ = ("timestamp", "tokens_before", "tokens_after", "compression_ratio", "duration_ms", "summarization_model", "messages_before", "messages_after", "source")
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    TOKENS_BEFORE_FIELD_NUMBER: _ClassVar[int]
    TOKENS_AFTER_FIELD_NUMBER: _ClassVar[int]
    COMPRESSION_RATIO_FIELD_NUMBER: _ClassVar[int]
    DURATION_MS_FIELD_NUMBER: _ClassVar[int]
    SUMMARIZATION_MODEL_FIELD_NUMBER: _ClassVar[int]
    MESSAGES_BEFORE_FIELD_NUMBER: _ClassVar[int]
    MESSAGES_AFTER_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    timestamp: str
    tokens_before: int
    tokens_after: int
    compression_ratio: float
    duration_ms: int
    summarization_model: str
    messages_before: int
    messages_after: int
    source: _enum_pb2.SummarizationSource
    def __init__(self, timestamp: _Optional[str] = ..., tokens_before: _Optional[int] = ..., tokens_after: _Optional[int] = ..., compression_ratio: _Optional[float] = ..., duration_ms: _Optional[int] = ..., summarization_model: _Optional[str] = ..., messages_before: _Optional[int] = ..., messages_after: _Optional[int] = ..., source: _Optional[_Union[_enum_pb2.SummarizationSource, str]] = ...) -> None: ...

class ContextInfo(_message.Message):
    __slots__ = ("current_token_count", "context_window_limit", "summarization_trigger_threshold", "summarization_target_tokens", "summarization_enabled", "summarization_events", "utilization_percent")
    CURRENT_TOKEN_COUNT_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_WINDOW_LIMIT_FIELD_NUMBER: _ClassVar[int]
    SUMMARIZATION_TRIGGER_THRESHOLD_FIELD_NUMBER: _ClassVar[int]
    SUMMARIZATION_TARGET_TOKENS_FIELD_NUMBER: _ClassVar[int]
    SUMMARIZATION_ENABLED_FIELD_NUMBER: _ClassVar[int]
    SUMMARIZATION_EVENTS_FIELD_NUMBER: _ClassVar[int]
    UTILIZATION_PERCENT_FIELD_NUMBER: _ClassVar[int]
    current_token_count: int
    context_window_limit: int
    summarization_trigger_threshold: int
    summarization_target_tokens: int
    summarization_enabled: bool
    summarization_events: _containers.RepeatedCompositeFieldContainer[SummarizationEvent]
    utilization_percent: float
    def __init__(self, current_token_count: _Optional[int] = ..., context_window_limit: _Optional[int] = ..., summarization_trigger_threshold: _Optional[int] = ..., summarization_target_tokens: _Optional[int] = ..., summarization_enabled: bool = ..., summarization_events: _Optional[_Iterable[_Union[SummarizationEvent, _Mapping]]] = ..., utilization_percent: _Optional[float] = ...) -> None: ...

class ExecutionArtifact(_message.Message):
    __slots__ = ("name", "sandbox_path", "kind", "size_bytes", "storage_key", "download_url", "created_at", "expires_at")
    NAME_FIELD_NUMBER: _ClassVar[int]
    SANDBOX_PATH_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    STORAGE_KEY_FIELD_NUMBER: _ClassVar[int]
    DOWNLOAD_URL_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    name: str
    sandbox_path: str
    kind: _enum_pb2.ExecutionArtifactKind
    size_bytes: int
    storage_key: str
    download_url: str
    created_at: str
    expires_at: str
    def __init__(self, name: _Optional[str] = ..., sandbox_path: _Optional[str] = ..., kind: _Optional[_Union[_enum_pb2.ExecutionArtifactKind, str]] = ..., size_bytes: _Optional[int] = ..., storage_key: _Optional[str] = ..., download_url: _Optional[str] = ..., created_at: _Optional[str] = ..., expires_at: _Optional[str] = ...) -> None: ...

class PendingApproval(_message.Message):
    __slots__ = ("tool_call_id", "tool_name", "message", "args_preview", "requested_at", "from_sub_agent", "sub_agent_name", "child_agent_execution_id", "interrupt_id")
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    ARGS_PREVIEW_FIELD_NUMBER: _ClassVar[int]
    REQUESTED_AT_FIELD_NUMBER: _ClassVar[int]
    FROM_SUB_AGENT_FIELD_NUMBER: _ClassVar[int]
    SUB_AGENT_NAME_FIELD_NUMBER: _ClassVar[int]
    CHILD_AGENT_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    INTERRUPT_ID_FIELD_NUMBER: _ClassVar[int]
    tool_call_id: str
    tool_name: str
    message: str
    args_preview: str
    requested_at: str
    from_sub_agent: bool
    sub_agent_name: str
    child_agent_execution_id: str
    interrupt_id: str
    def __init__(self, tool_call_id: _Optional[str] = ..., tool_name: _Optional[str] = ..., message: _Optional[str] = ..., args_preview: _Optional[str] = ..., requested_at: _Optional[str] = ..., from_sub_agent: bool = ..., sub_agent_name: _Optional[str] = ..., child_agent_execution_id: _Optional[str] = ..., interrupt_id: _Optional[str] = ...) -> None: ...

class ChildApprovalNotification(_message.Message):
    __slots__ = ("execution_id", "pending_approvals")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    PENDING_APPROVALS_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    pending_approvals: _containers.RepeatedCompositeFieldContainer[PendingApproval]
    def __init__(self, execution_id: _Optional[str] = ..., pending_approvals: _Optional[_Iterable[_Union[PendingApproval, _Mapping]]] = ...) -> None: ...
