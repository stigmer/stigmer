from ai.stigmer.agentic.workflowexecution.v1 import api_pb2 as _api_pb2
from ai.stigmer.agentic.workflowexecution.v1 import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class WorkflowUpdateType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    workflow_update_type_unspecified: _ClassVar[WorkflowUpdateType]
    wf_update_status_changed: _ClassVar[WorkflowUpdateType]
    wf_update_task_started: _ClassVar[WorkflowUpdateType]
    wf_update_task_completed: _ClassVar[WorkflowUpdateType]
    wf_update_task_failed: _ClassVar[WorkflowUpdateType]
    wf_update_execution_completed: _ClassVar[WorkflowUpdateType]
    wf_update_execution_cancelled: _ClassVar[WorkflowUpdateType]
workflow_update_type_unspecified: WorkflowUpdateType
wf_update_status_changed: WorkflowUpdateType
wf_update_task_started: WorkflowUpdateType
wf_update_task_completed: WorkflowUpdateType
wf_update_task_failed: WorkflowUpdateType
wf_update_execution_completed: WorkflowUpdateType
wf_update_execution_cancelled: WorkflowUpdateType

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
    phase: _enum_pb2.ExecutionPhase
    tags: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., phase: _Optional[_Union[_enum_pb2.ExecutionPhase, str]] = ..., tags: _Optional[_Iterable[str]] = ...) -> None: ...

class ListWorkflowExecutionsByWorkflowRequest(_message.Message):
    __slots__ = ("workflow_id", "page_size", "page_token")
    WORKFLOW_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    workflow_id: str
    page_size: int
    page_token: str
    def __init__(self, workflow_id: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

class SubscribeWorkflowExecutionRequest(_message.Message):
    __slots__ = ("execution_id",)
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    def __init__(self, execution_id: _Optional[str] = ...) -> None: ...

class WorkflowExecutionUpdate(_message.Message):
    __slots__ = ("update_type", "execution", "task")
    UPDATE_TYPE_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_FIELD_NUMBER: _ClassVar[int]
    TASK_FIELD_NUMBER: _ClassVar[int]
    update_type: WorkflowUpdateType
    execution: _api_pb2.WorkflowExecution
    task: _api_pb2.WorkflowTask
    def __init__(self, update_type: _Optional[_Union[WorkflowUpdateType, str]] = ..., execution: _Optional[_Union[_api_pb2.WorkflowExecution, _Mapping]] = ..., task: _Optional[_Union[_api_pb2.WorkflowTask, _Mapping]] = ...) -> None: ...
