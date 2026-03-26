from ai.stigmer.agentic.agentexecution.v1 import enum_pb2 as _enum_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ApprovalLifecycleState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    APPROVAL_LIFECYCLE_UNSPECIFIED: _ClassVar[ApprovalLifecycleState]
    APPROVAL_LIFECYCLE_REQUESTED: _ClassVar[ApprovalLifecycleState]
    APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED: _ClassVar[ApprovalLifecycleState]
    APPROVAL_LIFECYCLE_DECISION_RECORDED: _ClassVar[ApprovalLifecycleState]
    APPROVAL_LIFECYCLE_RESUME_RECONCILED: _ClassVar[ApprovalLifecycleState]
    APPROVAL_LIFECYCLE_CLEARED: _ClassVar[ApprovalLifecycleState]
APPROVAL_LIFECYCLE_UNSPECIFIED: ApprovalLifecycleState
APPROVAL_LIFECYCLE_REQUESTED: ApprovalLifecycleState
APPROVAL_LIFECYCLE_INTERRUPT_CAPTURED: ApprovalLifecycleState
APPROVAL_LIFECYCLE_DECISION_RECORDED: ApprovalLifecycleState
APPROVAL_LIFECYCLE_RESUME_RECONCILED: ApprovalLifecycleState
APPROVAL_LIFECYCLE_CLEARED: ApprovalLifecycleState

class PendingApproval(_message.Message):
    __slots__ = ("tool_call_id", "tool_name", "message", "args_preview", "requested_at", "from_sub_agent", "sub_agent_name", "child_agent_execution_id", "interrupt_id", "lifecycle_state", "decision_action", "decision_recorded_at")
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_NAME_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    ARGS_PREVIEW_FIELD_NUMBER: _ClassVar[int]
    REQUESTED_AT_FIELD_NUMBER: _ClassVar[int]
    FROM_SUB_AGENT_FIELD_NUMBER: _ClassVar[int]
    SUB_AGENT_NAME_FIELD_NUMBER: _ClassVar[int]
    CHILD_AGENT_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    INTERRUPT_ID_FIELD_NUMBER: _ClassVar[int]
    LIFECYCLE_STATE_FIELD_NUMBER: _ClassVar[int]
    DECISION_ACTION_FIELD_NUMBER: _ClassVar[int]
    DECISION_RECORDED_AT_FIELD_NUMBER: _ClassVar[int]
    tool_call_id: str
    tool_name: str
    message: str
    args_preview: str
    requested_at: str
    from_sub_agent: bool
    sub_agent_name: str
    child_agent_execution_id: str
    interrupt_id: str
    lifecycle_state: ApprovalLifecycleState
    decision_action: _enum_pb2.ApprovalAction
    decision_recorded_at: str
    def __init__(self, tool_call_id: _Optional[str] = ..., tool_name: _Optional[str] = ..., message: _Optional[str] = ..., args_preview: _Optional[str] = ..., requested_at: _Optional[str] = ..., from_sub_agent: bool = ..., sub_agent_name: _Optional[str] = ..., child_agent_execution_id: _Optional[str] = ..., interrupt_id: _Optional[str] = ..., lifecycle_state: _Optional[_Union[ApprovalLifecycleState, str]] = ..., decision_action: _Optional[_Union[_enum_pb2.ApprovalAction, str]] = ..., decision_recorded_at: _Optional[str] = ...) -> None: ...

class ChildApprovalNotification(_message.Message):
    __slots__ = ("execution_id", "pending_approvals")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    PENDING_APPROVALS_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    pending_approvals: _containers.RepeatedCompositeFieldContainer[PendingApproval]
    def __init__(self, execution_id: _Optional[str] = ..., pending_approvals: _Optional[_Iterable[_Union[PendingApproval, _Mapping]]] = ...) -> None: ...
