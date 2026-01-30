from ai.stigmer.agentic.agentexecution.v1 import api_pb2 as _api_pb2
from ai.stigmer.agentic.agentexecution.v1 import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentExecutionId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class SessionId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class AgentExecutionList(_message.Message):
    __slots__ = ("total_pages", "entries")
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    total_pages: int
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.AgentExecution]
    def __init__(self, total_pages: _Optional[int] = ..., entries: _Optional[_Iterable[_Union[_api_pb2.AgentExecution, _Mapping]]] = ...) -> None: ...

class ListAgentExecutionsRequest(_message.Message):
    __slots__ = ("page_size", "page_token", "phase", "tags")
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    PHASE_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    page_size: int
    page_token: str
    phase: _enum_pb2.ExecutionPhase
    tags: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., phase: _Optional[_Union[_enum_pb2.ExecutionPhase, str]] = ..., tags: _Optional[_Iterable[str]] = ...) -> None: ...

class ListAgentExecutionsBySessionRequest(_message.Message):
    __slots__ = ("session_id", "page_size", "page_token")
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    page_size: int
    page_token: str
    def __init__(self, session_id: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

class AgentExecutionUpdateStatusInput(_message.Message):
    __slots__ = ("execution_id", "status")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    status: _api_pb2.AgentExecutionStatus
    def __init__(self, execution_id: _Optional[str] = ..., status: _Optional[_Union[_api_pb2.AgentExecutionStatus, _Mapping]] = ...) -> None: ...

class SubmitApprovalInput(_message.Message):
    __slots__ = ("agent_execution_id", "tool_call_id", "action", "comment")
    AGENT_EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    COMMENT_FIELD_NUMBER: _ClassVar[int]
    agent_execution_id: str
    tool_call_id: str
    action: _api_pb2.ApprovalAction
    comment: str
    def __init__(self, agent_execution_id: _Optional[str] = ..., tool_call_id: _Optional[str] = ..., action: _Optional[_Union[_api_pb2.ApprovalAction, str]] = ..., comment: _Optional[str] = ...) -> None: ...
