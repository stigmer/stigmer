from ai.stigmer.agentic.session.v1 import api_pb2 as _api_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SessionId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class AgentId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class SessionList(_message.Message):
    __slots__ = ("total_pages", "entries", "next_page_token")
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    total_pages: int
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.Session]
    next_page_token: str
    def __init__(self, total_pages: _Optional[int] = ..., entries: _Optional[_Iterable[_Union[_api_pb2.Session, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class ListSessionsRequest(_message.Message):
    __slots__ = ("page_size", "page_token", "tags", "org")
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    page_size: int
    page_token: str
    tags: _containers.RepeatedScalarFieldContainer[str]
    org: str
    def __init__(self, page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., tags: _Optional[_Iterable[str]] = ..., org: _Optional[str] = ...) -> None: ...

class ListSessionsByAgentInstanceRequest(_message.Message):
    __slots__ = ("agent_instance_id", "page_size", "page_token")
    AGENT_INSTANCE_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    agent_instance_id: str
    page_size: int
    page_token: str
    def __init__(self, agent_instance_id: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

class ListSessionsByChannelRequest(_message.Message):
    __slots__ = ("channel_id", "page_size", "page_token")
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    channel_id: str
    page_size: int
    page_token: str
    def __init__(self, channel_id: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

class UpdateSessionSubjectRequest(_message.Message):
    __slots__ = ("id", "subject")
    ID_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_FIELD_NUMBER: _ClassVar[int]
    id: str
    subject: str
    def __init__(self, id: _Optional[str] = ..., subject: _Optional[str] = ...) -> None: ...
