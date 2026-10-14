from ai.stigmer.billing.plan.v1 import api_pb2 as _api_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PlanId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class Plans(_message.Message):
    __slots__ = ("entries", "next_page_token")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.Plan]
    next_page_token: str
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.Plan, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class ListPlansInput(_message.Message):
    __slots__ = ("include_retired", "page_size", "page_token")
    INCLUDE_RETIRED_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    include_retired: bool
    page_size: int
    page_token: str
    def __init__(self, include_retired: bool = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...
