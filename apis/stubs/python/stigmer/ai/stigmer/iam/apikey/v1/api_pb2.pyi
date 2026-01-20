import datetime

from ai.stigmer.commons.apiresource import metadata_pb2 as _metadata_pb2
from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from ai.stigmer.iam.apikey.v1 import spec_pb2 as _spec_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ApiKey(_message.Message):
    __slots__ = ("api_version", "kind", "metadata", "spec", "status")
    API_VERSION_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    SPEC_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    api_version: str
    kind: str
    metadata: _metadata_pb2.ApiResourceMetadata
    spec: _spec_pb2.ApiKeySpec
    status: ApiKeyStatus
    def __init__(self, api_version: _Optional[str] = ..., kind: _Optional[str] = ..., metadata: _Optional[_Union[_metadata_pb2.ApiResourceMetadata, _Mapping]] = ..., spec: _Optional[_Union[_spec_pb2.ApiKeySpec, _Mapping]] = ..., status: _Optional[_Union[ApiKeyStatus, _Mapping]] = ...) -> None: ...

class ApiKeyStatus(_message.Message):
    __slots__ = ("audit", "last_used_at")
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    LAST_USED_AT_FIELD_NUMBER: _ClassVar[int]
    audit: _status_pb2.ApiResourceAudit
    last_used_at: _timestamp_pb2.Timestamp
    def __init__(self, audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ..., last_used_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...
