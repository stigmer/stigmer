import datetime

from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class GetProviderStandingViewInput(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class ProviderStandingEntry(_message.Message):
    __slots__ = ("provider", "status", "http_status", "latency_ms", "error_summary", "checked_at")
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    HTTP_STATUS_FIELD_NUMBER: _ClassVar[int]
    LATENCY_MS_FIELD_NUMBER: _ClassVar[int]
    ERROR_SUMMARY_FIELD_NUMBER: _ClassVar[int]
    CHECKED_AT_FIELD_NUMBER: _ClassVar[int]
    provider: str
    status: str
    http_status: int
    latency_ms: int
    error_summary: str
    checked_at: _timestamp_pb2.Timestamp
    def __init__(self, provider: _Optional[str] = ..., status: _Optional[str] = ..., http_status: _Optional[int] = ..., latency_ms: _Optional[int] = ..., error_summary: _Optional[str] = ..., checked_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ProviderStandingView(_message.Message):
    __slots__ = ("providers",)
    PROVIDERS_FIELD_NUMBER: _ClassVar[int]
    providers: _containers.RepeatedCompositeFieldContainer[ProviderStandingEntry]
    def __init__(self, providers: _Optional[_Iterable[_Union[ProviderStandingEntry, _Mapping]]] = ...) -> None: ...
