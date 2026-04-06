import datetime

from ai.stigmer.commons.apiresource import metadata_pb2 as _metadata_pb2
from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from ai.stigmer.iam.invitation.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.iam.invitation.v1 import spec_pb2 as _spec_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Invitation(_message.Message):
    __slots__ = ("api_version", "kind", "metadata", "spec", "status")
    API_VERSION_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    SPEC_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    api_version: str
    kind: str
    metadata: _metadata_pb2.ApiResourceMetadata
    spec: _spec_pb2.InvitationSpec
    status: InvitationStatus
    def __init__(self, api_version: _Optional[str] = ..., kind: _Optional[str] = ..., metadata: _Optional[_Union[_metadata_pb2.ApiResourceMetadata, _Mapping]] = ..., spec: _Optional[_Union[_spec_pb2.InvitationSpec, _Mapping]] = ..., status: _Optional[_Union[InvitationStatus, _Mapping]] = ...) -> None: ...

class InvitationStatus(_message.Message):
    __slots__ = ("token", "state", "redemption_count", "redemptions", "audit")
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    REDEMPTION_COUNT_FIELD_NUMBER: _ClassVar[int]
    REDEMPTIONS_FIELD_NUMBER: _ClassVar[int]
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    token: str
    state: _enum_pb2.InvitationState
    redemption_count: int
    redemptions: _containers.RepeatedCompositeFieldContainer[InvitationRedemption]
    audit: _status_pb2.ApiResourceAudit
    def __init__(self, token: _Optional[str] = ..., state: _Optional[_Union[_enum_pb2.InvitationState, str]] = ..., redemption_count: _Optional[int] = ..., redemptions: _Optional[_Iterable[_Union[InvitationRedemption, _Mapping]]] = ..., audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ...) -> None: ...

class InvitationRedemption(_message.Message):
    __slots__ = ("identity_account_id", "redeemed_at")
    IDENTITY_ACCOUNT_ID_FIELD_NUMBER: _ClassVar[int]
    REDEEMED_AT_FIELD_NUMBER: _ClassVar[int]
    identity_account_id: str
    redeemed_at: _timestamp_pb2.Timestamp
    def __init__(self, identity_account_id: _Optional[str] = ..., redeemed_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...
