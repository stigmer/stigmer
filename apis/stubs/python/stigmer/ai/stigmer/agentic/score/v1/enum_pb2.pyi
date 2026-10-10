from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class ScoreSource(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    score_source_unspecified: _ClassVar[ScoreSource]
    score_source_check: _ClassVar[ScoreSource]
    score_source_human: _ClassVar[ScoreSource]
    score_source_judge: _ClassVar[ScoreSource]
    score_source_eval: _ClassVar[ScoreSource]

class ScoreState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    score_state_unspecified: _ClassVar[ScoreState]
    score_state_graded: _ClassVar[ScoreState]
    score_state_not_graded: _ClassVar[ScoreState]
    score_state_pending: _ClassVar[ScoreState]

class CriterionResult(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    criterion_result_unspecified: _ClassVar[CriterionResult]
    criterion_result_passed: _ClassVar[CriterionResult]
    criterion_result_failed: _ClassVar[CriterionResult]
    criterion_result_not_applicable: _ClassVar[CriterionResult]
score_source_unspecified: ScoreSource
score_source_check: ScoreSource
score_source_human: ScoreSource
score_source_judge: ScoreSource
score_source_eval: ScoreSource
score_state_unspecified: ScoreState
score_state_graded: ScoreState
score_state_not_graded: ScoreState
score_state_pending: ScoreState
criterion_result_unspecified: CriterionResult
criterion_result_passed: CriterionResult
criterion_result_failed: CriterionResult
criterion_result_not_applicable: CriterionResult
