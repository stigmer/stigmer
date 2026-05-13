from ai.stigmer.agentic.agentexecution.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.workflowexecution.v1 import api_pb2 as _api_pb2
from ai.stigmer.agentic.workflowexecution.v1 import enum_pb2 as _enum_pb2_1
from ai.stigmer.agentic.workflowexecution.v1 import event_pb2 as _event_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class WorkflowExecutionId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class WorkflowId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class WorkflowExecutionList(_message.Message):
    __slots__ = ("total_pages", "entries")
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    total_pages: int
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.WorkflowExecution]
    def __init__(self, total_pages: _Optional[int] = ..., entries: _Optional[_Iterable[_Union[_api_pb2.WorkflowExecution, _Mapping]]] = ...) -> None: ...

class ListWorkflowExecutionsRequest(_message.Message):
    __slots__ = ("page_size", "page_token", "phase", "tags")
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    PHASE_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    page_size: int
    page_token: str
    phase: _enum_pb2_1.ExecutionPhase
    tags: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., phase: _Optional[_Union[_enum_pb2_1.ExecutionPhase, str]] = ..., tags: _Optional[_Iterable[str]] = ...) -> None: ...

class ListWorkflowExecutionsByWorkflowRequest(_message.Message):
    __slots__ = ("workflow_id", "page_size", "page_token")
    WORKFLOW_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    workflow_id: str
    page_size: int
    page_token: str
    def __init__(self, workflow_id: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

class WorkflowExecutionUpdateStatusInput(_message.Message):
    __slots__ = ("execution_id", "status", "events")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    EVENTS_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    status: _api_pb2.WorkflowExecutionStatus
    events: _containers.RepeatedCompositeFieldContainer[_event_pb2.WorkflowExecutionEvent]
    def __init__(self, execution_id: _Optional[str] = ..., status: _Optional[_Union[_api_pb2.WorkflowExecutionStatus, _Mapping]] = ..., events: _Optional[_Iterable[_Union[_event_pb2.WorkflowExecutionEvent, _Mapping]]] = ...) -> None: ...

class SubmitWorkflowApprovalInput(_message.Message):
    __slots__ = ("execution_id", "tool_call_id", "action", "comment")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    COMMENT_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    tool_call_id: str
    action: _enum_pb2.ApprovalAction
    comment: str
    def __init__(self, execution_id: _Optional[str] = ..., tool_call_id: _Optional[str] = ..., action: _Optional[_Union[_enum_pb2.ApprovalAction, str]] = ..., comment: _Optional[str] = ...) -> None: ...

class SubscribeWorkflowExecutionRequest(_message.Message):
    __slots__ = ("execution_id",)
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    def __init__(self, execution_id: _Optional[str] = ...) -> None: ...

class CancelWorkflowExecutionInput(_message.Message):
    __slots__ = ("id", "reason")
    ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    id: str
    reason: str
    def __init__(self, id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class TerminateWorkflowExecutionInput(_message.Message):
    __slots__ = ("id", "reason")
    ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    id: str
    reason: str
    def __init__(self, id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class RecoverWorkflowExecutionInput(_message.Message):
    __slots__ = ("id", "reason")
    ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    id: str
    reason: str
    def __init__(self, id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class PauseWorkflowExecutionInput(_message.Message):
    __slots__ = ("id", "reason")
    ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    id: str
    reason: str
    def __init__(self, id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class ResumeWorkflowExecutionInput(_message.Message):
    __slots__ = ("id",)
    ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    def __init__(self, id: _Optional[str] = ...) -> None: ...

class SendSignalInput(_message.Message):
    __slots__ = ("execution_id", "signal_name", "payload", "idempotency_key")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    SIGNAL_NAME_FIELD_NUMBER: _ClassVar[int]
    PAYLOAD_FIELD_NUMBER: _ClassVar[int]
    IDEMPOTENCY_KEY_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    signal_name: str
    payload: _struct_pb2.Struct
    idempotency_key: str
    def __init__(self, execution_id: _Optional[str] = ..., signal_name: _Optional[str] = ..., payload: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., idempotency_key: _Optional[str] = ...) -> None: ...

class GetEventLogRequest(_message.Message):
    __slots__ = ("execution_id", "after_sequence", "event_types", "task_name", "page_size")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    AFTER_SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    EVENT_TYPES_FIELD_NUMBER: _ClassVar[int]
    TASK_NAME_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    after_sequence: int
    event_types: _containers.RepeatedScalarFieldContainer[_event_pb2.WorkflowEventType]
    task_name: str
    page_size: int
    def __init__(self, execution_id: _Optional[str] = ..., after_sequence: _Optional[int] = ..., event_types: _Optional[_Iterable[_Union[_event_pb2.WorkflowEventType, str]]] = ..., task_name: _Optional[str] = ..., page_size: _Optional[int] = ...) -> None: ...

class GetEventLogResponse(_message.Message):
    __slots__ = ("events", "has_more", "latest_sequence")
    EVENTS_FIELD_NUMBER: _ClassVar[int]
    HAS_MORE_FIELD_NUMBER: _ClassVar[int]
    LATEST_SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    events: _containers.RepeatedCompositeFieldContainer[_event_pb2.WorkflowExecutionEvent]
    has_more: bool
    latest_sequence: int
    def __init__(self, events: _Optional[_Iterable[_Union[_event_pb2.WorkflowExecutionEvent, _Mapping]]] = ..., has_more: bool = ..., latest_sequence: _Optional[int] = ...) -> None: ...

class SubscribeEventsRequest(_message.Message):
    __slots__ = ("execution_id", "after_sequence", "event_types")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    AFTER_SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    EVENT_TYPES_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    after_sequence: int
    event_types: _containers.RepeatedScalarFieldContainer[_event_pb2.WorkflowEventType]
    def __init__(self, execution_id: _Optional[str] = ..., after_sequence: _Optional[int] = ..., event_types: _Optional[_Iterable[_Union[_event_pb2.WorkflowEventType, str]]] = ...) -> None: ...
