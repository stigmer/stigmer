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

class PluginEvalAblation(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    plugin_eval_ablation_unspecified: _ClassVar[PluginEvalAblation]
    plugin_eval_ablation_with_without: _ClassVar[PluginEvalAblation]
    plugin_eval_ablation_none: _ClassVar[PluginEvalAblation]
plugin_eval_ablation_unspecified: PluginEvalAblation
plugin_eval_ablation_with_without: PluginEvalAblation
plugin_eval_ablation_none: PluginEvalAblation

class PluginEvalSpec(_message.Message):
    __slots__ = ("plugin_id", "plugin_digest", "targets", "runs", "ablation", "threshold", "case_glob", "case_tags", "judge_model", "max_cost_usd", "concurrency", "allow_tools", "real_mcp_servers", "vaults")
    PLUGIN_ID_FIELD_NUMBER: _ClassVar[int]
    PLUGIN_DIGEST_FIELD_NUMBER: _ClassVar[int]
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
    plugin_id: str
    plugin_digest: str
    targets: _containers.RepeatedCompositeFieldContainer[PluginEvalTarget]
    runs: int
    ablation: PluginEvalAblation
    threshold: float
    case_glob: str
    case_tags: _containers.RepeatedScalarFieldContainer[str]
    judge_model: str
    max_cost_usd: float
    concurrency: int
    allow_tools: _containers.RepeatedScalarFieldContainer[str]
    real_mcp_servers: bool
    vaults: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    def __init__(self, plugin_id: _Optional[str] = ..., plugin_digest: _Optional[str] = ..., targets: _Optional[_Iterable[_Union[PluginEvalTarget, _Mapping]]] = ..., runs: _Optional[int] = ..., ablation: _Optional[_Union[PluginEvalAblation, str]] = ..., threshold: _Optional[float] = ..., case_glob: _Optional[str] = ..., case_tags: _Optional[_Iterable[str]] = ..., judge_model: _Optional[str] = ..., max_cost_usd: _Optional[float] = ..., concurrency: _Optional[int] = ..., allow_tools: _Optional[_Iterable[str]] = ..., real_mcp_servers: bool = ..., vaults: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ...) -> None: ...

class PluginEvalTarget(_message.Message):
    __slots__ = ("harness", "model_name")
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    MODEL_NAME_FIELD_NUMBER: _ClassVar[int]
    harness: _enum_pb2.Harness
    model_name: str
    def __init__(self, harness: _Optional[_Union[_enum_pb2.Harness, str]] = ..., model_name: _Optional[str] = ...) -> None: ...
