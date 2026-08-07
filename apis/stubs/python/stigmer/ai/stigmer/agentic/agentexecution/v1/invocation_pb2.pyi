from ai.stigmer.agentic.agentexecution.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.session.v1 import enum_pb2 as _enum_pb2_1
from ai.stigmer.agentic.session.v1 import workspace_pb2 as _workspace_pb2
from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentInvocation(_message.Message):
    __slots__ = ("agent_ref", "message", "harness", "workspace_entries", "environment_refs", "run_config")
    AGENT_REF_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    WORKSPACE_ENTRIES_FIELD_NUMBER: _ClassVar[int]
    ENVIRONMENT_REFS_FIELD_NUMBER: _ClassVar[int]
    RUN_CONFIG_FIELD_NUMBER: _ClassVar[int]
    agent_ref: _io_pb2.ApiResourceReference
    message: str
    harness: _enum_pb2_1.Harness
    workspace_entries: _containers.RepeatedCompositeFieldContainer[_workspace_pb2.WorkspaceEntry]
    environment_refs: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    run_config: RunConfig
    def __init__(self, agent_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., message: _Optional[str] = ..., harness: _Optional[_Union[_enum_pb2_1.Harness, str]] = ..., workspace_entries: _Optional[_Iterable[_Union[_workspace_pb2.WorkspaceEntry, _Mapping]]] = ..., environment_refs: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ..., run_config: _Optional[_Union[RunConfig, _Mapping]] = ...) -> None: ...

class RunConfig(_message.Message):
    __slots__ = ("model_name", "max_cost_usd", "max_tool_rounds", "service_tier")
    MODEL_NAME_FIELD_NUMBER: _ClassVar[int]
    MAX_COST_USD_FIELD_NUMBER: _ClassVar[int]
    MAX_TOOL_ROUNDS_FIELD_NUMBER: _ClassVar[int]
    SERVICE_TIER_FIELD_NUMBER: _ClassVar[int]
    model_name: str
    max_cost_usd: float
    max_tool_rounds: int
    service_tier: _enum_pb2.ServiceTier
    def __init__(self, model_name: _Optional[str] = ..., max_cost_usd: _Optional[float] = ..., max_tool_rounds: _Optional[int] = ..., service_tier: _Optional[_Union[_enum_pb2.ServiceTier, str]] = ...) -> None: ...
