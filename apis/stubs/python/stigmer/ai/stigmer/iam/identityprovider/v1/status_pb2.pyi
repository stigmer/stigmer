from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from ai.stigmer.iam.identityprovider.v1 import enum_pb2 as _enum_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class IdentityProviderStatus(_message.Message):
    __slots__ = ("lifecycle_state", "audit")
    LIFECYCLE_STATE_FIELD_NUMBER: _ClassVar[int]
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    lifecycle_state: _enum_pb2.IdentityProviderLifecycleState
    audit: _status_pb2.ApiResourceAudit
    def __init__(self, lifecycle_state: _Optional[_Union[_enum_pb2.IdentityProviderLifecycleState, str]] = ..., audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ...) -> None: ...
