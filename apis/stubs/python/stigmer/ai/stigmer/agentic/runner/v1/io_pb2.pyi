import datetime

from ai.stigmer.agentic.runner.v1 import api_pb2 as _api_pb2
from ai.stigmer.agentic.runner.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.commons.rpc import pagination_pb2 as _pagination_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class RunnerId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class ListRunnersRequest(_message.Message):
    __slots__ = ("org", "labels", "page_info")
    class LabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ORG_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    PAGE_INFO_FIELD_NUMBER: _ClassVar[int]
    org: str
    labels: _containers.ScalarMap[str, str]
    page_info: _pagination_pb2.PageInfo
    def __init__(self, org: _Optional[str] = ..., labels: _Optional[_Mapping[str, str]] = ..., page_info: _Optional[_Union[_pagination_pb2.PageInfo, _Mapping]] = ...) -> None: ...

class RunnerList(_message.Message):
    __slots__ = ("total_count", "items")
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    total_count: int
    items: _containers.RepeatedCompositeFieldContainer[_api_pb2.Runner]
    def __init__(self, total_count: _Optional[int] = ..., items: _Optional[_Iterable[_Union[_api_pb2.Runner, _Mapping]]] = ...) -> None: ...

class RunnerSendCommandInput(_message.Message):
    __slots__ = ("runner_id", "list_directory")
    RUNNER_ID_FIELD_NUMBER: _ClassVar[int]
    LIST_DIRECTORY_FIELD_NUMBER: _ClassVar[int]
    runner_id: str
    list_directory: ListDirectoryRequest
    def __init__(self, runner_id: _Optional[str] = ..., list_directory: _Optional[_Union[ListDirectoryRequest, _Mapping]] = ...) -> None: ...

class RunnerStreamClientMessage(_message.Message):
    __slots__ = ("heartbeat", "command_response")
    HEARTBEAT_FIELD_NUMBER: _ClassVar[int]
    COMMAND_RESPONSE_FIELD_NUMBER: _ClassVar[int]
    heartbeat: RunnerHeartbeat
    command_response: RunnerCommandResponse
    def __init__(self, heartbeat: _Optional[_Union[RunnerHeartbeat, _Mapping]] = ..., command_response: _Optional[_Union[RunnerCommandResponse, _Mapping]] = ...) -> None: ...

class RunnerStreamServerMessage(_message.Message):
    __slots__ = ("command_request",)
    COMMAND_REQUEST_FIELD_NUMBER: _ClassVar[int]
    command_request: RunnerCommandRequest
    def __init__(self, command_request: _Optional[_Union[RunnerCommandRequest, _Mapping]] = ...) -> None: ...

class RunnerHeartbeat(_message.Message):
    __slots__ = ("runner_id", "phase", "current_executions", "connection_info")
    RUNNER_ID_FIELD_NUMBER: _ClassVar[int]
    PHASE_FIELD_NUMBER: _ClassVar[int]
    CURRENT_EXECUTIONS_FIELD_NUMBER: _ClassVar[int]
    CONNECTION_INFO_FIELD_NUMBER: _ClassVar[int]
    runner_id: str
    phase: _enum_pb2.RunnerPhase
    current_executions: int
    connection_info: _api_pb2.RunnerConnectionInfo
    def __init__(self, runner_id: _Optional[str] = ..., phase: _Optional[_Union[_enum_pb2.RunnerPhase, str]] = ..., current_executions: _Optional[int] = ..., connection_info: _Optional[_Union[_api_pb2.RunnerConnectionInfo, _Mapping]] = ...) -> None: ...

class RunnerCommandRequest(_message.Message):
    __slots__ = ("request_id", "list_directory")
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    LIST_DIRECTORY_FIELD_NUMBER: _ClassVar[int]
    request_id: str
    list_directory: ListDirectoryRequest
    def __init__(self, request_id: _Optional[str] = ..., list_directory: _Optional[_Union[ListDirectoryRequest, _Mapping]] = ...) -> None: ...

class RunnerCommandResponse(_message.Message):
    __slots__ = ("request_id", "list_directory", "error")
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    LIST_DIRECTORY_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    request_id: str
    list_directory: ListDirectoryResponse
    error: RunnerCommandError
    def __init__(self, request_id: _Optional[str] = ..., list_directory: _Optional[_Union[ListDirectoryResponse, _Mapping]] = ..., error: _Optional[_Union[RunnerCommandError, _Mapping]] = ...) -> None: ...

class ListDirectoryRequest(_message.Message):
    __slots__ = ("path",)
    PATH_FIELD_NUMBER: _ClassVar[int]
    path: str
    def __init__(self, path: _Optional[str] = ...) -> None: ...

class ListDirectoryResponse(_message.Message):
    __slots__ = ("resolved_path", "entries", "home_directory", "current_directory")
    RESOLVED_PATH_FIELD_NUMBER: _ClassVar[int]
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    HOME_DIRECTORY_FIELD_NUMBER: _ClassVar[int]
    CURRENT_DIRECTORY_FIELD_NUMBER: _ClassVar[int]
    resolved_path: str
    entries: _containers.RepeatedCompositeFieldContainer[DirectoryEntry]
    home_directory: str
    current_directory: str
    def __init__(self, resolved_path: _Optional[str] = ..., entries: _Optional[_Iterable[_Union[DirectoryEntry, _Mapping]]] = ..., home_directory: _Optional[str] = ..., current_directory: _Optional[str] = ...) -> None: ...

class DirectoryEntry(_message.Message):
    __slots__ = ("name", "is_directory", "is_hidden")
    NAME_FIELD_NUMBER: _ClassVar[int]
    IS_DIRECTORY_FIELD_NUMBER: _ClassVar[int]
    IS_HIDDEN_FIELD_NUMBER: _ClassVar[int]
    name: str
    is_directory: bool
    is_hidden: bool
    def __init__(self, name: _Optional[str] = ..., is_directory: bool = ..., is_hidden: bool = ...) -> None: ...

class RunnerCommandError(_message.Message):
    __slots__ = ("message",)
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    message: str
    def __init__(self, message: _Optional[str] = ...) -> None: ...

class CreateLaunchTokenRequest(_message.Message):
    __slots__ = ("org",)
    ORG_FIELD_NUMBER: _ClassVar[int]
    org: str
    def __init__(self, org: _Optional[str] = ...) -> None: ...

class CreateLaunchTokenResponse(_message.Message):
    __slots__ = ("token", "expires_at")
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    token: str
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, token: _Optional[str] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ExchangeLaunchTokenRequest(_message.Message):
    __slots__ = ("token",)
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    token: str
    def __init__(self, token: _Optional[str] = ...) -> None: ...

class ExchangeLaunchTokenResponse(_message.Message):
    __slots__ = ("access_token", "token_type", "expires_in", "org")
    ACCESS_TOKEN_FIELD_NUMBER: _ClassVar[int]
    TOKEN_TYPE_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_IN_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    access_token: str
    token_type: str
    expires_in: int
    org: str
    def __init__(self, access_token: _Optional[str] = ..., token_type: _Optional[str] = ..., expires_in: _Optional[int] = ..., org: _Optional[str] = ...) -> None: ...
