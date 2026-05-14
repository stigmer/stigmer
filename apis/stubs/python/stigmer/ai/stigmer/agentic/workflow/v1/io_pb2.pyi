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
