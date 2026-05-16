from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class EvalFailPolicy(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    EVAL_FAIL_POLICY_UNSPECIFIED: _ClassVar[EvalFailPolicy]
    EVAL_FAIL_RAISE: _ClassVar[EvalFailPolicy]
    EVAL_FAIL_BRANCH: _ClassVar[EvalFailPolicy]
    EVAL_FAIL_WARN: _ClassVar[EvalFailPolicy]

class EvalScoringMode(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    EVAL_SCORING_MODE_UNSPECIFIED: _ClassVar[EvalScoringMode]
    EVAL_PASS_FAIL: _ClassVar[EvalScoringMode]
    EVAL_NUMERIC_SCORE: _ClassVar[EvalScoringMode]
    EVAL_MULTI_CRITERIA: _ClassVar[EvalScoringMode]
EVAL_FAIL_POLICY_UNSPECIFIED: EvalFailPolicy
EVAL_FAIL_RAISE: EvalFailPolicy
EVAL_FAIL_BRANCH: EvalFailPolicy
EVAL_FAIL_WARN: EvalFailPolicy
EVAL_SCORING_MODE_UNSPECIFIED: EvalScoringMode
EVAL_PASS_FAIL: EvalScoringMode
EVAL_NUMERIC_SCORE: EvalScoringMode
EVAL_MULTI_CRITERIA: EvalScoringMode

class EvalCriterion(_message.Message):
    __slots__ = ("name", "description", "weight")
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    WEIGHT_FIELD_NUMBER: _ClassVar[int]
    name: str
    description: str
    weight: float
    def __init__(self, name: _Optional[str] = ..., description: _Optional[str] = ..., weight: _Optional[float] = ...) -> None: ...

class EvalTaskConfig(_message.Message):
    __slots__ = ("model", "subject", "rubric", "scoring_mode", "threshold", "on_fail", "fallback_task", "system_prompt", "criteria", "max_cost_micros")
    MODEL_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_FIELD_NUMBER: _ClassVar[int]
    RUBRIC_FIELD_NUMBER: _ClassVar[int]
    SCORING_MODE_FIELD_NUMBER: _ClassVar[int]
    THRESHOLD_FIELD_NUMBER: _ClassVar[int]
    ON_FAIL_FIELD_NUMBER: _ClassVar[int]
    FALLBACK_TASK_FIELD_NUMBER: _ClassVar[int]
    SYSTEM_PROMPT_FIELD_NUMBER: _ClassVar[int]
    CRITERIA_FIELD_NUMBER: _ClassVar[int]
    MAX_COST_MICROS_FIELD_NUMBER: _ClassVar[int]
    model: str
    subject: str
    rubric: str
    scoring_mode: EvalScoringMode
    threshold: float
    on_fail: EvalFailPolicy
    fallback_task: str
    system_prompt: str
    criteria: _containers.RepeatedCompositeFieldContainer[EvalCriterion]
    max_cost_micros: int
    def __init__(self, model: _Optional[str] = ..., subject: _Optional[str] = ..., rubric: _Optional[str] = ..., scoring_mode: _Optional[_Union[EvalScoringMode, str]] = ..., threshold: _Optional[float] = ..., on_fail: _Optional[_Union[EvalFailPolicy, str]] = ..., fallback_task: _Optional[str] = ..., system_prompt: _Optional[str] = ..., criteria: _Optional[_Iterable[_Union[EvalCriterion, _Mapping]]] = ..., max_cost_micros: _Optional[int] = ...) -> None: ...
