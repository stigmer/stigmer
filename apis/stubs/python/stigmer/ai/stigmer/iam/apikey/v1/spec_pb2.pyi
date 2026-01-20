import datetime

from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ApiKeySpec(_message.Message):
    __slots__ = ("key_hash", "fingerprint", "expires_at", "never_expires")
    KEY_HASH_FIELD_NUMBER: _ClassVar[int]
    FINGERPRINT_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    NEVER_EXPIRES_FIELD_NUMBER: _ClassVar[int]
    key_hash: str
    fingerprint: str
    expires_at: _timestamp_pb2.Timestamp
    never_expires: bool
    def __init__(self, key_hash: _Optional[str] = ..., fingerprint: _Optional[str] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., never_expires: bool = ...) -> None: ...
