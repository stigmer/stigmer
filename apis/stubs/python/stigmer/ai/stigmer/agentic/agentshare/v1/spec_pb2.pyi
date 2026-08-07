from ai.stigmer.agentic.agentexecution.v1 import invocation_pb2 as _invocation_pb2
from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentShareAudience(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    agent_share_audience_unspecified: _ClassVar[AgentShareAudience]
    agent_share_audience_public: _ClassVar[AgentShareAudience]
    agent_share_audience_org: _ClassVar[AgentShareAudience]
agent_share_audience_unspecified: AgentShareAudience
agent_share_audience_public: AgentShareAudience
agent_share_audience_org: AgentShareAudience

class AgentShareSpec(_message.Message):
    __slots__ = ("agent_ref", "enabled", "audience", "allowed_origins", "messages", "environment_refs", "run_config")
    AGENT_REF_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    AUDIENCE_FIELD_NUMBER: _ClassVar[int]
    ALLOWED_ORIGINS_FIELD_NUMBER: _ClassVar[int]
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    ENVIRONMENT_REFS_FIELD_NUMBER: _ClassVar[int]
    RUN_CONFIG_FIELD_NUMBER: _ClassVar[int]
    agent_ref: _io_pb2.ApiResourceReference
    enabled: bool
    audience: AgentShareAudience
    allowed_origins: _containers.RepeatedScalarFieldContainer[str]
    messages: AgentShareMessages
    environment_refs: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    run_config: _invocation_pb2.RunConfig
    def __init__(self, agent_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., enabled: bool = ..., audience: _Optional[_Union[AgentShareAudience, str]] = ..., allowed_origins: _Optional[_Iterable[str]] = ..., messages: _Optional[_Union[AgentShareMessages, _Mapping]] = ..., environment_refs: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ..., run_config: _Optional[_Union[_invocation_pb2.RunConfig, _Mapping]] = ...) -> None: ...

class AgentShareMessages(_message.Message):
    __slots__ = ("rate_limited", "unavailable", "conversation_ended")
    RATE_LIMITED_FIELD_NUMBER: _ClassVar[int]
    UNAVAILABLE_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_ENDED_FIELD_NUMBER: _ClassVar[int]
    rate_limited: str
    unavailable: str
    conversation_ended: str
    def __init__(self, rate_limited: _Optional[str] = ..., unavailable: _Optional[str] = ..., conversation_ended: _Optional[str] = ...) -> None: ...
