import datetime

from ai.stigmer.platform.cursoraccount.v1 import cursor_account_pb2 as _cursor_account_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class CursorMemberKeyState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    cursor_member_key_state_unspecified: _ClassVar[CursorMemberKeyState]
    member_key_active: _ClassVar[CursorMemberKeyState]
    member_key_owner_removed: _ClassVar[CursorMemberKeyState]
    member_key_owner_unknown: _ClassVar[CursorMemberKeyState]
cursor_member_key_state_unspecified: CursorMemberKeyState
member_key_active: CursorMemberKeyState
member_key_owner_removed: CursorMemberKeyState
member_key_owner_unknown: CursorMemberKeyState

class UpsertCursorAccountInput(_message.Message):
    __slots__ = ("account",)
    ACCOUNT_FIELD_NUMBER: _ClassVar[int]
    account: _cursor_account_pb2.CursorAccount
    def __init__(self, account: _Optional[_Union[_cursor_account_pb2.CursorAccount, _Mapping]] = ...) -> None: ...

class DeleteCursorAccountInput(_message.Message):
    __slots__ = ("account_id", "force")
    ACCOUNT_ID_FIELD_NUMBER: _ClassVar[int]
    FORCE_FIELD_NUMBER: _ClassVar[int]
    account_id: str
    force: bool
    def __init__(self, account_id: _Optional[str] = ..., force: bool = ...) -> None: ...

class AddCursorMemberKeyInput(_message.Message):
    __slots__ = ("account_id", "api_key", "label")
    ACCOUNT_ID_FIELD_NUMBER: _ClassVar[int]
    API_KEY_FIELD_NUMBER: _ClassVar[int]
    LABEL_FIELD_NUMBER: _ClassVar[int]
    account_id: str
    api_key: str
    label: str
    def __init__(self, account_id: _Optional[str] = ..., api_key: _Optional[str] = ..., label: _Optional[str] = ...) -> None: ...

class RemoveCursorMemberKeyInput(_message.Message):
    __slots__ = ("account_id", "key_id", "force")
    ACCOUNT_ID_FIELD_NUMBER: _ClassVar[int]
    KEY_ID_FIELD_NUMBER: _ClassVar[int]
    FORCE_FIELD_NUMBER: _ClassVar[int]
    account_id: str
    key_id: str
    force: bool
    def __init__(self, account_id: _Optional[str] = ..., key_id: _Optional[str] = ..., force: bool = ...) -> None: ...

class SetCursorMemberKeyEnabledInput(_message.Message):
    __slots__ = ("account_id", "key_id", "enabled")
    ACCOUNT_ID_FIELD_NUMBER: _ClassVar[int]
    KEY_ID_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    account_id: str
    key_id: str
    enabled: bool
    def __init__(self, account_id: _Optional[str] = ..., key_id: _Optional[str] = ..., enabled: bool = ...) -> None: ...

class SyncCursorAccountInput(_message.Message):
    __slots__ = ("account_id",)
    ACCOUNT_ID_FIELD_NUMBER: _ClassVar[int]
    account_id: str
    def __init__(self, account_id: _Optional[str] = ...) -> None: ...

class ListCursorAccountsInput(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class CursorAccountSummary(_message.Message):
    __slots__ = ("account", "enabled_key_count", "last_synced_at")
    ACCOUNT_FIELD_NUMBER: _ClassVar[int]
    ENABLED_KEY_COUNT_FIELD_NUMBER: _ClassVar[int]
    LAST_SYNCED_AT_FIELD_NUMBER: _ClassVar[int]
    account: _cursor_account_pb2.CursorAccount
    enabled_key_count: int
    last_synced_at: _timestamp_pb2.Timestamp
    def __init__(self, account: _Optional[_Union[_cursor_account_pb2.CursorAccount, _Mapping]] = ..., enabled_key_count: _Optional[int] = ..., last_synced_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class CursorAccountsResponse(_message.Message):
    __slots__ = ("accounts",)
    ACCOUNTS_FIELD_NUMBER: _ClassVar[int]
    accounts: _containers.RepeatedCompositeFieldContainer[CursorAccountSummary]
    def __init__(self, accounts: _Optional[_Iterable[_Union[CursorAccountSummary, _Mapping]]] = ...) -> None: ...

class GetCursorAccountViewInput(_message.Message):
    __slots__ = ("account_id",)
    ACCOUNT_ID_FIELD_NUMBER: _ClassVar[int]
    account_id: str
    def __init__(self, account_id: _Optional[str] = ...) -> None: ...

class CursorMemberKeyView(_message.Message):
    __slots__ = ("key", "state", "spend")
    KEY_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    SPEND_FIELD_NUMBER: _ClassVar[int]
    key: _cursor_account_pb2.CursorMemberKey
    state: CursorMemberKeyState
    spend: _cursor_account_pb2.CursorMemberSpend
    def __init__(self, key: _Optional[_Union[_cursor_account_pb2.CursorMemberKey, _Mapping]] = ..., state: _Optional[_Union[CursorMemberKeyState, str]] = ..., spend: _Optional[_Union[_cursor_account_pb2.CursorMemberSpend, _Mapping]] = ...) -> None: ...

class CursorAccountView(_message.Message):
    __slots__ = ("account", "snapshot", "key_views", "members_without_keys")
    ACCOUNT_FIELD_NUMBER: _ClassVar[int]
    SNAPSHOT_FIELD_NUMBER: _ClassVar[int]
    KEY_VIEWS_FIELD_NUMBER: _ClassVar[int]
    MEMBERS_WITHOUT_KEYS_FIELD_NUMBER: _ClassVar[int]
    account: _cursor_account_pb2.CursorAccount
    snapshot: _cursor_account_pb2.CursorAccountSyncSnapshot
    key_views: _containers.RepeatedCompositeFieldContainer[CursorMemberKeyView]
    members_without_keys: _containers.RepeatedCompositeFieldContainer[_cursor_account_pb2.CursorTeamMember]
    def __init__(self, account: _Optional[_Union[_cursor_account_pb2.CursorAccount, _Mapping]] = ..., snapshot: _Optional[_Union[_cursor_account_pb2.CursorAccountSyncSnapshot, _Mapping]] = ..., key_views: _Optional[_Iterable[_Union[CursorMemberKeyView, _Mapping]]] = ..., members_without_keys: _Optional[_Iterable[_Union[_cursor_account_pb2.CursorTeamMember, _Mapping]]] = ...) -> None: ...
