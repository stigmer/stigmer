from ai.stigmer.iam.platformclient.v1 import api_pb2 as _api_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PlatformClientId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class PlatformClients(_message.Message):
    __slots__ = ("entries",)
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.PlatformClient]
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.PlatformClient, _Mapping]]] = ...) -> None: ...

class ListPlatformClientsByOrgInput(_message.Message):
    __slots__ = ("org",)
    ORG_FIELD_NUMBER: _ClassVar[int]
    org: str
    def __init__(self, org: _Optional[str] = ...) -> None: ...

class PlatformClientCreateResponse(_message.Message):
    __slots__ = ("platform_client", "client_secret")
    PLATFORM_CLIENT_FIELD_NUMBER: _ClassVar[int]
    CLIENT_SECRET_FIELD_NUMBER: _ClassVar[int]
    platform_client: _api_pb2.PlatformClient
    client_secret: str
    def __init__(self, platform_client: _Optional[_Union[_api_pb2.PlatformClient, _Mapping]] = ..., client_secret: _Optional[str] = ...) -> None: ...
