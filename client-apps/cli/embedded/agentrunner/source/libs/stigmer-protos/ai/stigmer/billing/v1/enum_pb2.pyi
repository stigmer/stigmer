from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class LedgerEntryType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ledger_entry_type_unspecified: _ClassVar[LedgerEntryType]
    purchase_credit: _ClassVar[LedgerEntryType]
    promotional_credit: _ClassVar[LedgerEntryType]
    usage_debit: _ClassVar[LedgerEntryType]
    reservation_hold: _ClassVar[LedgerEntryType]
    reservation_release: _ClassVar[LedgerEntryType]
    adjustment_credit: _ClassVar[LedgerEntryType]
    adjustment_debit: _ClassVar[LedgerEntryType]
    refund_reversal: _ClassVar[LedgerEntryType]
    dispute_hold: _ClassVar[LedgerEntryType]
    dispute_release: _ClassVar[LedgerEntryType]
    expiry_debit: _ClassVar[LedgerEntryType]
    auto_recharge_credit: _ClassVar[LedgerEntryType]

class CreditGrantKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    credit_grant_kind_unspecified: _ClassVar[CreditGrantKind]
    purchased: _ClassVar[CreditGrantKind]
    promotional: _ClassVar[CreditGrantKind]
    adjustment: _ClassVar[CreditGrantKind]

class BillingAccountStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    billing_account_status_unspecified: _ClassVar[BillingAccountStatus]
    billing_account_active: _ClassVar[BillingAccountStatus]
    billing_account_suspended: _ClassVar[BillingAccountStatus]
    billing_account_closed: _ClassVar[BillingAccountStatus]

class ReservationStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    reservation_status_unspecified: _ClassVar[ReservationStatus]
    reservation_active: _ClassVar[ReservationStatus]
    reservation_finalized: _ClassVar[ReservationStatus]
    reservation_expired: _ClassVar[ReservationStatus]
    reservation_cancelled: _ClassVar[ReservationStatus]

class ExecutionBillingSignal(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    execution_billing_signal_unspecified: _ClassVar[ExecutionBillingSignal]
    continue_execution: _ClassVar[ExecutionBillingSignal]
    low_balance_warning: _ClassVar[ExecutionBillingSignal]
    stop_execution: _ClassVar[ExecutionBillingSignal]

class CreditPurchaseStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    credit_purchase_status_unspecified: _ClassVar[CreditPurchaseStatus]
    credit_purchase_pending: _ClassVar[CreditPurchaseStatus]
    credit_purchase_completed: _ClassVar[CreditPurchaseStatus]
    credit_purchase_failed: _ClassVar[CreditPurchaseStatus]
    credit_purchase_expired: _ClassVar[CreditPurchaseStatus]

class AutoRechargeEventStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    auto_recharge_event_status_unspecified: _ClassVar[AutoRechargeEventStatus]
    auto_recharge_pending: _ClassVar[AutoRechargeEventStatus]
    auto_recharge_succeeded: _ClassVar[AutoRechargeEventStatus]
    auto_recharge_failed: _ClassVar[AutoRechargeEventStatus]
ledger_entry_type_unspecified: LedgerEntryType
purchase_credit: LedgerEntryType
promotional_credit: LedgerEntryType
usage_debit: LedgerEntryType
reservation_hold: LedgerEntryType
reservation_release: LedgerEntryType
adjustment_credit: LedgerEntryType
adjustment_debit: LedgerEntryType
refund_reversal: LedgerEntryType
dispute_hold: LedgerEntryType
dispute_release: LedgerEntryType
expiry_debit: LedgerEntryType
auto_recharge_credit: LedgerEntryType
credit_grant_kind_unspecified: CreditGrantKind
purchased: CreditGrantKind
promotional: CreditGrantKind
adjustment: CreditGrantKind
billing_account_status_unspecified: BillingAccountStatus
billing_account_active: BillingAccountStatus
billing_account_suspended: BillingAccountStatus
billing_account_closed: BillingAccountStatus
reservation_status_unspecified: ReservationStatus
reservation_active: ReservationStatus
reservation_finalized: ReservationStatus
reservation_expired: ReservationStatus
reservation_cancelled: ReservationStatus
execution_billing_signal_unspecified: ExecutionBillingSignal
continue_execution: ExecutionBillingSignal
low_balance_warning: ExecutionBillingSignal
stop_execution: ExecutionBillingSignal
credit_purchase_status_unspecified: CreditPurchaseStatus
credit_purchase_pending: CreditPurchaseStatus
credit_purchase_completed: CreditPurchaseStatus
credit_purchase_failed: CreditPurchaseStatus
credit_purchase_expired: CreditPurchaseStatus
auto_recharge_event_status_unspecified: AutoRechargeEventStatus
auto_recharge_pending: AutoRechargeEventStatus
auto_recharge_succeeded: AutoRechargeEventStatus
auto_recharge_failed: AutoRechargeEventStatus
