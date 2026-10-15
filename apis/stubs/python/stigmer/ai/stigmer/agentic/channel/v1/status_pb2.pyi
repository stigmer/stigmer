import datetime

from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ChannelInstallState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    channel_install_state_unspecified: _ClassVar[ChannelInstallState]
    pending_install: _ClassVar[ChannelInstallState]
    installed: _ClassVar[ChannelInstallState]
    revoked: _ClassVar[ChannelInstallState]
channel_install_state_unspecified: ChannelInstallState
pending_install: ChannelInstallState
installed: ChannelInstallState
revoked: ChannelInstallState

class ChannelStatus(_message.Message):
    __slots__ = ("vault_attachers", "install_state", "web", "slack", "whatsapp", "audit")
    class VaultAttachersEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    VAULT_ATTACHERS_FIELD_NUMBER: _ClassVar[int]
    INSTALL_STATE_FIELD_NUMBER: _ClassVar[int]
    WEB_FIELD_NUMBER: _ClassVar[int]
    SLACK_FIELD_NUMBER: _ClassVar[int]
    WHATSAPP_FIELD_NUMBER: _ClassVar[int]
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    vault_attachers: _containers.ScalarMap[str, str]
    install_state: ChannelInstallState
    web: WebChannelStatus
    slack: SlackInstallStatus
    whatsapp: WhatsAppInstallStatus
    audit: _status_pb2.ApiResourceAudit
    def __init__(self, vault_attachers: _Optional[_Mapping[str, str]] = ..., install_state: _Optional[_Union[ChannelInstallState, str]] = ..., web: _Optional[_Union[WebChannelStatus, _Mapping]] = ..., slack: _Optional[_Union[SlackInstallStatus, _Mapping]] = ..., whatsapp: _Optional[_Union[WhatsAppInstallStatus, _Mapping]] = ..., audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ...) -> None: ...

class WebChannelStatus(_message.Message):
    __slots__ = ("link_token",)
    LINK_TOKEN_FIELD_NUMBER: _ClassVar[int]
    link_token: str
    def __init__(self, link_token: _Optional[str] = ...) -> None: ...

class SlackInstallStatus(_message.Message):
    __slots__ = ("team_id", "team_name", "bot_user_id", "granted_scopes", "installer_slack_user_id", "installed_at", "channel_app_id")
    TEAM_ID_FIELD_NUMBER: _ClassVar[int]
    TEAM_NAME_FIELD_NUMBER: _ClassVar[int]
    BOT_USER_ID_FIELD_NUMBER: _ClassVar[int]
    GRANTED_SCOPES_FIELD_NUMBER: _ClassVar[int]
    INSTALLER_SLACK_USER_ID_FIELD_NUMBER: _ClassVar[int]
    INSTALLED_AT_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_APP_ID_FIELD_NUMBER: _ClassVar[int]
    team_id: str
    team_name: str
    bot_user_id: str
    granted_scopes: _containers.RepeatedScalarFieldContainer[str]
    installer_slack_user_id: str
    installed_at: _timestamp_pb2.Timestamp
    channel_app_id: str
    def __init__(self, team_id: _Optional[str] = ..., team_name: _Optional[str] = ..., bot_user_id: _Optional[str] = ..., granted_scopes: _Optional[_Iterable[str]] = ..., installer_slack_user_id: _Optional[str] = ..., installed_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., channel_app_id: _Optional[str] = ...) -> None: ...

class WhatsAppInstallStatus(_message.Message):
    __slots__ = ("phone_number_id", "display_phone_number", "verified_name", "channel_app_id", "installed_at")
    PHONE_NUMBER_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_PHONE_NUMBER_FIELD_NUMBER: _ClassVar[int]
    VERIFIED_NAME_FIELD_NUMBER: _ClassVar[int]
    CHANNEL_APP_ID_FIELD_NUMBER: _ClassVar[int]
    INSTALLED_AT_FIELD_NUMBER: _ClassVar[int]
    phone_number_id: str
    display_phone_number: str
    verified_name: str
    channel_app_id: str
    installed_at: _timestamp_pb2.Timestamp
    def __init__(self, phone_number_id: _Optional[str] = ..., display_phone_number: _Optional[str] = ..., verified_name: _Optional[str] = ..., channel_app_id: _Optional[str] = ..., installed_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...
