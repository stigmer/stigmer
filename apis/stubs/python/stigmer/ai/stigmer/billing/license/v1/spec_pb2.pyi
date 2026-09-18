import datetime

from ai.stigmer.platform.v1 import entitlement_pb2 as _entitlement_pb2
from ai.stigmer.platform.v1 import license_pb2 as _license_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class LicenseSpec(_message.Message):
    __slots__ = ("customer", "plan_id", "entitlements", "term", "expires_at", "grace_until", "notes")
    CUSTOMER_FIELD_NUMBER: _ClassVar[int]
    PLAN_ID_FIELD_NUMBER: _ClassVar[int]
    ENTITLEMENTS_FIELD_NUMBER: _ClassVar[int]
    TERM_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    GRACE_UNTIL_FIELD_NUMBER: _ClassVar[int]
    NOTES_FIELD_NUMBER: _ClassVar[int]
    customer: _license_pb2.LicenseCustomer
    plan_id: str
    entitlements: _entitlement_pb2.Entitlements
    term: _license_pb2.LicenseTerm
    expires_at: _timestamp_pb2.Timestamp
    grace_until: _timestamp_pb2.Timestamp
    notes: str
    def __init__(self, customer: _Optional[_Union[_license_pb2.LicenseCustomer, _Mapping]] = ..., plan_id: _Optional[str] = ..., entitlements: _Optional[_Union[_entitlement_pb2.Entitlements, _Mapping]] = ..., term: _Optional[_Union[_license_pb2.LicenseTerm, str]] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., grace_until: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., notes: _Optional[str] = ...) -> None: ...
