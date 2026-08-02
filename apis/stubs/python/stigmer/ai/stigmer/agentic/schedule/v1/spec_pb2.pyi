from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
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
    agent: AgentTarget
    def __init__(self, cron: _Optional[str] = ..., time_zone: _Optional[str] = ..., enabled: bool = ..., agent: _Optional[_Union[AgentTarget, _Mapping]] = ...) -> None: ...

class AgentTarget(_message.Message):
    __slots__ = ("agent_ref", "message")
    AGENT_REF_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    agent_ref: _io_pb2.ApiResourceReference
    message: str
    def __init__(self, agent_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., message: _Optional[str] = ...) -> None: ...
