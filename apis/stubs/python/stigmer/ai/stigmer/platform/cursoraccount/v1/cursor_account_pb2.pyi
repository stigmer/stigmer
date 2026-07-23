import datetime

from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class CursorAccount(_message.Message):
    __slots__ = ("account_id", "display_name", "admin_api_key", "enabled", "is_platform_default", "org_ids", "member_keys", "created_by", "created_at", "updated_by", "updated_at", "on_demand_usage_disabled")
    ACCOUNT_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    ADMIN_API_KEY_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    IS_PLATFORM_DEFAULT_FIELD_NUMBER: _ClassVar[int]
    ORG_IDS_FIELD_NUMBER: _ClassVar[int]
    MEMBER_KEYS_FIELD_NUMBER: _ClassVar[int]
    CREATED_BY_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_BY_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    ON_DEMAND_USAGE_DISABLED_FIELD_NUMBER: _ClassVar[int]
    account_id: str
    display_name: str
    admin_api_key: str
    enabled: bool
    is_platform_default: bool
    org_ids: _containers.RepeatedScalarFieldContainer[str]
    member_keys: _containers.RepeatedCompositeFieldContainer[CursorMemberKey]
    created_by: str
    created_at: _timestamp_pb2.Timestamp
    updated_by: str
    updated_at: _timestamp_pb2.Timestamp
    on_demand_usage_disabled: bool
    def __init__(self, account_id: _Optional[str] = ..., display_name: _Optional[str] = ..., admin_api_key: _Optional[str] = ..., enabled: bool = ..., is_platform_default: bool = ..., org_ids: _Optional[_Iterable[str]] = ..., member_keys: _Optional[_Iterable[_Union[CursorMemberKey, _Mapping]]] = ..., created_by: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_by: _Optional[str] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., on_demand_usage_disabled: bool = ...) -> None: ...

class CursorMemberKey(_message.Message):
    __slots__ = ("key_id", "api_key", "label", "bound_email", "bound_user_id", "cursor_key_name", "enabled", "added_by", "added_at")
    KEY_ID_FIELD_NUMBER: _ClassVar[int]
    API_KEY_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    BOUND_EMAIL_FIELD_NUMBER: _ClassVar[int]
    BOUND_USER_ID_FIELD_NUMBER: _ClassVar[int]
    CURSOR_KEY_NAME_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    ADDED_BY_FIELD_NUMBER: _ClassVar[int]
    ADDED_AT_FIELD_NUMBER: _ClassVar[int]
    key_id: str
    api_key: str
    label: str
    bound_email: str
    bound_user_id: str
    cursor_key_name: str
    enabled: bool
    added_by: str
    added_at: _timestamp_pb2.Timestamp
    def __init__(self, key_id: _Optional[str] = ..., api_key: _Optional[str] = ..., label: _Optional[str] = ..., bound_email: _Optional[str] = ..., bound_user_id: _Optional[str] = ..., cursor_key_name: _Optional[str] = ..., enabled: bool = ..., added_by: _Optional[str] = ..., added_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class CursorTeamMember(_message.Message):
    __slots__ = ("user_id", "email", "name", "role")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    email: str
    name: str
    role: str
    def __init__(self, user_id: _Optional[str] = ..., email: _Optional[str] = ..., name: _Optional[str] = ..., role: _Optional[str] = ...) -> None: ...

class CursorMemberSpend(_message.Message):
    __slots__ = ("user_id", "email", "included_spend_usd_micros", "overage_spend_usd_micros", "total_percent_used", "auto_percent_used", "api_percent_used")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    INCLUDED_SPEND_USD_MICROS_FIELD_NUMBER: _ClassVar[int]
    OVERAGE_SPEND_USD_MICROS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_PERCENT_USED_FIELD_NUMBER: _ClassVar[int]
    AUTO_PERCENT_USED_FIELD_NUMBER: _ClassVar[int]
    API_PERCENT_USED_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    email: str
    included_spend_usd_micros: int
    overage_spend_usd_micros: int
    total_percent_used: float
    auto_percent_used: float
    api_percent_used: float
    def __init__(self, user_id: _Optional[str] = ..., email: _Optional[str] = ..., included_spend_usd_micros: _Optional[int] = ..., overage_spend_usd_micros: _Optional[int] = ..., total_percent_used: _Optional[float] = ..., auto_percent_used: _Optional[float] = ..., api_percent_used: _Optional[float] = ...) -> None: ...

class CursorAccountSyncSnapshot(_message.Message):
    __slots__ = ("account_id", "synced_at", "members", "spend", "cycle_start", "sync_error")
    ACCOUNT_ID_FIELD_NUMBER: _ClassVar[int]
    SYNCED_AT_FIELD_NUMBER: _ClassVar[int]
    MEMBERS_FIELD_NUMBER: _ClassVar[int]
    SPEND_FIELD_NUMBER: _ClassVar[int]
    CYCLE_START_FIELD_NUMBER: _ClassVar[int]
    SYNC_ERROR_FIELD_NUMBER: _ClassVar[int]
    account_id: str
    synced_at: _timestamp_pb2.Timestamp
    members: _containers.RepeatedCompositeFieldContainer[CursorTeamMember]
    spend: _containers.RepeatedCompositeFieldContainer[CursorMemberSpend]
    cycle_start: _timestamp_pb2.Timestamp
    sync_error: str
    def __init__(self, account_id: _Optional[str] = ..., synced_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., members: _Optional[_Iterable[_Union[CursorTeamMember, _Mapping]]] = ..., spend: _Optional[_Iterable[_Union[CursorMemberSpend, _Mapping]]] = ..., cycle_start: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., sync_error: _Optional[str] = ...) -> None: ...
