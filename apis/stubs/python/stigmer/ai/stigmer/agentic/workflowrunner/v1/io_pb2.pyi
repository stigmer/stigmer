from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class WorkflowExecuteInput(_message.Message):
    __slots__ = ("workflow_execution_id", "workflow_yaml")
    WORKFLOW_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    WORKFLOW_YAML_FIELD_NUMBER: _ClassVar[int]
    workflow_execution_id: str
    workflow_yaml: str
    def __init__(self, workflow_execution_id: _Optional[str] = ..., workflow_yaml: _Optional[str] = ...) -> None: ...

class WorkflowExecuteResponse(_message.Message):
    __slots__ = ("workflow_execution_id", "status", "message", "temporal_workflow_id", "subscribe_url", "status_url")
    WORKFLOW_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    TEMPORAL_WORKFLOW_ID_FIELD_NUMBER: _ClassVar[int]
    SUBSCRIBE_URL_FIELD_NUMBER: _ClassVar[int]
    STATUS_URL_FIELD_NUMBER: _ClassVar[int]
    workflow_execution_id: str
    status: str
    message: str
    temporal_workflow_id: str
    subscribe_url: str
    status_url: str
    def __init__(self, workflow_execution_id: _Optional[str] = ..., status: _Optional[str] = ..., message: _Optional[str] = ..., temporal_workflow_id: _Optional[str] = ..., subscribe_url: _Optional[str] = ..., status_url: _Optional[str] = ...) -> None: ...

class CancelExecutionRequest(_message.Message):
    __slots__ = ("execution_id", "reason", "force")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    FORCE_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    reason: str
    force: bool
    def __init__(self, execution_id: _Optional[str] = ..., reason: _Optional[str] = ..., force: bool = ...) -> None: ...

class PauseExecutionRequest(_message.Message):
    __slots__ = ("execution_id", "reason")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    reason: str
    def __init__(self, execution_id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class ResumeExecutionRequest(_message.Message):
    __slots__ = ("execution_id", "reason")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    reason: str
    def __init__(self, execution_id: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...
