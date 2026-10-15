from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class EvalMockKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    eval_mock_kind_unspecified: _ClassVar[EvalMockKind]
    eval_mock_kind_fixed: _ClassVar[EvalMockKind]
    eval_mock_kind_agent: _ClassVar[EvalMockKind]
eval_mock_kind_unspecified: EvalMockKind
eval_mock_kind_fixed: EvalMockKind
eval_mock_kind_agent: EvalMockKind

class EvalCaseContext(_message.Message):
    __slots__ = ("plugin_id", "plugin_digest", "suite_dir", "case_dir", "scaffold_script", "add_dirs", "history_file", "env", "mocks", "agent_mock_model", "agent_mock_call_budget", "read_files", "plugin_name")
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
    READ_FILES_FIELD_NUMBER: _ClassVar[int]
    PLUGIN_NAME_FIELD_NUMBER: _ClassVar[int]
    plugin_id: str
    plugin_digest: str
    suite_dir: str
    case_dir: str
    scaffold_script: str
    add_dirs: _containers.RepeatedScalarFieldContainer[str]
    history_file: str
    env: _containers.ScalarMap[str, str]
    mocks: _containers.RepeatedCompositeFieldContainer[EvalMockServer]
    agent_mock_model: str
    agent_mock_call_budget: int
    read_files: _containers.RepeatedScalarFieldContainer[str]
    plugin_name: str
    def __init__(self, plugin_id: _Optional[str] = ..., plugin_digest: _Optional[str] = ..., suite_dir: _Optional[str] = ..., case_dir: _Optional[str] = ..., scaffold_script: _Optional[str] = ..., add_dirs: _Optional[_Iterable[str]] = ..., history_file: _Optional[str] = ..., env: _Optional[_Mapping[str, str]] = ..., mocks: _Optional[_Iterable[_Union[EvalMockServer, _Mapping]]] = ..., agent_mock_model: _Optional[str] = ..., agent_mock_call_budget: _Optional[int] = ..., read_files: _Optional[_Iterable[str]] = ..., plugin_name: _Optional[str] = ...) -> None: ...

class EvalFiles(_message.Message):
    __slots__ = ("files",)
    FILES_FIELD_NUMBER: _ClassVar[int]
    files: _containers.RepeatedCompositeFieldContainer[EvalFile]
    def __init__(self, files: _Optional[_Iterable[_Union[EvalFile, _Mapping]]] = ...) -> None: ...

class EvalFile(_message.Message):
    __slots__ = ("path", "text", "binary", "absent", "unreadable")
    PATH_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    BINARY_FIELD_NUMBER: _ClassVar[int]
    ABSENT_FIELD_NUMBER: _ClassVar[int]
    UNREADABLE_FIELD_NUMBER: _ClassVar[int]
    path: str
    text: str
    binary: bool
    absent: bool
    unreadable: str
    def __init__(self, path: _Optional[str] = ..., text: _Optional[str] = ..., binary: bool = ..., absent: bool = ..., unreadable: _Optional[str] = ...) -> None: ...

class EvalMockServer(_message.Message):
    __slots__ = ("server", "segment", "tools", "tools_file")
    SERVER_FIELD_NUMBER: _ClassVar[int]
    SEGMENT_FIELD_NUMBER: _ClassVar[int]
    TOOLS_FIELD_NUMBER: _ClassVar[int]
    TOOLS_FILE_FIELD_NUMBER: _ClassVar[int]
    server: str
    segment: str
    tools: _containers.RepeatedCompositeFieldContainer[EvalMockTool]
    tools_file: str
    def __init__(self, server: _Optional[str] = ..., segment: _Optional[str] = ..., tools: _Optional[_Iterable[_Union[EvalMockTool, _Mapping]]] = ..., tools_file: _Optional[str] = ...) -> None: ...

class EvalMockTool(_message.Message):
    __slots__ = ("tool", "file", "kind", "error", "expect_json", "abort_when")
    TOOL_FIELD_NUMBER: _ClassVar[int]
    FILE_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    EXPECT_JSON_FIELD_NUMBER: _ClassVar[int]
    ABORT_WHEN_FIELD_NUMBER: _ClassVar[int]
    tool: str
    file: str
    kind: EvalMockKind
    error: bool
    expect_json: str
    abort_when: str
    def __init__(self, tool: _Optional[str] = ..., file: _Optional[str] = ..., kind: _Optional[_Union[EvalMockKind, str]] = ..., error: bool = ..., expect_json: _Optional[str] = ..., abort_when: _Optional[str] = ...) -> None: ...
