from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PendingApproval(_message.Message):
    __slots__ = ("tool_call_id", "tool_name", "message", "args_preview", "requested_at", "from_sub_agent", "sub_agent_name", "mcp_server_slug", "sub_agent_subject", "agent_rationale", "branch_at_deny", "head_sha_at_deny")
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
    def __init__(self, tool_call_id: _Optional[str] = ..., tool_name: _Optional[str] = ..., message: _Optional[str] = ..., args_preview: _Optional[str] = ..., requested_at: _Optional[str] = ..., from_sub_agent: bool = ..., sub_agent_name: _Optional[str] = ..., mcp_server_slug: _Optional[str] = ..., sub_agent_subject: _Optional[str] = ..., agent_rationale: _Optional[str] = ..., branch_at_deny: _Optional[str] = ..., head_sha_at_deny: _Optional[str] = ...) -> None: ...

class ChildApprovalNotification(_message.Message):
    __slots__ = ("execution_id", "pending_approvals")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    PENDING_APPROVALS_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    pending_approvals: _containers.RepeatedCompositeFieldContainer[PendingApproval]
    def __init__(self, execution_id: _Optional[str] = ..., pending_approvals: _Optional[_Iterable[_Union[PendingApproval, _Mapping]]] = ...) -> None: ...
