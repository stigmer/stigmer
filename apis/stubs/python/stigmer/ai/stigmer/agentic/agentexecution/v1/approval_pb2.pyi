from ai.stigmer.agentic.agentexecution.v1 import enum_pb2 as _enum_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PendingApproval(_message.Message):
    __slots__ = ("tool_call_id", "tool_name", "message", "args_preview", "requested_at", "from_sub_agent", "sub_agent_name", "mcp_server_slug", "sub_agent_subject", "agent_rationale", "branch_at_deny", "head_sha_at_deny", "tool_kind", "approval_policy_source")
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    ARGS_PREVIEW_FIELD_NUMBER: _ClassVar[int]
    REQUESTED_AT_FIELD_NUMBER: _ClassVar[int]
    FROM_SUB_AGENT_FIELD_NUMBER: _ClassVar[int]
    SUB_AGENT_NAME_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVER_SLUG_FIELD_NUMBER: _ClassVar[int]
    SUB_AGENT_SUBJECT_FIELD_NUMBER: _ClassVar[int]
    AGENT_RATIONALE_FIELD_NUMBER: _ClassVar[int]
    BRANCH_AT_DENY_FIELD_NUMBER: _ClassVar[int]
    HEAD_SHA_AT_DENY_FIELD_NUMBER: _ClassVar[int]
    TOOL_KIND_FIELD_NUMBER: _ClassVar[int]
    APPROVAL_POLICY_SOURCE_FIELD_NUMBER: _ClassVar[int]
    tool_call_id: str
    tool_name: str
    message: str
    args_preview: str
    requested_at: str
    from_sub_agent: bool
    sub_agent_name: str
    mcp_server_slug: str
    sub_agent_subject: str
    agent_rationale: str
    branch_at_deny: str
    head_sha_at_deny: str
    tool_kind: _enum_pb2.ToolKind
    approval_policy_source: _enum_pb2.ApprovalPolicySource
    def __init__(self, tool_call_id: _Optional[str] = ..., tool_name: _Optional[str] = ..., message: _Optional[str] = ..., args_preview: _Optional[str] = ..., requested_at: _Optional[str] = ..., from_sub_agent: bool = ..., sub_agent_name: _Optional[str] = ..., mcp_server_slug: _Optional[str] = ..., sub_agent_subject: _Optional[str] = ..., agent_rationale: _Optional[str] = ..., branch_at_deny: _Optional[str] = ..., head_sha_at_deny: _Optional[str] = ..., tool_kind: _Optional[_Union[_enum_pb2.ToolKind, str]] = ..., approval_policy_source: _Optional[_Union[_enum_pb2.ApprovalPolicySource, str]] = ...) -> None: ...

class ChildApprovalNotification(_message.Message):
    __slots__ = ("execution_id", "pending_approvals")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    PENDING_APPROVALS_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    pending_approvals: _containers.RepeatedCompositeFieldContainer[PendingApproval]
    def __init__(self, execution_id: _Optional[str] = ..., pending_approvals: _Optional[_Iterable[_Union[PendingApproval, _Mapping]]] = ...) -> None: ...

class ApprovalRequest(_message.Message):
    __slots__ = ("approval_request_id", "tool_call_id", "requested_at", "tool_name", "message", "args_preview", "from_sub_agent", "sub_agent_name", "sub_agent_subject", "mcp_server_slug", "tool_kind", "approval_policy_source")
    APPROVAL_REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    REQUESTED_AT_FIELD_NUMBER: _ClassVar[int]
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    ARGS_PREVIEW_FIELD_NUMBER: _ClassVar[int]
    FROM_SUB_AGENT_FIELD_NUMBER: _ClassVar[int]
    SUB_AGENT_NAME_FIELD_NUMBER: _ClassVar[int]
    SUB_AGENT_SUBJECT_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVER_SLUG_FIELD_NUMBER: _ClassVar[int]
    TOOL_KIND_FIELD_NUMBER: _ClassVar[int]
    APPROVAL_POLICY_SOURCE_FIELD_NUMBER: _ClassVar[int]
    approval_request_id: str
    tool_call_id: str
    requested_at: str
    tool_name: str
    message: str
    args_preview: str
    from_sub_agent: bool
    sub_agent_name: str
    sub_agent_subject: str
    mcp_server_slug: str
    tool_kind: _enum_pb2.ToolKind
    approval_policy_source: _enum_pb2.ApprovalPolicySource
    def __init__(self, approval_request_id: _Optional[str] = ..., tool_call_id: _Optional[str] = ..., requested_at: _Optional[str] = ..., tool_name: _Optional[str] = ..., message: _Optional[str] = ..., args_preview: _Optional[str] = ..., from_sub_agent: bool = ..., sub_agent_name: _Optional[str] = ..., sub_agent_subject: _Optional[str] = ..., mcp_server_slug: _Optional[str] = ..., tool_kind: _Optional[_Union[_enum_pb2.ToolKind, str]] = ..., approval_policy_source: _Optional[_Union[_enum_pb2.ApprovalPolicySource, str]] = ...) -> None: ...

class ApprovalRetraction(_message.Message):
    __slots__ = ("approval_request_id", "reason", "retracted_at")
    APPROVAL_REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    RETRACTED_AT_FIELD_NUMBER: _ClassVar[int]
    approval_request_id: str
    reason: _enum_pb2.ApprovalRetractionReason
    retracted_at: str
    def __init__(self, approval_request_id: _Optional[str] = ..., reason: _Optional[_Union[_enum_pb2.ApprovalRetractionReason, str]] = ..., retracted_at: _Optional[str] = ...) -> None: ...

class ApprovalDecision(_message.Message):
    __slots__ = ("approval_request_id", "action", "decided_at", "decided_by", "comment")
    APPROVAL_REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    DECIDED_AT_FIELD_NUMBER: _ClassVar[int]
    DECIDED_BY_FIELD_NUMBER: _ClassVar[int]
    COMMENT_FIELD_NUMBER: _ClassVar[int]
    approval_request_id: str
    action: _enum_pb2.ApprovalAction
    decided_at: str
    decided_by: str
    comment: str
    def __init__(self, approval_request_id: _Optional[str] = ..., action: _Optional[_Union[_enum_pb2.ApprovalAction, str]] = ..., decided_at: _Optional[str] = ..., decided_by: _Optional[str] = ..., comment: _Optional[str] = ...) -> None: ...

class ApprovalEvent(_message.Message):
    __slots__ = ("event_id", "approval_request_id", "event_type", "timestamp", "actor", "requested", "decided", "retracted")
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    APPROVAL_REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    EVENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    REQUESTED_FIELD_NUMBER: _ClassVar[int]
    DECIDED_FIELD_NUMBER: _ClassVar[int]
    RETRACTED_FIELD_NUMBER: _ClassVar[int]
    event_id: str
    approval_request_id: str
    event_type: _enum_pb2.ApprovalEventType
    timestamp: str
    actor: str
    requested: ApprovalRequest
    decided: ApprovalDecision
    retracted: ApprovalRetraction
    def __init__(self, event_id: _Optional[str] = ..., approval_request_id: _Optional[str] = ..., event_type: _Optional[_Union[_enum_pb2.ApprovalEventType, str]] = ..., timestamp: _Optional[str] = ..., actor: _Optional[str] = ..., requested: _Optional[_Union[ApprovalRequest, _Mapping]] = ..., decided: _Optional[_Union[ApprovalDecision, _Mapping]] = ..., retracted: _Optional[_Union[ApprovalRetraction, _Mapping]] = ...) -> None: ...

class ApprovalEventStream(_message.Message):
    __slots__ = ("execution_id", "events")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    EVENTS_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    events: _containers.RepeatedCompositeFieldContainer[ApprovalEvent]
    def __init__(self, execution_id: _Optional[str] = ..., events: _Optional[_Iterable[_Union[ApprovalEvent, _Mapping]]] = ...) -> None: ...
