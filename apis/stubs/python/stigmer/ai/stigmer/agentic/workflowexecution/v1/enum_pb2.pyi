from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class ExecutionPhase(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    EXECUTION_PHASE_UNSPECIFIED: _ClassVar[ExecutionPhase]
    EXECUTION_PENDING: _ClassVar[ExecutionPhase]
    EXECUTION_IN_PROGRESS: _ClassVar[ExecutionPhase]
    EXECUTION_COMPLETED: _ClassVar[ExecutionPhase]
    EXECUTION_FAILED: _ClassVar[ExecutionPhase]
    EXECUTION_CANCELLED: _ClassVar[ExecutionPhase]

class WorkflowTaskType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    WORKFLOW_TASK_TYPE_UNSPECIFIED: _ClassVar[WorkflowTaskType]
    WORKFLOW_TASK_AGENT_INVOCATION: _ClassVar[WorkflowTaskType]
    WORKFLOW_TASK_APPROVAL: _ClassVar[WorkflowTaskType]
    WORKFLOW_TASK_API_CALL: _ClassVar[WorkflowTaskType]
    WORKFLOW_TASK_CONDITIONAL: _ClassVar[WorkflowTaskType]
    WORKFLOW_TASK_PARALLEL: _ClassVar[WorkflowTaskType]
    WORKFLOW_TASK_TRANSFORM: _ClassVar[WorkflowTaskType]
    WORKFLOW_TASK_CUSTOM: _ClassVar[WorkflowTaskType]

class WorkflowTaskStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    WORKFLOW_TASK_STATUS_UNSPECIFIED: _ClassVar[WorkflowTaskStatus]
    WORKFLOW_TASK_PENDING: _ClassVar[WorkflowTaskStatus]
    WORKFLOW_TASK_IN_PROGRESS: _ClassVar[WorkflowTaskStatus]
    WORKFLOW_TASK_COMPLETED: _ClassVar[WorkflowTaskStatus]
    WORKFLOW_TASK_FAILED: _ClassVar[WorkflowTaskStatus]
    WORKFLOW_TASK_SKIPPED: _ClassVar[WorkflowTaskStatus]
EXECUTION_PHASE_UNSPECIFIED: ExecutionPhase
EXECUTION_PENDING: ExecutionPhase
EXECUTION_IN_PROGRESS: ExecutionPhase
EXECUTION_COMPLETED: ExecutionPhase
EXECUTION_FAILED: ExecutionPhase
EXECUTION_CANCELLED: ExecutionPhase
WORKFLOW_TASK_TYPE_UNSPECIFIED: WorkflowTaskType
WORKFLOW_TASK_AGENT_INVOCATION: WorkflowTaskType
WORKFLOW_TASK_APPROVAL: WorkflowTaskType
WORKFLOW_TASK_API_CALL: WorkflowTaskType
WORKFLOW_TASK_CONDITIONAL: WorkflowTaskType
WORKFLOW_TASK_PARALLEL: WorkflowTaskType
WORKFLOW_TASK_TRANSFORM: WorkflowTaskType
WORKFLOW_TASK_CUSTOM: WorkflowTaskType
WORKFLOW_TASK_STATUS_UNSPECIFIED: WorkflowTaskStatus
WORKFLOW_TASK_PENDING: WorkflowTaskStatus
WORKFLOW_TASK_IN_PROGRESS: WorkflowTaskStatus
WORKFLOW_TASK_COMPLETED: WorkflowTaskStatus
WORKFLOW_TASK_FAILED: WorkflowTaskStatus
WORKFLOW_TASK_SKIPPED: WorkflowTaskStatus
