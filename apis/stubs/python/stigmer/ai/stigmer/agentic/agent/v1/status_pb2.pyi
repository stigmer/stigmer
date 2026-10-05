from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentStatus(_message.Message):
    __slots__ = ("audit", "version_hash")
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    VERSION_HASH_FIELD_NUMBER: _ClassVar[int]
    audit: _status_pb2.ApiResourceAudit
    version_hash: str
    def __init__(self, audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ..., version_hash: _Optional[str] = ...) -> None: ...
