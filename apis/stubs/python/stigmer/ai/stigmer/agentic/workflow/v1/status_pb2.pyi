from ai.stigmer.agentic.workflow.v1.serverless import validation_pb2 as _validation_pb2
from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class WorkflowStatus(_message.Message):
    __slots__ = ("audit", "default_instance_id", "serverless_workflow_validation")
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_INSTANCE_ID_FIELD_NUMBER: _ClassVar[int]
    SERVERLESS_WORKFLOW_VALIDATION_FIELD_NUMBER: _ClassVar[int]
    audit: _status_pb2.ApiResourceAudit
    default_instance_id: str
    serverless_workflow_validation: _validation_pb2.ServerlessWorkflowValidation
    def __init__(self, audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ..., default_instance_id: _Optional[str] = ..., serverless_workflow_validation: _Optional[_Union[_validation_pb2.ServerlessWorkflowValidation, _Mapping]] = ...) -> None: ...
