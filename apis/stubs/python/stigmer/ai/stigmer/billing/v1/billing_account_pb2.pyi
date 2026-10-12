import datetime

from ai.stigmer.billing.v1 import enum_pb2 as _enum_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class BillingAccount(_message.Message):
    __slots__ = ("id", "org", "status", "stripe_customer_id", "default_payment_method", "created_at", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    STRIPE_CUSTOMER_ID_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_PAYMENT_METHOD_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: str
    org: str
    status: _enum_pb2.BillingAccountStatus
    stripe_customer_id: str
    default_payment_method: PaymentMethodSummary
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    def __init__(self, id: _Optional[str] = ..., org: _Optional[str] = ..., status: _Optional[_Union[_enum_pb2.BillingAccountStatus, str]] = ..., stripe_customer_id: _Optional[str] = ..., default_payment_method: _Optional[_Union[PaymentMethodSummary, _Mapping]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

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
