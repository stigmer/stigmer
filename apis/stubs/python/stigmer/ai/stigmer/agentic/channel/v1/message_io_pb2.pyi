from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ChannelSendOutcome(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    channel_send_outcome_unspecified: _ClassVar[ChannelSendOutcome]
    accepted: _ClassVar[ChannelSendOutcome]
    queued: _ClassVar[ChannelSendOutcome]
    refused: _ClassVar[ChannelSendOutcome]
channel_send_outcome_unspecified: ChannelSendOutcome
accepted: ChannelSendOutcome
queued: ChannelSendOutcome
refused: ChannelSendOutcome

class SendChannelMessageInput(_message.Message):
    __slots__ = ("channel", "org", "recipient", "payload")
    CHANNEL_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    RECIPIENT_FIELD_NUMBER: _ClassVar[int]
    PAYLOAD_FIELD_NUMBER: _ClassVar[int]
    channel: str
    org: str
    recipient: str
    payload: ChannelOutboundPayload
    def __init__(self, channel: _Optional[str] = ..., org: _Optional[str] = ..., recipient: _Optional[str] = ..., payload: _Optional[_Union[ChannelOutboundPayload, _Mapping]] = ...) -> None: ...

class ChannelOutboundPayload(_message.Message):
    __slots__ = ("text", "template")
    TEXT_FIELD_NUMBER: _ClassVar[int]
    TEMPLATE_FIELD_NUMBER: _ClassVar[int]
    text: TextPayload
    template: TemplatePayload
    def __init__(self, text: _Optional[_Union[TextPayload, _Mapping]] = ..., template: _Optional[_Union[TemplatePayload, _Mapping]] = ...) -> None: ...

class TextPayload(_message.Message):
    __slots__ = ("body",)
    BODY_FIELD_NUMBER: _ClassVar[int]
    body: str
    def __init__(self, body: _Optional[str] = ...) -> None: ...

class TemplatePayload(_message.Message):
    __slots__ = ("name", "language", "parameters", "header_image_link")
    class ParametersEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    NAME_FIELD_NUMBER: _ClassVar[int]
    LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    PARAMETERS_FIELD_NUMBER: _ClassVar[int]
    HEADER_IMAGE_LINK_FIELD_NUMBER: _ClassVar[int]
    name: str
    language: str
    parameters: _containers.ScalarMap[str, str]
    header_image_link: str
    def __init__(self, name: _Optional[str] = ..., language: _Optional[str] = ..., parameters: _Optional[_Mapping[str, str]] = ..., header_image_link: _Optional[str] = ...) -> None: ...

class SendChannelMessageOutput(_message.Message):
    __slots__ = ("outcome", "outbound_message_id", "provider_message_id", "detail")
    OUTCOME_FIELD_NUMBER: _ClassVar[int]
    OUTBOUND_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    DETAIL_FIELD_NUMBER: _ClassVar[int]
    outcome: ChannelSendOutcome
    outbound_message_id: str
    provider_message_id: str
    detail: str
    def __init__(self, outcome: _Optional[_Union[ChannelSendOutcome, str]] = ..., outbound_message_id: _Optional[str] = ..., provider_message_id: _Optional[str] = ..., detail: _Optional[str] = ...) -> None: ...

class ListChannelTemplatesInput(_message.Message):
    __slots__ = ("channel", "org", "approved_only")
    CHANNEL_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    APPROVED_ONLY_FIELD_NUMBER: _ClassVar[int]
    channel: str
    org: str
    approved_only: bool
    def __init__(self, channel: _Optional[str] = ..., org: _Optional[str] = ..., approved_only: bool = ...) -> None: ...

class ChannelTemplates(_message.Message):
    __slots__ = ("entries",)
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[ChannelTemplate]
    def __init__(self, entries: _Optional[_Iterable[_Union[ChannelTemplate, _Mapping]]] = ...) -> None: ...

class ChannelTemplate(_message.Message):
    __slots__ = ("name", "language", "category", "status", "parameter_format", "parameter_names", "body_text", "header_format", "rejection_reason", "unsupported_reason")
    NAME_FIELD_NUMBER: _ClassVar[int]
    LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    PARAMETER_FORMAT_FIELD_NUMBER: _ClassVar[int]
    PARAMETER_NAMES_FIELD_NUMBER: _ClassVar[int]
    BODY_TEXT_FIELD_NUMBER: _ClassVar[int]
    HEADER_FORMAT_FIELD_NUMBER: _ClassVar[int]
    REJECTION_REASON_FIELD_NUMBER: _ClassVar[int]
    UNSUPPORTED_REASON_FIELD_NUMBER: _ClassVar[int]
    name: str
    language: str
    category: str
    status: str
    parameter_format: str
    parameter_names: _containers.RepeatedScalarFieldContainer[str]
    body_text: str
    header_format: str
    rejection_reason: str
    unsupported_reason: str
    def __init__(self, name: _Optional[str] = ..., language: _Optional[str] = ..., category: _Optional[str] = ..., status: _Optional[str] = ..., parameter_format: _Optional[str] = ..., parameter_names: _Optional[_Iterable[str]] = ..., body_text: _Optional[str] = ..., header_format: _Optional[str] = ..., rejection_reason: _Optional[str] = ..., unsupported_reason: _Optional[str] = ...) -> None: ...

class ListMessagingChannelsInput(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class MessagingChannels(_message.Message):
    __slots__ = ("entries",)
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[MessagingChannel]
    def __init__(self, entries: _Optional[_Iterable[_Union[MessagingChannel, _Mapping]]] = ...) -> None: ...

class MessagingChannel(_message.Message):
    __slots__ = ("channel", "provider")
    CHANNEL_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    channel: str
    provider: str
    def __init__(self, channel: _Optional[str] = ..., provider: _Optional[str] = ...) -> None: ...
