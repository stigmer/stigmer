from ai.stigmer.agentic.executioncontext.v1 import spec_pb2 as _spec_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class WorkflowExecutionSpec(_message.Message):
    __slots__ = ("workflow_instance_id", "workflow_id", "trigger_message", "trigger_metadata", "runtime_env", "callback_token")
    class TriggerMetadataEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    class RuntimeEnvEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: _spec_pb2.ExecutionValue
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[_spec_pb2.ExecutionValue, _Mapping]] = ...) -> None: ...
    WORKFLOW_INSTANCE_ID_FIELD_NUMBER: _ClassVar[int]
    WORKFLOW_ID_FIELD_NUMBER: _ClassVar[int]
    TRIGGER_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    TRIGGER_METADATA_FIELD_NUMBER: _ClassVar[int]
    RUNTIME_ENV_FIELD_NUMBER: _ClassVar[int]
    CALLBACK_TOKEN_FIELD_NUMBER: _ClassVar[int]
    workflow_instance_id: str
    workflow_id: str
    trigger_message: str
    trigger_metadata: _containers.ScalarMap[str, str]
    runtime_env: _containers.MessageMap[str, _spec_pb2.ExecutionValue]
    callback_token: bytes
    def __init__(self, workflow_instance_id: _Optional[str] = ..., workflow_id: _Optional[str] = ..., trigger_message: _Optional[str] = ..., trigger_metadata: _Optional[_Mapping[str, str]] = ..., runtime_env: _Optional[_Mapping[str, _spec_pb2.ExecutionValue]] = ..., callback_token: _Optional[bytes] = ...) -> None: ...
