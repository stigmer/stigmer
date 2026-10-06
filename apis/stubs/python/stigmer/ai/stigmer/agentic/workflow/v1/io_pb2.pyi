from ai.stigmer.agentic.workflow.v1 import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class WorkflowId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class UpdateWorkflowRunVisibilityInput(_message.Message):
    __slots__ = ("resource_id", "run_visibility")
    RESOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    RUN_VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    resource_id: str
    run_visibility: _enum_pb2.WorkflowRunVisibility
    def __init__(self, resource_id: _Optional[str] = ..., run_visibility: _Optional[_Union[_enum_pb2.WorkflowRunVisibility, str]] = ...) -> None: ...
