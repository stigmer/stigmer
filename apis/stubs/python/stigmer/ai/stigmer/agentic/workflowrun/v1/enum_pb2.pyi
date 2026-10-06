from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class RunPhase(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    RUN_PHASE_UNSPECIFIED: _ClassVar[RunPhase]
    RUN_PENDING: _ClassVar[RunPhase]
    RUN_IN_PROGRESS: _ClassVar[RunPhase]
    RUN_COMPLETED: _ClassVar[RunPhase]
    RUN_FAILED: _ClassVar[RunPhase]
    RUN_CANCELLED: _ClassVar[RunPhase]
    RUN_TERMINATED: _ClassVar[RunPhase]
    RUN_PAUSED: _ClassVar[RunPhase]

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
    WORKFLOW_TASK_WAITING_APPROVAL: _ClassVar[WorkflowTaskStatus]
RUN_PHASE_UNSPECIFIED: RunPhase
RUN_PENDING: RunPhase
RUN_IN_PROGRESS: RunPhase
RUN_COMPLETED: RunPhase
RUN_FAILED: RunPhase
RUN_CANCELLED: RunPhase
RUN_TERMINATED: RunPhase
RUN_PAUSED: RunPhase
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
WORKFLOW_TASK_WAITING_APPROVAL: WorkflowTaskStatus
