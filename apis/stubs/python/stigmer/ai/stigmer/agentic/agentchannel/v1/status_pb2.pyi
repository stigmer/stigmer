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

class AgentChannelInstallState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    agent_channel_install_state_unspecified: _ClassVar[AgentChannelInstallState]
    pending_install: _ClassVar[AgentChannelInstallState]
    installed: _ClassVar[AgentChannelInstallState]
    revoked: _ClassVar[AgentChannelInstallState]
agent_channel_install_state_unspecified: AgentChannelInstallState
pending_install: AgentChannelInstallState
installed: AgentChannelInstallState
revoked: AgentChannelInstallState

class AgentChannelStatus(_message.Message):
    __slots__ = ("install_state", "slack", "credentials_environment_id", "audit")
    INSTALL_STATE_FIELD_NUMBER: _ClassVar[int]
    SLACK_FIELD_NUMBER: _ClassVar[int]
    CREDENTIALS_ENVIRONMENT_ID_FIELD_NUMBER: _ClassVar[int]
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    install_state: AgentChannelInstallState
    slack: SlackInstallStatus
    credentials_environment_id: str
    audit: _status_pb2.ApiResourceAudit
    def __init__(self, install_state: _Optional[_Union[AgentChannelInstallState, str]] = ..., slack: _Optional[_Union[SlackInstallStatus, _Mapping]] = ..., credentials_environment_id: _Optional[str] = ..., audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ...) -> None: ...

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
