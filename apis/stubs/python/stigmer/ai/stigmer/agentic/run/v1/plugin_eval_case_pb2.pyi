from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PluginEvalMockKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    plugin_eval_mock_kind_unspecified: _ClassVar[PluginEvalMockKind]
    plugin_eval_mock_kind_fixed: _ClassVar[PluginEvalMockKind]
    plugin_eval_mock_kind_agent: _ClassVar[PluginEvalMockKind]
plugin_eval_mock_kind_unspecified: PluginEvalMockKind
plugin_eval_mock_kind_fixed: PluginEvalMockKind
plugin_eval_mock_kind_agent: PluginEvalMockKind

class PluginEvalCaseContext(_message.Message):
    __slots__ = ("plugin_id", "plugin_digest", "suite_dir", "case_dir", "scaffold_script", "add_dirs", "history_file", "env", "mocks", "agent_mock_model", "agent_mock_call_budget")
    class EnvEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    PLUGIN_ID_FIELD_NUMBER: _ClassVar[int]
    PLUGIN_DIGEST_FIELD_NUMBER: _ClassVar[int]
    SUITE_DIR_FIELD_NUMBER: _ClassVar[int]
    CASE_DIR_FIELD_NUMBER: _ClassVar[int]
    SCAFFOLD_SCRIPT_FIELD_NUMBER: _ClassVar[int]
    ADD_DIRS_FIELD_NUMBER: _ClassVar[int]
    HISTORY_FILE_FIELD_NUMBER: _ClassVar[int]
    ENV_FIELD_NUMBER: _ClassVar[int]
    MOCKS_FIELD_NUMBER: _ClassVar[int]
    AGENT_MOCK_MODEL_FIELD_NUMBER: _ClassVar[int]
    AGENT_MOCK_CALL_BUDGET_FIELD_NUMBER: _ClassVar[int]
    plugin_id: str
    plugin_digest: str
    suite_dir: str
    case_dir: str
    scaffold_script: str
    add_dirs: _containers.RepeatedScalarFieldContainer[str]
    history_file: str
    env: _containers.ScalarMap[str, str]
    mocks: _containers.RepeatedCompositeFieldContainer[PluginEvalMockServer]
    agent_mock_model: str
    agent_mock_call_budget: int
    def __init__(self, plugin_id: _Optional[str] = ..., plugin_digest: _Optional[str] = ..., suite_dir: _Optional[str] = ..., case_dir: _Optional[str] = ..., scaffold_script: _Optional[str] = ..., add_dirs: _Optional[_Iterable[str]] = ..., history_file: _Optional[str] = ..., env: _Optional[_Mapping[str, str]] = ..., mocks: _Optional[_Iterable[_Union[PluginEvalMockServer, _Mapping]]] = ..., agent_mock_model: _Optional[str] = ..., agent_mock_call_budget: _Optional[int] = ...) -> None: ...

class PluginEvalMockServer(_message.Message):
    __slots__ = ("server", "segment", "tools", "tools_file")
    SERVER_FIELD_NUMBER: _ClassVar[int]
    SEGMENT_FIELD_NUMBER: _ClassVar[int]
    TOOLS_FIELD_NUMBER: _ClassVar[int]
    TOOLS_FILE_FIELD_NUMBER: _ClassVar[int]
    server: str
    segment: str
    tools: _containers.RepeatedCompositeFieldContainer[PluginEvalMockTool]
    tools_file: str
    def __init__(self, server: _Optional[str] = ..., segment: _Optional[str] = ..., tools: _Optional[_Iterable[_Union[PluginEvalMockTool, _Mapping]]] = ..., tools_file: _Optional[str] = ...) -> None: ...

class PluginEvalMockTool(_message.Message):
    __slots__ = ("tool", "file", "kind", "error", "expect_json", "abort_when")
    TOOL_FIELD_NUMBER: _ClassVar[int]
    FILE_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    EXPECT_JSON_FIELD_NUMBER: _ClassVar[int]
    ABORT_WHEN_FIELD_NUMBER: _ClassVar[int]
    tool: str
    file: str
    kind: PluginEvalMockKind
    error: bool
    expect_json: str
    abort_when: str
    def __init__(self, tool: _Optional[str] = ..., file: _Optional[str] = ..., kind: _Optional[_Union[PluginEvalMockKind, str]] = ..., error: bool = ..., expect_json: _Optional[str] = ..., abort_when: _Optional[str] = ...) -> None: ...
