from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class BillingAccountStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    billing_account_status_unspecified: _ClassVar[BillingAccountStatus]
    billing_account_active: _ClassVar[BillingAccountStatus]
    billing_account_suspended: _ClassVar[BillingAccountStatus]
    billing_account_closed: _ClassVar[BillingAccountStatus]
billing_account_status_unspecified: BillingAccountStatus
billing_account_active: BillingAccountStatus
billing_account_suspended: BillingAccountStatus
billing_account_closed: BillingAccountStatus
