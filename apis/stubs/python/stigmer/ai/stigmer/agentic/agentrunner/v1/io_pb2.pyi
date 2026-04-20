from ai.stigmer.agentic.agentrunner.v1 import api_pb2 as _api_pb2
from ai.stigmer.agentic.agentrunner.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.commons.rpc import pagination_pb2 as _pagination_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentRunnerId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class AgentRunnerHeartbeatInput(_message.Message):
    __slots__ = ("agent_runner_id", "phase", "current_executions", "connection_info")
    AGENT_RUNNER_ID_FIELD_NUMBER: _ClassVar[int]
    PHASE_FIELD_NUMBER: _ClassVar[int]
    CURRENT_EXECUTIONS_FIELD_NUMBER: _ClassVar[int]
    CONNECTION_INFO_FIELD_NUMBER: _ClassVar[int]
    agent_runner_id: str
    phase: _enum_pb2.AgentRunnerPhase
    current_executions: int
    connection_info: _api_pb2.AgentRunnerConnectionInfo
    def __init__(self, agent_runner_id: _Optional[str] = ..., phase: _Optional[_Union[_enum_pb2.AgentRunnerPhase, str]] = ..., current_executions: _Optional[int] = ..., connection_info: _Optional[_Union[_api_pb2.AgentRunnerConnectionInfo, _Mapping]] = ...) -> None: ...

class ListAgentRunnersRequest(_message.Message):
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

class AgentRunnerList(_message.Message):
    __slots__ = ("total_count", "items")
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    total_count: int
    items: _containers.RepeatedCompositeFieldContainer[_api_pb2.AgentRunner]
    def __init__(self, total_count: _Optional[int] = ..., items: _Optional[_Iterable[_Union[_api_pb2.AgentRunner, _Mapping]]] = ...) -> None: ...
