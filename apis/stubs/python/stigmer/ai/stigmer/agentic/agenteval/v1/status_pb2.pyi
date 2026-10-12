import datetime

from ai.stigmer.agentic.plugineval.v1 import status_pb2 as _status_pb2
from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2_1
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentEvalStatus(_message.Message):
    __slots__ = ("phase", "partial_reason", "error", "agent_version_hash", "plugins", "aggregates", "cost_usd", "tries_total", "tries_finished", "started_at", "finished_at", "vault_attachers", "audit")
    class VaultAttachersEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    PHASE_FIELD_NUMBER: _ClassVar[int]
    PARTIAL_REASON_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    AGENT_VERSION_HASH_FIELD_NUMBER: _ClassVar[int]
    PLUGINS_FIELD_NUMBER: _ClassVar[int]
    AGGREGATES_FIELD_NUMBER: _ClassVar[int]
    COST_USD_FIELD_NUMBER: _ClassVar[int]
    TRIES_TOTAL_FIELD_NUMBER: _ClassVar[int]
    TRIES_FINISHED_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    FINISHED_AT_FIELD_NUMBER: _ClassVar[int]
    VAULT_ATTACHERS_FIELD_NUMBER: _ClassVar[int]
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    phase: _status_pb2.PluginEvalPhase
    partial_reason: _status_pb2.PluginEvalPartialReason
    error: str
    agent_version_hash: str
    plugins: _containers.RepeatedCompositeFieldContainer[AgentEvalPlugin]
    aggregates: _status_pb2.PluginEvalAggregates
    cost_usd: float
    tries_total: int
    tries_finished: int
    started_at: _timestamp_pb2.Timestamp
    finished_at: _timestamp_pb2.Timestamp
    vault_attachers: _containers.ScalarMap[str, str]
    audit: _status_pb2_1.ApiResourceAudit
    def __init__(self, phase: _Optional[_Union[_status_pb2.PluginEvalPhase, str]] = ..., partial_reason: _Optional[_Union[_status_pb2.PluginEvalPartialReason, str]] = ..., error: _Optional[str] = ..., agent_version_hash: _Optional[str] = ..., plugins: _Optional[_Iterable[_Union[AgentEvalPlugin, _Mapping]]] = ..., aggregates: _Optional[_Union[_status_pb2.PluginEvalAggregates, _Mapping]] = ..., cost_usd: _Optional[float] = ..., tries_total: _Optional[int] = ..., tries_finished: _Optional[int] = ..., started_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., finished_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., vault_attachers: _Optional[_Mapping[str, str]] = ..., audit: _Optional[_Union[_status_pb2_1.ApiResourceAudit, _Mapping]] = ...) -> None: ...

class AgentEvalPlugin(_message.Message):
    __slots__ = ("plugin_id", "plugin_slug", "plugin_digest", "not_run_reason", "cases", "aggregates")
    PLUGIN_ID_FIELD_NUMBER: _ClassVar[int]
    PLUGIN_SLUG_FIELD_NUMBER: _ClassVar[int]
    PLUGIN_DIGEST_FIELD_NUMBER: _ClassVar[int]
    NOT_RUN_REASON_FIELD_NUMBER: _ClassVar[int]
    CASES_FIELD_NUMBER: _ClassVar[int]
    AGGREGATES_FIELD_NUMBER: _ClassVar[int]
    plugin_id: str
    plugin_slug: str
    plugin_digest: str
    not_run_reason: str
    cases: _containers.RepeatedCompositeFieldContainer[_status_pb2.PluginEvalCase]
    aggregates: _status_pb2.PluginEvalAggregates
    def __init__(self, plugin_id: _Optional[str] = ..., plugin_slug: _Optional[str] = ..., plugin_digest: _Optional[str] = ..., not_run_reason: _Optional[str] = ..., cases: _Optional[_Iterable[_Union[_status_pb2.PluginEvalCase, _Mapping]]] = ..., aggregates: _Optional[_Union[_status_pb2.PluginEvalAggregates, _Mapping]] = ...) -> None: ...
