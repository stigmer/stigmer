from ai.stigmer.agentic.session.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class EvalRunAblation(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    eval_run_ablation_unspecified: _ClassVar[EvalRunAblation]
    eval_run_ablation_with_without: _ClassVar[EvalRunAblation]
    eval_run_ablation_none: _ClassVar[EvalRunAblation]
eval_run_ablation_unspecified: EvalRunAblation
eval_run_ablation_with_without: EvalRunAblation
eval_run_ablation_none: EvalRunAblation

class EvalRunSpec(_message.Message):
    __slots__ = ("agent_id", "plugin_id", "agent_version", "plugin_digest", "compared_plugin_id", "cases", "targets", "runs", "ablation", "threshold", "case_glob", "case_tags", "judge_model", "max_cost_usd", "concurrency", "allow_tools", "real_mcp_servers", "vaults", "skip_scaffold", "allow_real_servers")
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    PLUGIN_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_VERSION_FIELD_NUMBER: _ClassVar[int]
    PLUGIN_DIGEST_FIELD_NUMBER: _ClassVar[int]
    COMPARED_PLUGIN_ID_FIELD_NUMBER: _ClassVar[int]
    CASES_FIELD_NUMBER: _ClassVar[int]
    TARGETS_FIELD_NUMBER: _ClassVar[int]
    RUNS_FIELD_NUMBER: _ClassVar[int]
    ABLATION_FIELD_NUMBER: _ClassVar[int]
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
    plugin_id: str
    agent_version: str
    plugin_digest: str
    compared_plugin_id: str
    cases: _containers.RepeatedCompositeFieldContainer[EvalRunCaseSource]
    targets: _containers.RepeatedCompositeFieldContainer[EvalRunTarget]
    runs: int
    ablation: EvalRunAblation
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
    def __init__(self, agent_id: _Optional[str] = ..., plugin_id: _Optional[str] = ..., agent_version: _Optional[str] = ..., plugin_digest: _Optional[str] = ..., compared_plugin_id: _Optional[str] = ..., cases: _Optional[_Iterable[_Union[EvalRunCaseSource, _Mapping]]] = ..., targets: _Optional[_Iterable[_Union[EvalRunTarget, _Mapping]]] = ..., runs: _Optional[int] = ..., ablation: _Optional[_Union[EvalRunAblation, str]] = ..., threshold: _Optional[float] = ..., case_glob: _Optional[str] = ..., case_tags: _Optional[_Iterable[str]] = ..., judge_model: _Optional[str] = ..., max_cost_usd: _Optional[float] = ..., concurrency: _Optional[int] = ..., allow_tools: _Optional[_Iterable[str]] = ..., real_mcp_servers: bool = ..., vaults: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ..., skip_scaffold: bool = ..., allow_real_servers: bool = ...) -> None: ...

class EvalRunCaseSource(_message.Message):
    __slots__ = ("plugin", "eval")
    PLUGIN_FIELD_NUMBER: _ClassVar[int]
    EVAL_FIELD_NUMBER: _ClassVar[int]
    plugin: _io_pb2.ApiResourceReference
    eval: _io_pb2.ApiResourceReference
    def __init__(self, plugin: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., eval: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ...) -> None: ...

class EvalRunTarget(_message.Message):
    __slots__ = ("harness", "model_name")
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    MODEL_NAME_FIELD_NUMBER: _ClassVar[int]
    harness: _enum_pb2.Harness
    model_name: str
    def __init__(self, harness: _Optional[_Union[_enum_pb2.Harness, str]] = ..., model_name: _Optional[str] = ...) -> None: ...
