from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class MemorySpec(_message.Message):
    __slots__ = ("content", "subject_identity_account_id", "provenance")
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_IDENTITY_ACCOUNT_ID_FIELD_NUMBER: _ClassVar[int]
    PROVENANCE_FIELD_NUMBER: _ClassVar[int]
    content: str
    subject_identity_account_id: str
    provenance: MemoryProvenance
    def __init__(self, content: _Optional[str] = ..., subject_identity_account_id: _Optional[str] = ..., provenance: _Optional[_Union[MemoryProvenance, _Mapping]] = ...) -> None: ...

class MemoryProvenance(_message.Message):
    __slots__ = ("agent_id", "session_id", "agent_execution_id", "tool_call_id")
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    agent_id: str
    session_id: str
    agent_execution_id: str
    tool_call_id: str
    def __init__(self, agent_id: _Optional[str] = ..., session_id: _Optional[str] = ..., agent_execution_id: _Optional[str] = ..., tool_call_id: _Optional[str] = ...) -> None: ...
