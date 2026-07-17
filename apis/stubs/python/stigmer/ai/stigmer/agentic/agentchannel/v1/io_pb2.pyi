from ai.stigmer.agentic.agentchannel.v1 import api_pb2 as _api_pb2
from ai.stigmer.commons.rpc import pagination_pb2 as _pagination_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentChannelId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class GetAgentChannelsByAgentRequest(_message.Message):
    __slots__ = ("agent_id", "page_info", "org")
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_INFO_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    agent_id: str
    page_info: _pagination_pb2.PageInfo
    org: str
    def __init__(self, agent_id: _Optional[str] = ..., page_info: _Optional[_Union[_pagination_pb2.PageInfo, _Mapping]] = ..., org: _Optional[str] = ...) -> None: ...

class AgentChannelList(_message.Message):
    __slots__ = ("total_count", "items")
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    total_count: int
    items: _containers.RepeatedCompositeFieldContainer[_api_pb2.AgentChannel]
    def __init__(self, total_count: _Optional[int] = ..., items: _Optional[_Iterable[_Union[_api_pb2.AgentChannel, _Mapping]]] = ...) -> None: ...

class ListAgentChannelsRequest(_message.Message):
    __slots__ = ("org", "labels", "page_info")
    class LabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ORG_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    PAGE_INFO_FIELD_NUMBER: _ClassVar[int]
    org: str
    labels: _containers.ScalarMap[str, str]
    page_info: _pagination_pb2.PageInfo
    def __init__(self, org: _Optional[str] = ..., labels: _Optional[_Mapping[str, str]] = ..., page_info: _Optional[_Union[_pagination_pb2.PageInfo, _Mapping]] = ...) -> None: ...

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
