from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class SessionSpec(_message.Message):
    __slots__ = ("agent_instance_id", "subject", "thread_id", "sandbox_id", "metadata")
    class MetadataEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    AGENT_INSTANCE_ID_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_FIELD_NUMBER: _ClassVar[int]
    THREAD_ID_FIELD_NUMBER: _ClassVar[int]
    SANDBOX_ID_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    agent_instance_id: str
    subject: str
    thread_id: str
    sandbox_id: str
    metadata: _containers.ScalarMap[str, str]
    def __init__(self, agent_instance_id: _Optional[str] = ..., subject: _Optional[str] = ..., thread_id: _Optional[str] = ..., sandbox_id: _Optional[str] = ..., metadata: _Optional[_Mapping[str, str]] = ...) -> None: ...
