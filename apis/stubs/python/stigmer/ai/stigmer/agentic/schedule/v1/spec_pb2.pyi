from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
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
    __slots__ = ("agent_ref", "message", "environment_refs", "run_config")
    AGENT_REF_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    ENVIRONMENT_REFS_FIELD_NUMBER: _ClassVar[int]
    RUN_CONFIG_FIELD_NUMBER: _ClassVar[int]
    agent_ref: _io_pb2.ApiResourceReference
    message: str
    environment_refs: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    run_config: ScheduleRunConfig
    def __init__(self, agent_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., message: _Optional[str] = ..., environment_refs: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ..., run_config: _Optional[_Union[ScheduleRunConfig, _Mapping]] = ...) -> None: ...

class ScheduleRunConfig(_message.Message):
    __slots__ = ("model_name", "max_cost_usd", "max_tool_rounds")
    MODEL_NAME_FIELD_NUMBER: _ClassVar[int]
    MAX_COST_USD_FIELD_NUMBER: _ClassVar[int]
    MAX_TOOL_ROUNDS_FIELD_NUMBER: _ClassVar[int]
    model_name: str
    max_cost_usd: float
    max_tool_rounds: int
    def __init__(self, model_name: _Optional[str] = ..., max_cost_usd: _Optional[float] = ..., max_tool_rounds: _Optional[int] = ...) -> None: ...
