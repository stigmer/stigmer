from ai.stigmer.billing.providerkey.v1 import api_pb2 as _api_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SetProviderKeyInput(_message.Message):
    __slots__ = ("org_id", "provider", "api_key")
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    API_KEY_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    provider: str
    api_key: str
    def __init__(self, org_id: _Optional[str] = ..., provider: _Optional[str] = ..., api_key: _Optional[str] = ...) -> None: ...

class DeleteProviderKeyInput(_message.Message):
    __slots__ = ("org_id", "provider")
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    provider: str
    def __init__(self, org_id: _Optional[str] = ..., provider: _Optional[str] = ...) -> None: ...

class ListProviderKeysInput(_message.Message):
    __slots__ = ("org_id",)
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    def __init__(self, org_id: _Optional[str] = ...) -> None: ...

class ListProviderKeysOutput(_message.Message):
    __slots__ = ("keys",)
    KEYS_FIELD_NUMBER: _ClassVar[int]
    keys: _containers.RepeatedCompositeFieldContainer[_api_pb2.ProviderKey]
    def __init__(self, keys: _Optional[_Iterable[_Union[_api_pb2.ProviderKey, _Mapping]]] = ...) -> None: ...
