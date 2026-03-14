from ai.stigmer.agentic.agentexecution.v1 import approval_pb2 as _approval_pb2
from ai.stigmer.agentic.agentexecution.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.agentexecution.v1 import message_pb2 as _message_pb2
from ai.stigmer.agentic.agentexecution.v1 import usage_pb2 as _usage_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SubAgentExecution(_message.Message):
    __slots__ = ("id", "name", "input", "output", "status", "started_at", "completed_at", "error", "metadata", "tool_calls", "messages", "usage", "subject", "pending_approvals")
    ID_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    INPUT_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_AT_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALLS_FIELD_NUMBER: _ClassVar[int]
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    USAGE_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_FIELD_NUMBER: _ClassVar[int]
    PENDING_APPROVALS_FIELD_NUMBER: _ClassVar[int]
    id: str
    name: str
    input: str
    output: str
    status: _enum_pb2.SubAgentStatus
    started_at: str
    completed_at: str
    error: str
    metadata: _struct_pb2.Struct
    tool_calls: _containers.RepeatedCompositeFieldContainer[_message_pb2.ToolCall]
    messages: _containers.RepeatedCompositeFieldContainer[_message_pb2.AgentMessage]
    usage: _usage_pb2.UsageMetrics
    subject: str
    pending_approvals: _containers.RepeatedCompositeFieldContainer[_approval_pb2.PendingApproval]
    def __init__(self, id: _Optional[str] = ..., name: _Optional[str] = ..., input: _Optional[str] = ..., output: _Optional[str] = ..., status: _Optional[_Union[_enum_pb2.SubAgentStatus, str]] = ..., started_at: _Optional[str] = ..., completed_at: _Optional[str] = ..., error: _Optional[str] = ..., metadata: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., tool_calls: _Optional[_Iterable[_Union[_message_pb2.ToolCall, _Mapping]]] = ..., messages: _Optional[_Iterable[_Union[_message_pb2.AgentMessage, _Mapping]]] = ..., usage: _Optional[_Union[_usage_pb2.UsageMetrics, _Mapping]] = ..., subject: _Optional[str] = ..., pending_approvals: _Optional[_Iterable[_Union[_approval_pb2.PendingApproval, _Mapping]]] = ...) -> None: ...
