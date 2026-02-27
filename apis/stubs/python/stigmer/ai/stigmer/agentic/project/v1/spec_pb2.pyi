from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ProjectSpec(_message.Message):
    __slots__ = ("entry_point", "description", "members")
    ENTRY_POINT_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    MEMBERS_FIELD_NUMBER: _ClassVar[int]
    entry_point: str
    description: str
    members: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    def __init__(self, entry_point: _Optional[str] = ..., description: _Optional[str] = ..., members: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ...) -> None: ...
