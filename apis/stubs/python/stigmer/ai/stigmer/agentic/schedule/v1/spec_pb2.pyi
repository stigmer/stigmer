from ai.stigmer.agentic.agentexecution.v1 import invocation_pb2 as _invocation_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ScheduleSpec(_message.Message):
    __slots__ = ("cron", "time_zone", "enabled", "agent")
    CRON_FIELD_NUMBER: _ClassVar[int]
    TIME_ZONE_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    AGENT_FIELD_NUMBER: _ClassVar[int]
    cron: str
    time_zone: str
    enabled: bool
    agent: _invocation_pb2.AgentInvocation
    def __init__(self, cron: _Optional[str] = ..., time_zone: _Optional[str] = ..., enabled: bool = ..., agent: _Optional[_Union[_invocation_pb2.AgentInvocation, _Mapping]] = ...) -> None: ...
