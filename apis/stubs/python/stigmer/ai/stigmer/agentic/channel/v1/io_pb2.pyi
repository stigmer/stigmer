from ai.stigmer.agentic.channel.v1 import api_pb2 as _api_pb2
from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import field_mask_pb2 as _field_mask_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ChannelId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class ListChannelsRequest(_message.Message):
    __slots__ = ("org", "page_size", "page_token", "labels")
    class LabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ORG_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    org: str
    page_size: int
    page_token: str
    labels: _containers.ScalarMap[str, str]
    def __init__(self, org: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., labels: _Optional[_Mapping[str, str]] = ...) -> None: ...

class ListChannelsByAgentRequest(_message.Message):
    __slots__ = ("agent_id", "org", "page_size", "page_token", "labels")
    class LabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    agent_id: str
    org: str
    page_size: int
    page_token: str
    labels: _containers.ScalarMap[str, str]
    def __init__(self, agent_id: _Optional[str] = ..., org: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., labels: _Optional[_Mapping[str, str]] = ...) -> None: ...

class ChannelList(_message.Message):
    __slots__ = ("entries", "next_page_token")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.Channel]
    next_page_token: str
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.Channel, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class UpdateChannelInput(_message.Message):
    __slots__ = ("resource", "update_mask")
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    UPDATE_MASK_FIELD_NUMBER: _ClassVar[int]
    resource: _api_pb2.Channel
    update_mask: _field_mask_pb2.FieldMask
    def __init__(self, resource: _Optional[_Union[_api_pb2.Channel, _Mapping]] = ..., update_mask: _Optional[_Union[_field_mask_pb2.FieldMask, _Mapping]] = ...) -> None: ...

class RotateChannelLinkInput(_message.Message):
    __slots__ = ("resource_id",)
    RESOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    resource_id: str
    def __init__(self, resource_id: _Optional[str] = ...) -> None: ...

class GetChannelAgentProfileRequest(_message.Message):
    __slots__ = ("channel_id", "link_token")
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    LINK_TOKEN_FIELD_NUMBER: _ClassVar[int]
    channel_id: str
    link_token: str
    def __init__(self, channel_id: _Optional[str] = ..., link_token: _Optional[str] = ...) -> None: ...

class ChannelAgentProfile(_message.Message):
    __slots__ = ("org", "slug", "name", "description", "icon_url", "agent_ref")
    ORG_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_URL_FIELD_NUMBER: _ClassVar[int]
    AGENT_REF_FIELD_NUMBER: _ClassVar[int]
    org: str
    slug: str
    name: str
    description: str
    icon_url: str
    agent_ref: _io_pb2.ApiResourceReference
    def __init__(self, org: _Optional[str] = ..., slug: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., icon_url: _Optional[str] = ..., agent_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ...) -> None: ...

class InitiateChannelInstallInput(_message.Message):
    __slots__ = ("resource_id",)
    RESOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    resource_id: str
    def __init__(self, resource_id: _Optional[str] = ...) -> None: ...

class InitiateChannelInstallOutput(_message.Message):
    __slots__ = ("authorization_url", "state", "completed")
    AUTHORIZATION_URL_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    COMPLETED_FIELD_NUMBER: _ClassVar[int]
    authorization_url: str
    state: str
    completed: bool
    def __init__(self, authorization_url: _Optional[str] = ..., state: _Optional[str] = ..., completed: bool = ...) -> None: ...

class CompleteChannelInstallInput(_message.Message):
    __slots__ = ("resource_id", "state", "code")
    RESOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    CODE_FIELD_NUMBER: _ClassVar[int]
    resource_id: str
    state: str
    code: str
    def __init__(self, resource_id: _Optional[str] = ..., state: _Optional[str] = ..., code: _Optional[str] = ...) -> None: ...
