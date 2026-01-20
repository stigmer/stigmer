from ai.stigmer.agentic.workflowexecution.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.workflowexecution.v1 import spec_pb2 as _spec_pb2
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

class WorkflowExecution(_message.Message):
    __slots__ = ("api_version", "kind", "metadata", "spec", "status")
    API_VERSION_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    SPEC_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    api_version: str
    kind: str
    metadata: _metadata_pb2.ApiResourceMetadata
    spec: _spec_pb2.WorkflowExecutionSpec
    status: WorkflowExecutionStatus
    def __init__(self, api_version: _Optional[str] = ..., kind: _Optional[str] = ..., metadata: _Optional[_Union[_metadata_pb2.ApiResourceMetadata, _Mapping]] = ..., spec: _Optional[_Union[_spec_pb2.WorkflowExecutionSpec, _Mapping]] = ..., status: _Optional[_Union[WorkflowExecutionStatus, _Mapping]] = ...) -> None: ...

class WorkflowExecutionStatus(_message.Message):
    __slots__ = ("audit", "phase", "tasks", "output", "error", "started_at", "completed_at", "temporal_workflow_id")
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    PHASE_FIELD_NUMBER: _ClassVar[int]
    TASKS_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    TEMPORAL_WORKFLOW_ID_FIELD_NUMBER: _ClassVar[int]
    audit: _status_pb2.ApiResourceAudit
    phase: _enum_pb2.ExecutionPhase
    tasks: _containers.RepeatedCompositeFieldContainer[WorkflowTask]
    output: _struct_pb2.Struct
    error: str
    started_at: str
    completed_at: str
    temporal_workflow_id: str
    def __init__(self, audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ..., phase: _Optional[_Union[_enum_pb2.ExecutionPhase, str]] = ..., tasks: _Optional[_Iterable[_Union[WorkflowTask, _Mapping]]] = ..., output: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., error: _Optional[str] = ..., started_at: _Optional[str] = ..., completed_at: _Optional[str] = ..., temporal_workflow_id: _Optional[str] = ...) -> None: ...

class WorkflowTask(_message.Message):
    __slots__ = ("task_id", "task_name", "task_type", "input", "output", "status", "started_at", "completed_at", "error", "metadata")
    TASK_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_NAME_FIELD_NUMBER: _ClassVar[int]
    TASK_TYPE_FIELD_NUMBER: _ClassVar[int]
    INPUT_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    task_id: str
    task_name: str
    task_type: _enum_pb2.WorkflowTaskType
    input: _struct_pb2.Struct
    output: _struct_pb2.Struct
    status: _enum_pb2.WorkflowTaskStatus
    started_at: str
    completed_at: str
    error: str
    metadata: _struct_pb2.Struct
    def __init__(self, task_id: _Optional[str] = ..., task_name: _Optional[str] = ..., task_type: _Optional[_Union[_enum_pb2.WorkflowTaskType, str]] = ..., input: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., output: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., status: _Optional[_Union[_enum_pb2.WorkflowTaskStatus, str]] = ..., started_at: _Optional[str] = ..., completed_at: _Optional[str] = ..., error: _Optional[str] = ..., metadata: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...) -> None: ...
