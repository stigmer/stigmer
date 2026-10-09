from ai.stigmer.agentic.score.v1 import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ScoreSpec(_message.Message):
    __slots__ = ("run_id", "session_id", "metric", "source", "evaluator_version", "passed", "criteria", "comment")
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    METRIC_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    EVALUATOR_VERSION_FIELD_NUMBER: _ClassVar[int]
    PASSED_FIELD_NUMBER: _ClassVar[int]
    CRITERIA_FIELD_NUMBER: _ClassVar[int]
    COMMENT_FIELD_NUMBER: _ClassVar[int]
    run_id: str
    session_id: str
    metric: str
    source: _enum_pb2.ScoreSource
    evaluator_version: str
    passed: bool
    criteria: _containers.RepeatedCompositeFieldContainer[ScoreCriterion]
    comment: str
    def __init__(self, run_id: _Optional[str] = ..., session_id: _Optional[str] = ..., metric: _Optional[str] = ..., source: _Optional[_Union[_enum_pb2.ScoreSource, str]] = ..., evaluator_version: _Optional[str] = ..., passed: bool = ..., criteria: _Optional[_Iterable[_Union[ScoreCriterion, _Mapping]]] = ..., comment: _Optional[str] = ...) -> None: ...

class ScoreCriterion(_message.Message):
    __slots__ = ("name", "result", "reason")
    NAME_FIELD_NUMBER: _ClassVar[int]
    RESULT_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    name: str
    result: _enum_pb2.CriterionResult
    reason: str
    def __init__(self, name: _Optional[str] = ..., result: _Optional[_Union[_enum_pb2.CriterionResult, str]] = ..., reason: _Optional[str] = ...) -> None: ...
