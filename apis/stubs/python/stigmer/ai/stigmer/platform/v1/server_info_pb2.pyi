from ai.stigmer.commons.rpc import method_options_pb2 as _method_options_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ServerEdition(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    server_edition_unspecified: _ClassVar[ServerEdition]
    oss: _ClassVar[ServerEdition]
    cloud: _ClassVar[ServerEdition]
server_edition_unspecified: ServerEdition
oss: ServerEdition
cloud: ServerEdition

class GetServerInfoInput(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetServerInfoOutput(_message.Message):
    __slots__ = ("edition", "version")
    EDITION_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    edition: ServerEdition
    version: str
    def __init__(self, edition: _Optional[_Union[ServerEdition, str]] = ..., version: _Optional[str] = ...) -> None: ...
