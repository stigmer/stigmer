from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class ApiResourceEventType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    unspecified: _ClassVar[ApiResourceEventType]
    created: _ClassVar[ApiResourceEventType]
    updated: _ClassVar[ApiResourceEventType]
    deleted: _ClassVar[ApiResourceEventType]
    renamed: _ClassVar[ApiResourceEventType]
    stack_outputs_updated: _ClassVar[ApiResourceEventType]

class ApiResourceStateOperationType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    api_resource_state_operation_type_unspecified: _ClassVar[ApiResourceStateOperationType]
    create: _ClassVar[ApiResourceStateOperationType]
    update: _ClassVar[ApiResourceStateOperationType]
    delete: _ClassVar[ApiResourceStateOperationType]
    read: _ClassVar[ApiResourceStateOperationType]
    stream: _ClassVar[ApiResourceStateOperationType]

class ApiResourceVisibility(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    API_RESOURCE_VISIBILITY_UNSPECIFIED: _ClassVar[ApiResourceVisibility]
    API_RESOURCE_VISIBILITY_PRIVATE: _ClassVar[ApiResourceVisibility]
    API_RESOURCE_VISIBILITY_PUBLIC: _ClassVar[ApiResourceVisibility]

class WorkflowTaskKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    WORKFLOW_TASK_KIND_UNSPECIFIED: _ClassVar[WorkflowTaskKind]
    WORKFLOW_TASK_KIND_SET: _ClassVar[WorkflowTaskKind]
    WORKFLOW_TASK_KIND_HTTP_CALL: _ClassVar[WorkflowTaskKind]
    WORKFLOW_TASK_KIND_GRPC_CALL: _ClassVar[WorkflowTaskKind]
    WORKFLOW_TASK_KIND_CALL_ACTIVITY: _ClassVar[WorkflowTaskKind]
    WORKFLOW_TASK_KIND_SWITCH: _ClassVar[WorkflowTaskKind]
    WORKFLOW_TASK_KIND_FOR: _ClassVar[WorkflowTaskKind]
    WORKFLOW_TASK_KIND_FORK: _ClassVar[WorkflowTaskKind]
    WORKFLOW_TASK_KIND_TRY: _ClassVar[WorkflowTaskKind]
    WORKFLOW_TASK_KIND_LISTEN: _ClassVar[WorkflowTaskKind]
    WORKFLOW_TASK_KIND_WAIT: _ClassVar[WorkflowTaskKind]
    WORKFLOW_TASK_KIND_RAISE: _ClassVar[WorkflowTaskKind]
    WORKFLOW_TASK_KIND_RUN: _ClassVar[WorkflowTaskKind]
    WORKFLOW_TASK_KIND_AGENT_CALL: _ClassVar[WorkflowTaskKind]
unspecified: ApiResourceEventType
created: ApiResourceEventType
updated: ApiResourceEventType
deleted: ApiResourceEventType
renamed: ApiResourceEventType
stack_outputs_updated: ApiResourceEventType
api_resource_state_operation_type_unspecified: ApiResourceStateOperationType
create: ApiResourceStateOperationType
update: ApiResourceStateOperationType
delete: ApiResourceStateOperationType
read: ApiResourceStateOperationType
stream: ApiResourceStateOperationType
API_RESOURCE_VISIBILITY_UNSPECIFIED: ApiResourceVisibility
API_RESOURCE_VISIBILITY_PRIVATE: ApiResourceVisibility
API_RESOURCE_VISIBILITY_PUBLIC: ApiResourceVisibility
WORKFLOW_TASK_KIND_UNSPECIFIED: WorkflowTaskKind
WORKFLOW_TASK_KIND_SET: WorkflowTaskKind
WORKFLOW_TASK_KIND_HTTP_CALL: WorkflowTaskKind
WORKFLOW_TASK_KIND_GRPC_CALL: WorkflowTaskKind
WORKFLOW_TASK_KIND_CALL_ACTIVITY: WorkflowTaskKind
WORKFLOW_TASK_KIND_SWITCH: WorkflowTaskKind
WORKFLOW_TASK_KIND_FOR: WorkflowTaskKind
WORKFLOW_TASK_KIND_FORK: WorkflowTaskKind
WORKFLOW_TASK_KIND_TRY: WorkflowTaskKind
WORKFLOW_TASK_KIND_LISTEN: WorkflowTaskKind
WORKFLOW_TASK_KIND_WAIT: WorkflowTaskKind
WORKFLOW_TASK_KIND_RAISE: WorkflowTaskKind
WORKFLOW_TASK_KIND_RUN: WorkflowTaskKind
WORKFLOW_TASK_KIND_AGENT_CALL: WorkflowTaskKind
