import datetime

from ai.stigmer.billing.v1 import enum_pb2 as _enum_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class BillingAccount(_message.Message):
    __slots__ = ("id", "org_id", "status", "balance", "auto_recharge", "stripe_customer_id", "allowed_negative_balance_micros", "low_balance_threshold_micros", "default_payment_method", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    BALANCE_FIELD_NUMBER: _ClassVar[int]
    AUTO_RECHARGE_FIELD_NUMBER: _ClassVar[int]
    STRIPE_CUSTOMER_ID_FIELD_NUMBER: _ClassVar[int]
    ALLOWED_NEGATIVE_BALANCE_MICROS_FIELD_NUMBER: _ClassVar[int]
    LOW_BALANCE_THRESHOLD_MICROS_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_PAYMENT_METHOD_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    org_id: str
    status: _enum_pb2.BillingAccountStatus
    balance: CreditBalance
    auto_recharge: AutoRechargeConfig
    stripe_customer_id: str
    allowed_negative_balance_micros: int
    low_balance_threshold_micros: int
    default_payment_method: PaymentMethodSummary
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., org_id: _Optional[str] = ..., status: _Optional[_Union[_enum_pb2.BillingAccountStatus, str]] = ..., balance: _Optional[_Union[CreditBalance, _Mapping]] = ..., auto_recharge: _Optional[_Union[AutoRechargeConfig, _Mapping]] = ..., stripe_customer_id: _Optional[str] = ..., allowed_negative_balance_micros: _Optional[int] = ..., low_balance_threshold_micros: _Optional[int] = ..., default_payment_method: _Optional[_Union[PaymentMethodSummary, _Mapping]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class CreditBalance(_message.Message):
    __slots__ = ("available_micros", "reserved_micros", "promotional_micros", "purchased_micros", "total_micros")
    AVAILABLE_MICROS_FIELD_NUMBER: _ClassVar[int]
    RESERVED_MICROS_FIELD_NUMBER: _ClassVar[int]
    PROMOTIONAL_MICROS_FIELD_NUMBER: _ClassVar[int]
    PURCHASED_MICROS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_MICROS_FIELD_NUMBER: _ClassVar[int]
    available_micros: int
    reserved_micros: int
    promotional_micros: int
    purchased_micros: int
    total_micros: int
    def __init__(self, available_micros: _Optional[int] = ..., reserved_micros: _Optional[int] = ..., promotional_micros: _Optional[int] = ..., purchased_micros: _Optional[int] = ..., total_micros: _Optional[int] = ...) -> None: ...

class PaymentMethodSummary(_message.Message):
    __slots__ = ("payment_method_id", "brand", "last4", "exp_month", "exp_year")
    PAYMENT_METHOD_ID_FIELD_NUMBER: _ClassVar[int]
    BRAND_FIELD_NUMBER: _ClassVar[int]
    LAST4_FIELD_NUMBER: _ClassVar[int]
    EXP_MONTH_FIELD_NUMBER: _ClassVar[int]
    EXP_YEAR_FIELD_NUMBER: _ClassVar[int]
    payment_method_id: str
    brand: str
    last4: str
    exp_month: int
    exp_year: int
    def __init__(self, payment_method_id: _Optional[str] = ..., brand: _Optional[str] = ..., last4: _Optional[str] = ..., exp_month: _Optional[int] = ..., exp_year: _Optional[int] = ...) -> None: ...

class AutoRechargeConfig(_message.Message):
    __slots__ = ("enabled", "threshold_micros", "recharge_amount_micros", "monthly_cap_micros", "current_month_charged_micros", "current_month")
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    THRESHOLD_MICROS_FIELD_NUMBER: _ClassVar[int]
    RECHARGE_AMOUNT_MICROS_FIELD_NUMBER: _ClassVar[int]
    MONTHLY_CAP_MICROS_FIELD_NUMBER: _ClassVar[int]
    CURRENT_MONTH_CHARGED_MICROS_FIELD_NUMBER: _ClassVar[int]
    CURRENT_MONTH_FIELD_NUMBER: _ClassVar[int]
    enabled: bool
    threshold_micros: int
    recharge_amount_micros: int
    monthly_cap_micros: int
    current_month_charged_micros: int
    current_month: str
    def __init__(self, enabled: bool = ..., threshold_micros: _Optional[int] = ..., recharge_amount_micros: _Optional[int] = ..., monthly_cap_micros: _Optional[int] = ..., current_month_charged_micros: _Optional[int] = ..., current_month: _Optional[str] = ...) -> None: ...
