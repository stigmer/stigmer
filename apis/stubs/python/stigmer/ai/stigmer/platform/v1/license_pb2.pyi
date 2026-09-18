import datetime

from ai.stigmer.platform.v1 import entitlement_pb2 as _entitlement_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class LicenseTerm(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    license_term_unspecified: _ClassVar[LicenseTerm]
    trial: _ClassVar[LicenseTerm]
    paid: _ClassVar[LicenseTerm]

class LicenseState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    license_state_unspecified: _ClassVar[LicenseState]
    absent: _ClassVar[LicenseState]
    valid: _ClassVar[LicenseState]
    expiring: _ClassVar[LicenseState]
    grace: _ClassVar[LicenseState]
    expired: _ClassVar[LicenseState]
    invalid: _ClassVar[LicenseState]
license_term_unspecified: LicenseTerm
trial: LicenseTerm
paid: LicenseTerm
license_state_unspecified: LicenseState
absent: LicenseState
valid: LicenseState
expiring: LicenseState
grace: LicenseState
expired: LicenseState
invalid: LicenseState

class LicenseClaims(_message.Message):
    __slots__ = ("license_id", "customer", "term", "entitlements", "issued_at", "expires_at", "grace_until")
    LICENSE_ID_FIELD_NUMBER: _ClassVar[int]
    CUSTOMER_FIELD_NUMBER: _ClassVar[int]
    TERM_FIELD_NUMBER: _ClassVar[int]
    ENTITLEMENTS_FIELD_NUMBER: _ClassVar[int]
    ISSUED_AT_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    GRACE_UNTIL_FIELD_NUMBER: _ClassVar[int]
    license_id: str
    customer: LicenseCustomer
    term: LicenseTerm
    entitlements: _entitlement_pb2.Entitlements
    issued_at: _timestamp_pb2.Timestamp
    expires_at: _timestamp_pb2.Timestamp
    grace_until: _timestamp_pb2.Timestamp
    def __init__(self, license_id: _Optional[str] = ..., customer: _Optional[_Union[LicenseCustomer, _Mapping]] = ..., term: _Optional[_Union[LicenseTerm, str]] = ..., entitlements: _Optional[_Union[_entitlement_pb2.Entitlements, _Mapping]] = ..., issued_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., grace_until: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class LicenseCustomer(_message.Message):
    __slots__ = ("id", "display_name", "contact_email", "organization")
    ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    CONTACT_EMAIL_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_FIELD_NUMBER: _ClassVar[int]
    id: str
    display_name: str
    contact_email: str
    organization: str
    def __init__(self, id: _Optional[str] = ..., display_name: _Optional[str] = ..., contact_email: _Optional[str] = ..., organization: _Optional[str] = ...) -> None: ...
