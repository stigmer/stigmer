from ai.stigmer.agentic.plugineval.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentEvalSpec(_message.Message):
    __slots__ = ("agent_id", "agent_version", "plugins", "targets", "runs", "threshold", "case_glob", "case_tags", "judge_model", "max_cost_usd", "concurrency", "allow_tools", "real_mcp_servers", "vaults", "skip_scaffold", "allow_real_servers")
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_VERSION_FIELD_NUMBER: _ClassVar[int]
    PLUGINS_FIELD_NUMBER: _ClassVar[int]
    TARGETS_FIELD_NUMBER: _ClassVar[int]
    RUNS_FIELD_NUMBER: _ClassVar[int]
    THRESHOLD_FIELD_NUMBER: _ClassVar[int]
    CASE_GLOB_FIELD_NUMBER: _ClassVar[int]
    CASE_TAGS_FIELD_NUMBER: _ClassVar[int]
    JUDGE_MODEL_FIELD_NUMBER: _ClassVar[int]
    MAX_COST_USD_FIELD_NUMBER: _ClassVar[int]
    CONCURRENCY_FIELD_NUMBER: _ClassVar[int]
    ALLOW_TOOLS_FIELD_NUMBER: _ClassVar[int]
    REAL_MCP_SERVERS_FIELD_NUMBER: _ClassVar[int]
    VAULTS_FIELD_NUMBER: _ClassVar[int]
    SKIP_SCAFFOLD_FIELD_NUMBER: _ClassVar[int]
    ALLOW_REAL_SERVERS_FIELD_NUMBER: _ClassVar[int]
    agent_id: str
    agent_version: str
    plugins: _containers.RepeatedScalarFieldContainer[str]
    targets: _containers.RepeatedCompositeFieldContainer[_spec_pb2.PluginEvalTarget]
    runs: int
    threshold: float
    case_glob: str
    case_tags: _containers.RepeatedScalarFieldContainer[str]
    judge_model: str
    max_cost_usd: float
    concurrency: int
    allow_tools: _containers.RepeatedScalarFieldContainer[str]
    real_mcp_servers: bool
    vaults: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    skip_scaffold: bool
    allow_real_servers: bool
    def __init__(self, agent_id: _Optional[str] = ..., agent_version: _Optional[str] = ..., plugins: _Optional[_Iterable[str]] = ..., targets: _Optional[_Iterable[_Union[_spec_pb2.PluginEvalTarget, _Mapping]]] = ..., runs: _Optional[int] = ..., threshold: _Optional[float] = ..., case_glob: _Optional[str] = ..., case_tags: _Optional[_Iterable[str]] = ..., judge_model: _Optional[str] = ..., max_cost_usd: _Optional[float] = ..., concurrency: _Optional[int] = ..., allow_tools: _Optional[_Iterable[str]] = ..., real_mcp_servers: bool = ..., vaults: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ..., skip_scaffold: bool = ..., allow_real_servers: bool = ...) -> None: ...
