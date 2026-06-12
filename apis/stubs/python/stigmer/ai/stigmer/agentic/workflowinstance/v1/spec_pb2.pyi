from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class WorkflowExecutionVisibility(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    workflow_execution_visibility_unspecified: _ClassVar[WorkflowExecutionVisibility]
    workflow_execution_visibility_private: _ClassVar[WorkflowExecutionVisibility]
    workflow_execution_visibility_organization: _ClassVar[WorkflowExecutionVisibility]
workflow_execution_visibility_unspecified: WorkflowExecutionVisibility
workflow_execution_visibility_private: WorkflowExecutionVisibility
workflow_execution_visibility_organization: WorkflowExecutionVisibility

class WorkflowInstanceSpec(_message.Message):
    __slots__ = ("workflow_id", "description", "environment_refs", "execution_visibility")
    WORKFLOW_ID_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ENVIRONMENT_REFS_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    workflow_id: str
    description: str
    environment_refs: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    execution_visibility: WorkflowExecutionVisibility
    def __init__(self, workflow_id: _Optional[str] = ..., description: _Optional[str] = ..., environment_refs: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ..., execution_visibility: _Optional[_Union[WorkflowExecutionVisibility, str]] = ...) -> None: ...
