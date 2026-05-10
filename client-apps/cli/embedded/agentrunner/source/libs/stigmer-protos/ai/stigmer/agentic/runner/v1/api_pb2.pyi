import datetime

from ai.stigmer.agentic.runner.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.runner.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.commons.apiresource import metadata_pb2 as _metadata_pb2
from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Runner(_message.Message):
    __slots__ = ("api_version", "kind", "metadata", "spec", "status")
    API_VERSION_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    SPEC_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    api_version: str
    kind: str
    metadata: _metadata_pb2.ApiResourceMetadata
    spec: _spec_pb2.RunnerSpec
    status: RunnerStatus
    def __init__(self, api_version: _Optional[str] = ..., kind: _Optional[str] = ..., metadata: _Optional[_Union[_metadata_pb2.ApiResourceMetadata, _Mapping]] = ..., spec: _Optional[_Union[_spec_pb2.RunnerSpec, _Mapping]] = ..., status: _Optional[_Union[RunnerStatus, _Mapping]] = ...) -> None: ...

class RunnerStatus(_message.Message):
    __slots__ = ("audit", "phase", "task_queue", "last_heartbeat_at", "started_at", "stopped_at", "current_executions", "connection_info")
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    PHASE_FIELD_NUMBER: _ClassVar[int]
    TASK_QUEUE_FIELD_NUMBER: _ClassVar[int]
    LAST_HEARTBEAT_AT_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    STOPPED_AT_FIELD_NUMBER: _ClassVar[int]
    CURRENT_EXECUTIONS_FIELD_NUMBER: _ClassVar[int]
    CONNECTION_INFO_FIELD_NUMBER: _ClassVar[int]
    audit: _status_pb2.ApiResourceAudit
    phase: _enum_pb2.RunnerPhase
    task_queue: str
    last_heartbeat_at: _timestamp_pb2.Timestamp
    started_at: _timestamp_pb2.Timestamp
    stopped_at: _timestamp_pb2.Timestamp
    current_executions: int
    connection_info: RunnerConnectionInfo
    def __init__(self, audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ..., phase: _Optional[_Union[_enum_pb2.RunnerPhase, str]] = ..., task_queue: _Optional[str] = ..., last_heartbeat_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., started_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., stopped_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., current_executions: _Optional[int] = ..., connection_info: _Optional[_Union[RunnerConnectionInfo, _Mapping]] = ...) -> None: ...

class RunnerConnectionInfo(_message.Message):
    __slots__ = ("hostname", "os", "arch", "runner_version", "machine_id")
    HOSTNAME_FIELD_NUMBER: _ClassVar[int]
    OS_FIELD_NUMBER: _ClassVar[int]
    ARCH_FIELD_NUMBER: _ClassVar[int]
    RUNNER_VERSION_FIELD_NUMBER: _ClassVar[int]
    MACHINE_ID_FIELD_NUMBER: _ClassVar[int]
    hostname: str
    os: str
    arch: str
    runner_version: str
    machine_id: str
    def __init__(self, hostname: _Optional[str] = ..., os: _Optional[str] = ..., arch: _Optional[str] = ..., runner_version: _Optional[str] = ..., machine_id: _Optional[str] = ...) -> None: ...
