from ai.stigmer.agentic.agentexecution.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.agentexecution.v1 import message_pb2 as _message_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class FileChangeSet(_message.Message):
    __slots__ = ("id", "turn_id", "harness_id", "status", "baseline_snapshot", "candidate_snapshot", "approved_snapshot", "changes", "aggregate_digest", "diff_completeness", "decisions")
    ID_FIELD_NUMBER: _ClassVar[int]
    TURN_ID_FIELD_NUMBER: _ClassVar[int]
    HARNESS_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    BASELINE_SNAPSHOT_FIELD_NUMBER: _ClassVar[int]
    CANDIDATE_SNAPSHOT_FIELD_NUMBER: _ClassVar[int]
    APPROVED_SNAPSHOT_FIELD_NUMBER: _ClassVar[int]
    CHANGES_FIELD_NUMBER: _ClassVar[int]
    AGGREGATE_DIGEST_FIELD_NUMBER: _ClassVar[int]
    DIFF_COMPLETENESS_FIELD_NUMBER: _ClassVar[int]
    DECISIONS_FIELD_NUMBER: _ClassVar[int]
    id: str
    turn_id: str
    harness_id: str
    status: _enum_pb2.FileChangeSetStatus
    baseline_snapshot: SnapshotRef
    candidate_snapshot: SnapshotRef
    approved_snapshot: SnapshotRef
    changes: _containers.RepeatedCompositeFieldContainer[CapturedFileChange]
    aggregate_digest: str
    diff_completeness: _enum_pb2.DiffCompleteness
    decisions: _containers.RepeatedCompositeFieldContainer[FileDecision]
    def __init__(self, id: _Optional[str] = ..., turn_id: _Optional[str] = ..., harness_id: _Optional[str] = ..., status: _Optional[_Union[_enum_pb2.FileChangeSetStatus, str]] = ..., baseline_snapshot: _Optional[_Union[SnapshotRef, _Mapping]] = ..., candidate_snapshot: _Optional[_Union[SnapshotRef, _Mapping]] = ..., approved_snapshot: _Optional[_Union[SnapshotRef, _Mapping]] = ..., changes: _Optional[_Iterable[_Union[CapturedFileChange, _Mapping]]] = ..., aggregate_digest: _Optional[str] = ..., diff_completeness: _Optional[_Union[_enum_pb2.DiffCompleteness, str]] = ..., decisions: _Optional[_Iterable[_Union[FileDecision, _Mapping]]] = ...) -> None: ...

class CapturedFileChange(_message.Message):
    __slots__ = ("id", "path_before", "path_after", "kind", "capture_class", "before", "after", "before_sha256", "after_sha256", "unified_diff", "diff_complete", "file_digest", "blocked_reason")
    ID_FIELD_NUMBER: _ClassVar[int]
    PATH_BEFORE_FIELD_NUMBER: _ClassVar[int]
    PATH_AFTER_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    CAPTURE_CLASS_FIELD_NUMBER: _ClassVar[int]
    BEFORE_FIELD_NUMBER: _ClassVar[int]
    AFTER_FIELD_NUMBER: _ClassVar[int]
    BEFORE_SHA256_FIELD_NUMBER: _ClassVar[int]
    AFTER_SHA256_FIELD_NUMBER: _ClassVar[int]
    UNIFIED_DIFF_FIELD_NUMBER: _ClassVar[int]
    DIFF_COMPLETE_FIELD_NUMBER: _ClassVar[int]
    FILE_DIGEST_FIELD_NUMBER: _ClassVar[int]
    BLOCKED_REASON_FIELD_NUMBER: _ClassVar[int]
    id: str
    path_before: str
    path_after: str
    kind: _enum_pb2.FileChangeKind
    capture_class: _enum_pb2.FileCaptureClass
    before: _message_pb2.FileContent
    after: _message_pb2.FileContent
    before_sha256: str
    after_sha256: str
    unified_diff: _message_pb2.ToolCallOutputRef
    diff_complete: bool
    file_digest: str
    blocked_reason: _enum_pb2.FileReviewBlockReason
    def __init__(self, id: _Optional[str] = ..., path_before: _Optional[str] = ..., path_after: _Optional[str] = ..., kind: _Optional[_Union[_enum_pb2.FileChangeKind, str]] = ..., capture_class: _Optional[_Union[_enum_pb2.FileCaptureClass, str]] = ..., before: _Optional[_Union[_message_pb2.FileContent, _Mapping]] = ..., after: _Optional[_Union[_message_pb2.FileContent, _Mapping]] = ..., before_sha256: _Optional[str] = ..., after_sha256: _Optional[str] = ..., unified_diff: _Optional[_Union[_message_pb2.ToolCallOutputRef, _Mapping]] = ..., diff_complete: bool = ..., file_digest: _Optional[str] = ..., blocked_reason: _Optional[_Union[_enum_pb2.FileReviewBlockReason, str]] = ...) -> None: ...

class SnapshotRef(_message.Message):
    __slots__ = ("kind", "git", "cas")
    KIND_FIELD_NUMBER: _ClassVar[int]
    GIT_FIELD_NUMBER: _ClassVar[int]
    CAS_FIELD_NUMBER: _ClassVar[int]
    kind: _enum_pb2.SnapshotKind
    git: GitTreeRef
    cas: CasManifestRef
    def __init__(self, kind: _Optional[_Union[_enum_pb2.SnapshotKind, str]] = ..., git: _Optional[_Union[GitTreeRef, _Mapping]] = ..., cas: _Optional[_Union[CasManifestRef, _Mapping]] = ...) -> None: ...

class GitTreeRef(_message.Message):
    __slots__ = ("tree_oid", "ref")
    TREE_OID_FIELD_NUMBER: _ClassVar[int]
    REF_FIELD_NUMBER: _ClassVar[int]
    tree_oid: str
    ref: str
    def __init__(self, tree_oid: _Optional[str] = ..., ref: _Optional[str] = ...) -> None: ...

class CasManifestRef(_message.Message):
    __slots__ = ("manifest_digest", "artifact_uri")
    MANIFEST_DIGEST_FIELD_NUMBER: _ClassVar[int]
    ARTIFACT_URI_FIELD_NUMBER: _ClassVar[int]
    manifest_digest: str
    artifact_uri: str
    def __init__(self, manifest_digest: _Optional[str] = ..., artifact_uri: _Optional[str] = ...) -> None: ...

class FileDecision(_message.Message):
    __slots__ = ("id", "change_set_id", "scope", "file_change_id", "action", "expected_digest", "reviewer_id", "decided_at", "reason")
    ID_FIELD_NUMBER: _ClassVar[int]
    CHANGE_SET_ID_FIELD_NUMBER: _ClassVar[int]
    SCOPE_FIELD_NUMBER: _ClassVar[int]
    FILE_CHANGE_ID_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    EXPECTED_DIGEST_FIELD_NUMBER: _ClassVar[int]
    REVIEWER_ID_FIELD_NUMBER: _ClassVar[int]
    DECIDED_AT_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    id: str
    change_set_id: str
    scope: _enum_pb2.FileDecisionScope
    file_change_id: str
    action: _enum_pb2.FileDecisionAction
    expected_digest: str
    reviewer_id: str
    decided_at: str
    reason: str
    def __init__(self, id: _Optional[str] = ..., change_set_id: _Optional[str] = ..., scope: _Optional[_Union[_enum_pb2.FileDecisionScope, str]] = ..., file_change_id: _Optional[str] = ..., action: _Optional[_Union[_enum_pb2.FileDecisionAction, str]] = ..., expected_digest: _Optional[str] = ..., reviewer_id: _Optional[str] = ..., decided_at: _Optional[str] = ..., reason: _Optional[str] = ...) -> None: ...

class FileReviewBaselineCaptured(_message.Message):
    __slots__ = ("change_set_id", "turn_id", "harness_id", "baseline_snapshot")
    CHANGE_SET_ID_FIELD_NUMBER: _ClassVar[int]
    TURN_ID_FIELD_NUMBER: _ClassVar[int]
    HARNESS_ID_FIELD_NUMBER: _ClassVar[int]
    BASELINE_SNAPSHOT_FIELD_NUMBER: _ClassVar[int]
    change_set_id: str
    turn_id: str
    harness_id: str
    baseline_snapshot: SnapshotRef
    def __init__(self, change_set_id: _Optional[str] = ..., turn_id: _Optional[str] = ..., harness_id: _Optional[str] = ..., baseline_snapshot: _Optional[_Union[SnapshotRef, _Mapping]] = ...) -> None: ...

class FileReviewCandidateCaptured(_message.Message):
    __slots__ = ("change_set_id", "candidate_snapshot", "changes", "aggregate_digest", "diff_completeness")
    CHANGE_SET_ID_FIELD_NUMBER: _ClassVar[int]
    CANDIDATE_SNAPSHOT_FIELD_NUMBER: _ClassVar[int]
    CHANGES_FIELD_NUMBER: _ClassVar[int]
    AGGREGATE_DIGEST_FIELD_NUMBER: _ClassVar[int]
    DIFF_COMPLETENESS_FIELD_NUMBER: _ClassVar[int]
    change_set_id: str
    candidate_snapshot: SnapshotRef
    changes: _containers.RepeatedCompositeFieldContainer[CapturedFileChange]
    aggregate_digest: str
    diff_completeness: _enum_pb2.DiffCompleteness
    def __init__(self, change_set_id: _Optional[str] = ..., candidate_snapshot: _Optional[_Union[SnapshotRef, _Mapping]] = ..., changes: _Optional[_Iterable[_Union[CapturedFileChange, _Mapping]]] = ..., aggregate_digest: _Optional[str] = ..., diff_completeness: _Optional[_Union[_enum_pb2.DiffCompleteness, str]] = ...) -> None: ...

class FileReviewReconciled(_message.Message):
    __slots__ = ("change_set_id", "approved_snapshot")
    CHANGE_SET_ID_FIELD_NUMBER: _ClassVar[int]
    APPROVED_SNAPSHOT_FIELD_NUMBER: _ClassVar[int]
    change_set_id: str
    approved_snapshot: SnapshotRef
    def __init__(self, change_set_id: _Optional[str] = ..., approved_snapshot: _Optional[_Union[SnapshotRef, _Mapping]] = ...) -> None: ...

class FileReviewFailure(_message.Message):
    __slots__ = ("change_set_id", "kind", "detail")
    CHANGE_SET_ID_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    DETAIL_FIELD_NUMBER: _ClassVar[int]
    change_set_id: str
    kind: _enum_pb2.FileReviewFailureKind
    detail: str
    def __init__(self, change_set_id: _Optional[str] = ..., kind: _Optional[_Union[_enum_pb2.FileReviewFailureKind, str]] = ..., detail: _Optional[str] = ...) -> None: ...

class FileReviewEvent(_message.Message):
    __slots__ = ("event_id", "change_set_id", "event_type", "timestamp", "actor", "baseline_captured", "candidate_captured", "file_decided", "reconciled", "failed")
    EVENT_ID_FIELD_NUMBER: _ClassVar[int]
    CHANGE_SET_ID_FIELD_NUMBER: _ClassVar[int]
    EVENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    TIMESTAMP_FIELD_NUMBER: _ClassVar[int]
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    BASELINE_CAPTURED_FIELD_NUMBER: _ClassVar[int]
    CANDIDATE_CAPTURED_FIELD_NUMBER: _ClassVar[int]
    FILE_DECIDED_FIELD_NUMBER: _ClassVar[int]
    RECONCILED_FIELD_NUMBER: _ClassVar[int]
    FAILED_FIELD_NUMBER: _ClassVar[int]
    event_id: str
    change_set_id: str
    event_type: _enum_pb2.FileReviewEventType
    timestamp: str
    actor: str
    baseline_captured: FileReviewBaselineCaptured
    candidate_captured: FileReviewCandidateCaptured
    file_decided: FileDecision
    reconciled: FileReviewReconciled
    failed: FileReviewFailure
    def __init__(self, event_id: _Optional[str] = ..., change_set_id: _Optional[str] = ..., event_type: _Optional[_Union[_enum_pb2.FileReviewEventType, str]] = ..., timestamp: _Optional[str] = ..., actor: _Optional[str] = ..., baseline_captured: _Optional[_Union[FileReviewBaselineCaptured, _Mapping]] = ..., candidate_captured: _Optional[_Union[FileReviewCandidateCaptured, _Mapping]] = ..., file_decided: _Optional[_Union[FileDecision, _Mapping]] = ..., reconciled: _Optional[_Union[FileReviewReconciled, _Mapping]] = ..., failed: _Optional[_Union[FileReviewFailure, _Mapping]] = ...) -> None: ...

class FileReviewEventStream(_message.Message):
    __slots__ = ("execution_id", "events")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    EVENTS_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    events: _containers.RepeatedCompositeFieldContainer[FileReviewEvent]
    def __init__(self, execution_id: _Optional[str] = ..., events: _Optional[_Iterable[_Union[FileReviewEvent, _Mapping]]] = ...) -> None: ...
