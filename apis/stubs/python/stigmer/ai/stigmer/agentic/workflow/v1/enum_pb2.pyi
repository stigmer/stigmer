from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class WorkflowTaskKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    workflow_task_kind_unspecified: _ClassVar[WorkflowTaskKind]
    set_vars: _ClassVar[WorkflowTaskKind]
    http_call: _ClassVar[WorkflowTaskKind]
    grpc_call: _ClassVar[WorkflowTaskKind]
    activity_call: _ClassVar[WorkflowTaskKind]
    switch_case: _ClassVar[WorkflowTaskKind]
    for_each: _ClassVar[WorkflowTaskKind]
    fork: _ClassVar[WorkflowTaskKind]
    try_catch: _ClassVar[WorkflowTaskKind]
    listen: _ClassVar[WorkflowTaskKind]
    wait: _ClassVar[WorkflowTaskKind]
    raise_error: _ClassVar[WorkflowTaskKind]
    run_workflow: _ClassVar[WorkflowTaskKind]
    agent_call: _ClassVar[WorkflowTaskKind]
    llm_call: _ClassVar[WorkflowTaskKind]
    transform: _ClassVar[WorkflowTaskKind]
workflow_task_kind_unspecified: WorkflowTaskKind
set_vars: WorkflowTaskKind
http_call: WorkflowTaskKind
grpc_call: WorkflowTaskKind
activity_call: WorkflowTaskKind
switch_case: WorkflowTaskKind
for_each: WorkflowTaskKind
fork: WorkflowTaskKind
try_catch: WorkflowTaskKind
listen: WorkflowTaskKind
wait: WorkflowTaskKind
raise_error: WorkflowTaskKind
run_workflow: WorkflowTaskKind
agent_call: WorkflowTaskKind
llm_call: WorkflowTaskKind
transform: WorkflowTaskKind
