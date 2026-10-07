from ai.stigmer.agentic.credential.v1 import requirement_pb2 as _requirement_pb2
from ai.stigmer.agentic.run.v1 import invocation_pb2 as _invocation_pb2
from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentChannelSpec(_message.Message):
    __slots__ = ("agent_ref", "enabled", "slack", "whatsapp", "credentials", "app_ref", "proactive_messaging_enabled", "run_config")
    AGENT_REF_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    SLACK_FIELD_NUMBER: _ClassVar[int]
    WHATSAPP_FIELD_NUMBER: _ClassVar[int]
    CREDENTIALS_FIELD_NUMBER: _ClassVar[int]
    APP_REF_FIELD_NUMBER: _ClassVar[int]
    PROACTIVE_MESSAGING_ENABLED_FIELD_NUMBER: _ClassVar[int]
    RUN_CONFIG_FIELD_NUMBER: _ClassVar[int]
    agent_ref: _io_pb2.ApiResourceReference
    enabled: bool
    slack: SlackChannelConfig
    whatsapp: WhatsAppChannelConfig
    credentials: _containers.RepeatedCompositeFieldContainer[_requirement_pb2.CredentialAssignment]
    app_ref: _io_pb2.ApiResourceReference
    proactive_messaging_enabled: bool
    run_config: _invocation_pb2.RunConfig
    def __init__(self, agent_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., enabled: bool = ..., slack: _Optional[_Union[SlackChannelConfig, _Mapping]] = ..., whatsapp: _Optional[_Union[WhatsAppChannelConfig, _Mapping]] = ..., credentials: _Optional[_Iterable[_Union[_requirement_pb2.CredentialAssignment, _Mapping]]] = ..., app_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., proactive_messaging_enabled: bool = ..., run_config: _Optional[_Union[_invocation_pb2.RunConfig, _Mapping]] = ...) -> None: ...

class SlackChannelConfig(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class WhatsAppChannelConfig(_message.Message):
    __slots__ = ("phone_number_id",)
    PHONE_NUMBER_ID_FIELD_NUMBER: _ClassVar[int]
    phone_number_id: str
    def __init__(self, phone_number_id: _Optional[str] = ...) -> None: ...
