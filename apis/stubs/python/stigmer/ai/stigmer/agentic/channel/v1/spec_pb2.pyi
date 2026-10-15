from ai.stigmer.agentic.run.v1 import invocation_pb2 as _invocation_pb2
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

class ChannelAudience(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    channel_audience_unspecified: _ClassVar[ChannelAudience]
    channel_audience_public: _ClassVar[ChannelAudience]
    channel_audience_org: _ClassVar[ChannelAudience]
channel_audience_unspecified: ChannelAudience
channel_audience_public: ChannelAudience
channel_audience_org: ChannelAudience

class ChannelSpec(_message.Message):
    __slots__ = ("agent_ref", "enabled", "vaults", "run_config", "web", "slack", "whatsapp")
    AGENT_REF_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    VAULTS_FIELD_NUMBER: _ClassVar[int]
    RUN_CONFIG_FIELD_NUMBER: _ClassVar[int]
    WEB_FIELD_NUMBER: _ClassVar[int]
    SLACK_FIELD_NUMBER: _ClassVar[int]
    WHATSAPP_FIELD_NUMBER: _ClassVar[int]
    agent_ref: _io_pb2.ApiResourceReference
    enabled: bool
    vaults: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    run_config: _invocation_pb2.RunConfig
    web: WebChannelConfig
    slack: SlackChannelConfig
    whatsapp: WhatsAppChannelConfig
    def __init__(self, agent_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., enabled: bool = ..., vaults: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ..., run_config: _Optional[_Union[_invocation_pb2.RunConfig, _Mapping]] = ..., web: _Optional[_Union[WebChannelConfig, _Mapping]] = ..., slack: _Optional[_Union[SlackChannelConfig, _Mapping]] = ..., whatsapp: _Optional[_Union[WhatsAppChannelConfig, _Mapping]] = ...) -> None: ...

class WebChannelConfig(_message.Message):
    __slots__ = ("audience", "allowed_origins", "messages")
    AUDIENCE_FIELD_NUMBER: _ClassVar[int]
    ALLOWED_ORIGINS_FIELD_NUMBER: _ClassVar[int]
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    audience: ChannelAudience
    allowed_origins: _containers.RepeatedScalarFieldContainer[str]
    messages: WebChannelMessages
    def __init__(self, audience: _Optional[_Union[ChannelAudience, str]] = ..., allowed_origins: _Optional[_Iterable[str]] = ..., messages: _Optional[_Union[WebChannelMessages, _Mapping]] = ...) -> None: ...

class WebChannelMessages(_message.Message):
    __slots__ = ("rate_limited", "unavailable", "conversation_ended")
    RATE_LIMITED_FIELD_NUMBER: _ClassVar[int]
    UNAVAILABLE_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_ENDED_FIELD_NUMBER: _ClassVar[int]
    rate_limited: str
    unavailable: str
    conversation_ended: str
    def __init__(self, rate_limited: _Optional[str] = ..., unavailable: _Optional[str] = ..., conversation_ended: _Optional[str] = ...) -> None: ...

class SlackChannelConfig(_message.Message):
    __slots__ = ("app_ref",)
    APP_REF_FIELD_NUMBER: _ClassVar[int]
    app_ref: _io_pb2.ApiResourceReference
    def __init__(self, app_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ...) -> None: ...

class WhatsAppChannelConfig(_message.Message):
    __slots__ = ("phone_number_id", "app_ref", "proactive_messaging_enabled")
    PHONE_NUMBER_ID_FIELD_NUMBER: _ClassVar[int]
    APP_REF_FIELD_NUMBER: _ClassVar[int]
    PROACTIVE_MESSAGING_ENABLED_FIELD_NUMBER: _ClassVar[int]
    phone_number_id: str
    app_ref: _io_pb2.ApiResourceReference
    proactive_messaging_enabled: bool
    def __init__(self, phone_number_id: _Optional[str] = ..., app_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., proactive_messaging_enabled: bool = ...) -> None: ...
