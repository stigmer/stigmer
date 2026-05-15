from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class WorkflowId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class GenerateWorkflowFromPromptInput(_message.Message):
    __slots__ = ("prompt", "org", "model", "task_kind_hints")
    PROMPT_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    TASK_KIND_HINTS_FIELD_NUMBER: _ClassVar[int]
    prompt: str
    org: str
    model: str
    task_kind_hints: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, prompt: _Optional[str] = ..., org: _Optional[str] = ..., model: _Optional[str] = ..., task_kind_hints: _Optional[_Iterable[str]] = ...) -> None: ...

class GenerateWorkflowFromPromptOutput(_message.Message):
    __slots__ = ("yaml", "explanation", "warnings", "model_used")
    YAML_FIELD_NUMBER: _ClassVar[int]
    EXPLANATION_FIELD_NUMBER: _ClassVar[int]
    WARNINGS_FIELD_NUMBER: _ClassVar[int]
    MODEL_USED_FIELD_NUMBER: _ClassVar[int]
    yaml: str
    explanation: str
    warnings: _containers.RepeatedScalarFieldContainer[str]
    model_used: str
    def __init__(self, yaml: _Optional[str] = ..., explanation: _Optional[str] = ..., warnings: _Optional[_Iterable[str]] = ..., model_used: _Optional[str] = ...) -> None: ...

class RefineWorkflowInput(_message.Message):
    __slots__ = ("current_yaml", "instruction", "org", "model")
    CURRENT_YAML_FIELD_NUMBER: _ClassVar[int]
    INSTRUCTION_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    current_yaml: str
    instruction: str
    org: str
    model: str
    def __init__(self, current_yaml: _Optional[str] = ..., instruction: _Optional[str] = ..., org: _Optional[str] = ..., model: _Optional[str] = ...) -> None: ...

class RefineWorkflowOutput(_message.Message):
    __slots__ = ("yaml", "explanation", "warnings", "model_used")
    YAML_FIELD_NUMBER: _ClassVar[int]
    EXPLANATION_FIELD_NUMBER: _ClassVar[int]
    WARNINGS_FIELD_NUMBER: _ClassVar[int]
    MODEL_USED_FIELD_NUMBER: _ClassVar[int]
    yaml: str
    explanation: str
    warnings: _containers.RepeatedScalarFieldContainer[str]
    model_used: str
    def __init__(self, yaml: _Optional[str] = ..., explanation: _Optional[str] = ..., warnings: _Optional[_Iterable[str]] = ..., model_used: _Optional[str] = ...) -> None: ...

class DiagnoseWorkflowExecutionInput(_message.Message):
    __slots__ = ("execution_id", "org", "model")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    org: str
    model: str
    def __init__(self, execution_id: _Optional[str] = ..., org: _Optional[str] = ..., model: _Optional[str] = ...) -> None: ...

class DiagnoseWorkflowExecutionOutput(_message.Message):
    __slots__ = ("diagnosis", "suggested_yaml", "fix_explanation", "warnings", "model_used")
    DIAGNOSIS_FIELD_NUMBER: _ClassVar[int]
    SUGGESTED_YAML_FIELD_NUMBER: _ClassVar[int]
    FIX_EXPLANATION_FIELD_NUMBER: _ClassVar[int]
    WARNINGS_FIELD_NUMBER: _ClassVar[int]
    MODEL_USED_FIELD_NUMBER: _ClassVar[int]
    diagnosis: str
    suggested_yaml: str
    fix_explanation: str
    warnings: _containers.RepeatedScalarFieldContainer[str]
    model_used: str
    def __init__(self, diagnosis: _Optional[str] = ..., suggested_yaml: _Optional[str] = ..., fix_explanation: _Optional[str] = ..., warnings: _Optional[_Iterable[str]] = ..., model_used: _Optional[str] = ...) -> None: ...
