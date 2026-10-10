from ai.stigmer.agentic.session.v1 import api_pb2 as _api_pb2
from ai.stigmer.agentic.session.v1 import event_pb2 as _event_pb2
from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
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

class ListSessionsByAgentRequest(_message.Message):
    __slots__ = ("agent_id", "page_size", "page_token")
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    agent_id: str
    page_size: int
    page_token: str
    def __init__(self, agent_id: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

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

class ListSessionEventsRequest(_message.Message):
    __slots__ = ("session_id", "page_size", "page_token", "order", "types", "created_at_gt", "created_at_gte", "created_at_lt", "created_at_lte")
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    ORDER_FIELD_NUMBER: _ClassVar[int]
    TYPES_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_GT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_GTE_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_LT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_LTE_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    page_size: int
    page_token: str
    order: str
    types: _containers.RepeatedScalarFieldContainer[str]
    created_at_gt: str
    created_at_gte: str
    created_at_lt: str
    created_at_lte: str
    def __init__(self, session_id: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., order: _Optional[str] = ..., types: _Optional[_Iterable[str]] = ..., created_at_gt: _Optional[str] = ..., created_at_gte: _Optional[str] = ..., created_at_lt: _Optional[str] = ..., created_at_lte: _Optional[str] = ...) -> None: ...

class SessionEventList(_message.Message):
    __slots__ = ("events", "next_page_token")
    EVENTS_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    events: _containers.RepeatedCompositeFieldContainer[_event_pb2.SessionEvent]
    next_page_token: str
    def __init__(self, events: _Optional[_Iterable[_Union[_event_pb2.SessionEvent, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class StreamSessionEventsRequest(_message.Message):
    __slots__ = ("session_id", "event_deltas")
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    EVENT_DELTAS_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    event_deltas: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, session_id: _Optional[str] = ..., event_deltas: _Optional[_Iterable[str]] = ...) -> None: ...

class StreamSessionEventsResponse(_message.Message):
    __slots__ = ("event", "event_start", "event_delta")
    EVENT_FIELD_NUMBER: _ClassVar[int]
    EVENT_START_FIELD_NUMBER: _ClassVar[int]
    EVENT_DELTA_FIELD_NUMBER: _ClassVar[int]
    event: _event_pb2.SessionEvent
    event_start: _event_pb2.EventStart
    event_delta: _event_pb2.EventDelta
    def __init__(self, event: _Optional[_Union[_event_pb2.SessionEvent, _Mapping]] = ..., event_start: _Optional[_Union[_event_pb2.EventStart, _Mapping]] = ..., event_delta: _Optional[_Union[_event_pb2.EventDelta, _Mapping]] = ...) -> None: ...

class SessionEventPreview(_message.Message):
    __slots__ = ("event_start", "event_delta")
    EVENT_START_FIELD_NUMBER: _ClassVar[int]
    EVENT_DELTA_FIELD_NUMBER: _ClassVar[int]
    event_start: _event_pb2.EventStart
    event_delta: _event_pb2.EventDelta
    def __init__(self, event_start: _Optional[_Union[_event_pb2.EventStart, _Mapping]] = ..., event_delta: _Optional[_Union[_event_pb2.EventDelta, _Mapping]] = ...) -> None: ...

class AppendSessionEventsInput(_message.Message):
    __slots__ = ("run_id", "events", "previews")
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    EVENTS_FIELD_NUMBER: _ClassVar[int]
    PREVIEWS_FIELD_NUMBER: _ClassVar[int]
    run_id: str
    events: _containers.RepeatedCompositeFieldContainer[_event_pb2.SessionEvent]
    previews: _containers.RepeatedCompositeFieldContainer[SessionEventPreview]
    def __init__(self, run_id: _Optional[str] = ..., events: _Optional[_Iterable[_Union[_event_pb2.SessionEvent, _Mapping]]] = ..., previews: _Optional[_Iterable[_Union[SessionEventPreview, _Mapping]]] = ...) -> None: ...

class AppendSessionEventsResponse(_message.Message):
    __slots__ = ("events",)
    EVENTS_FIELD_NUMBER: _ClassVar[int]
    events: _containers.RepeatedCompositeFieldContainer[_event_pb2.SessionEvent]
    def __init__(self, events: _Optional[_Iterable[_Union[_event_pb2.SessionEvent, _Mapping]]] = ...) -> None: ...
