from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ArtifactSpec(_message.Message):
    __slots__ = ("content_type", "display_name", "source", "retention")
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    RETENTION_FIELD_NUMBER: _ClassVar[int]
    content_type: str
    display_name: str
    source: ArtifactSource
    retention: RetentionPolicy
    def __init__(self, content_type: _Optional[str] = ..., display_name: _Optional[str] = ..., source: _Optional[_Union[ArtifactSource, _Mapping]] = ..., retention: _Optional[_Union[RetentionPolicy, _Mapping]] = ...) -> None: ...

class ArtifactSource(_message.Message):
    __slots__ = ("workflow_execution_id", "agent_execution_id", "task_name")
    WORKFLOW_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    TASK_NAME_FIELD_NUMBER: _ClassVar[int]
    workflow_execution_id: str
    agent_execution_id: str
    task_name: str
    def __init__(self, workflow_execution_id: _Optional[str] = ..., agent_execution_id: _Optional[str] = ..., task_name: _Optional[str] = ...) -> None: ...

class RetentionPolicy(_message.Message):
    __slots__ = ("ttl_days",)
    TTL_DAYS_FIELD_NUMBER: _ClassVar[int]
    ttl_days: int
    def __init__(self, ttl_days: _Optional[int] = ...) -> None: ...
