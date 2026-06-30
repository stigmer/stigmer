from ai.stigmer.agentic.agentexecution.v1 import approval_pb2 as _approval_pb2
from ai.stigmer.agentic.agentexecution.v1 import artifact_pb2 as _artifact_pb2
from ai.stigmer.agentic.agentexecution.v1 import context_pb2 as _context_pb2
from ai.stigmer.agentic.agentexecution.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.agentexecution.v1 import filereview_pb2 as _filereview_pb2
from ai.stigmer.agentic.agentexecution.v1 import message_pb2 as _message_pb2
from ai.stigmer.agentic.agentexecution.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.agentic.agentexecution.v1 import subagent_pb2 as _subagent_pb2
from ai.stigmer.agentic.agentexecution.v1 import todo_pb2 as _todo_pb2
from ai.stigmer.agentic.agentexecution.v1 import usage_pb2 as _usage_pb2
from ai.stigmer.agentic.agentexecution.v1 import writeback_pb2 as _writeback_pb2
from ai.stigmer.commons.apiresource import metadata_pb2 as _metadata_pb2
from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

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
    __slots__ = ("audit", "messages", "phase", "sub_agent_executions", "error", "started_at", "completed_at", "todos", "callback_token", "resolved_context", "pending_approvals", "approval_event_stream", "context_info", "artifacts", "workspace_write_backs", "setup_progress", "streaming_usage", "structured_output", "file_change_sets", "file_review_event_stream")
    class TodosEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: _todo_pb2.TodoItem
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[_todo_pb2.TodoItem, _Mapping]] = ...) -> None: ...
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    PHASE_FIELD_NUMBER: _ClassVar[int]
    SUB_AGENT_EXECUTIONS_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    TODOS_FIELD_NUMBER: _ClassVar[int]
    CALLBACK_TOKEN_FIELD_NUMBER: _ClassVar[int]
    RESOLVED_CONTEXT_FIELD_NUMBER: _ClassVar[int]
    PENDING_APPROVALS_FIELD_NUMBER: _ClassVar[int]
    APPROVAL_EVENT_STREAM_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_INFO_FIELD_NUMBER: _ClassVar[int]
    ARTIFACTS_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_WRITE_BACKS_FIELD_NUMBER: _ClassVar[int]
    SETUP_PROGRESS_FIELD_NUMBER: _ClassVar[int]
    STREAMING_USAGE_FIELD_NUMBER: _ClassVar[int]
    STRUCTURED_OUTPUT_FIELD_NUMBER: _ClassVar[int]
    FILE_CHANGE_SETS_FIELD_NUMBER: _ClassVar[int]
    FILE_REVIEW_EVENT_STREAM_FIELD_NUMBER: _ClassVar[int]
    audit: _status_pb2.ApiResourceAudit
    messages: _containers.RepeatedCompositeFieldContainer[_message_pb2.AgentMessage]
    phase: _enum_pb2.ExecutionPhase
    sub_agent_executions: _containers.RepeatedCompositeFieldContainer[_subagent_pb2.SubAgentExecution]
    error: str
    started_at: str
    completed_at: str
    todos: _containers.MessageMap[str, _todo_pb2.TodoItem]
    callback_token: bytes
    resolved_context: _context_pb2.ResolvedExecutionContext
    pending_approvals: _containers.RepeatedCompositeFieldContainer[_approval_pb2.PendingApproval]
    approval_event_stream: _approval_pb2.ApprovalEventStream
    context_info: _context_pb2.ContextInfo
    artifacts: _containers.RepeatedCompositeFieldContainer[_artifact_pb2.ExecutionArtifact]
    workspace_write_backs: _containers.RepeatedCompositeFieldContainer[_writeback_pb2.WorkspaceWriteBack]
    setup_progress: SetupProgress
    streaming_usage: _usage_pb2.StreamingUsageSummary
    structured_output: _struct_pb2.Struct
    file_change_sets: _containers.RepeatedCompositeFieldContainer[_filereview_pb2.FileChangeSet]
    file_review_event_stream: _filereview_pb2.FileReviewEventStream
    def __init__(self, audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ..., messages: _Optional[_Iterable[_Union[_message_pb2.AgentMessage, _Mapping]]] = ..., phase: _Optional[_Union[_enum_pb2.ExecutionPhase, str]] = ..., sub_agent_executions: _Optional[_Iterable[_Union[_subagent_pb2.SubAgentExecution, _Mapping]]] = ..., error: _Optional[str] = ..., started_at: _Optional[str] = ..., completed_at: _Optional[str] = ..., todos: _Optional[_Mapping[str, _todo_pb2.TodoItem]] = ..., callback_token: _Optional[bytes] = ..., resolved_context: _Optional[_Union[_context_pb2.ResolvedExecutionContext, _Mapping]] = ..., pending_approvals: _Optional[_Iterable[_Union[_approval_pb2.PendingApproval, _Mapping]]] = ..., approval_event_stream: _Optional[_Union[_approval_pb2.ApprovalEventStream, _Mapping]] = ..., context_info: _Optional[_Union[_context_pb2.ContextInfo, _Mapping]] = ..., artifacts: _Optional[_Iterable[_Union[_artifact_pb2.ExecutionArtifact, _Mapping]]] = ..., workspace_write_backs: _Optional[_Iterable[_Union[_writeback_pb2.WorkspaceWriteBack, _Mapping]]] = ..., setup_progress: _Optional[_Union[SetupProgress, _Mapping]] = ..., streaming_usage: _Optional[_Union[_usage_pb2.StreamingUsageSummary, _Mapping]] = ..., structured_output: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., file_change_sets: _Optional[_Iterable[_Union[_filereview_pb2.FileChangeSet, _Mapping]]] = ..., file_review_event_stream: _Optional[_Union[_filereview_pb2.FileReviewEventStream, _Mapping]] = ...) -> None: ...

class SetupProgress(_message.Message):
    __slots__ = ("current_phase",)
    CURRENT_PHASE_FIELD_NUMBER: _ClassVar[int]
    current_phase: str
    def __init__(self, current_phase: _Optional[str] = ...) -> None: ...
