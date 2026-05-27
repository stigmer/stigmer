import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class RecentActivityEntry(_message.Message):
    __slots__ = ("id", "type", "subject", "updated_at", "status")
    ID_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    id: str
    type: str
    subject: str
    updated_at: _timestamp_pb2.Timestamp
    status: str
    def __init__(self, id: _Optional[str] = ..., type: _Optional[str] = ..., subject: _Optional[str] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., status: _Optional[str] = ...) -> None: ...

class ListRecentActivityRequest(_message.Message):
    __slots__ = ("page_size", "org")
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    page_size: int
    org: str
    def __init__(self, page_size: _Optional[int] = ..., org: _Optional[str] = ...) -> None: ...

class ListRecentActivityResponse(_message.Message):
    __slots__ = ("entries",)
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[RecentActivityEntry]
    def __init__(self, entries: _Optional[_Iterable[_Union[RecentActivityEntry, _Mapping]]] = ...) -> None: ...
