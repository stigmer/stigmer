import datetime

from ai.stigmer.billing.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.billing.v1 import policy_pb2 as _policy_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class CreditLedgerEntry(_message.Message):
    __slots__ = ("entry_id", "org_id", "type", "amount_micros", "balance_after_micros", "idempotency_key", "rating", "source", "created_at")
    ENTRY_ID_FIELD_NUMBER: _ClassVar[int]
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    AMOUNT_MICROS_FIELD_NUMBER: _ClassVar[int]
    BALANCE_AFTER_MICROS_FIELD_NUMBER: _ClassVar[int]
    IDEMPOTENCY_KEY_FIELD_NUMBER: _ClassVar[int]
    RATING_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    entry_id: str
    org_id: str
    type: _enum_pb2.LedgerEntryType
    amount_micros: int
    balance_after_micros: int
    idempotency_key: str
    rating: _policy_pb2.BillingUsageRating
    source: CreditLedgerSource
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, entry_id: _Optional[str] = ..., org_id: _Optional[str] = ..., type: _Optional[_Union[_enum_pb2.LedgerEntryType, str]] = ..., amount_micros: _Optional[int] = ..., balance_after_micros: _Optional[int] = ..., idempotency_key: _Optional[str] = ..., rating: _Optional[_Union[_policy_pb2.BillingUsageRating, _Mapping]] = ..., source: _Optional[_Union[CreditLedgerSource, _Mapping]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class CreditLedgerSource(_message.Message):
    __slots__ = ("execution_id", "session_id", "agent_id", "llm_call_sequence", "purchase_id", "grant_id", "reservation_id", "adjusted_by", "description")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    LLM_CALL_SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    PURCHASE_ID_FIELD_NUMBER: _ClassVar[int]
    GRANT_ID_FIELD_NUMBER: _ClassVar[int]
    RESERVATION_ID_FIELD_NUMBER: _ClassVar[int]
    ADJUSTED_BY_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    session_id: str
    agent_id: str
    llm_call_sequence: int
    purchase_id: str
    grant_id: str
    reservation_id: str
    adjusted_by: str
    description: str
    def __init__(self, execution_id: _Optional[str] = ..., session_id: _Optional[str] = ..., agent_id: _Optional[str] = ..., llm_call_sequence: _Optional[int] = ..., purchase_id: _Optional[str] = ..., grant_id: _Optional[str] = ..., reservation_id: _Optional[str] = ..., adjusted_by: _Optional[str] = ..., description: _Optional[str] = ...) -> None: ...

class CreditGrant(_message.Message):
    __slots__ = ("grant_id", "org_id", "kind", "original_amount_micros", "remaining_amount_micros", "expires_at", "priority", "created_at")
    GRANT_ID_FIELD_NUMBER: _ClassVar[int]
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    ORIGINAL_AMOUNT_MICROS_FIELD_NUMBER: _ClassVar[int]
    REMAINING_AMOUNT_MICROS_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    PRIORITY_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    grant_id: str
    org_id: str
    kind: _enum_pb2.CreditGrantKind
    original_amount_micros: int
    remaining_amount_micros: int
    expires_at: _timestamp_pb2.Timestamp
    priority: int
    created_at: _timestamp_pb2.Timestamp
    def __init__(self, grant_id: _Optional[str] = ..., org_id: _Optional[str] = ..., kind: _Optional[_Union[_enum_pb2.CreditGrantKind, str]] = ..., original_amount_micros: _Optional[int] = ..., remaining_amount_micros: _Optional[int] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., priority: _Optional[int] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class CreditPack(_message.Message):
    __slots__ = ("pack_id", "display_name", "price_micros", "credits_micros", "active")
    PACK_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    PRICE_MICROS_FIELD_NUMBER: _ClassVar[int]
    CREDITS_MICROS_FIELD_NUMBER: _ClassVar[int]
    ACTIVE_FIELD_NUMBER: _ClassVar[int]
    pack_id: str
    display_name: str
    price_micros: int
    credits_micros: int
    active: bool
    def __init__(self, pack_id: _Optional[str] = ..., display_name: _Optional[str] = ..., price_micros: _Optional[int] = ..., credits_micros: _Optional[int] = ..., active: bool = ...) -> None: ...

class ExecutionReservation(_message.Message):
    __slots__ = ("reservation_id", "org_id", "execution_id", "reserved_micros", "consumed_micros", "status", "created_at", "expires_at")
    RESERVATION_ID_FIELD_NUMBER: _ClassVar[int]
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    RESERVED_MICROS_FIELD_NUMBER: _ClassVar[int]
    CONSUMED_MICROS_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    reservation_id: str
    org_id: str
    execution_id: str
    reserved_micros: int
    consumed_micros: int
    status: _enum_pb2.ReservationStatus
    created_at: _timestamp_pb2.Timestamp
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, reservation_id: _Optional[str] = ..., org_id: _Optional[str] = ..., execution_id: _Optional[str] = ..., reserved_micros: _Optional[int] = ..., consumed_micros: _Optional[int] = ..., status: _Optional[_Union[_enum_pb2.ReservationStatus, str]] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...
