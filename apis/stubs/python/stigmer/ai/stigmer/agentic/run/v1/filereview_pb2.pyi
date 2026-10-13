from ai.stigmer.agentic.run.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.run.v1 import message_pb2 as _message_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class FileChangeSet(_message.Message):
    __slots__ = ("id", "turn_id", "harness_id", "baseline_snapshot", "candidate_snapshot", "changes", "aggregate_digest", "diff_completeness", "command_provenance")
    ID_FIELD_NUMBER: _ClassVar[int]
    TURN_ID_FIELD_NUMBER: _ClassVar[int]
    HARNESS_ID_FIELD_NUMBER: _ClassVar[int]
    BASELINE_SNAPSHOT_FIELD_NUMBER: _ClassVar[int]
    CANDIDATE_SNAPSHOT_FIELD_NUMBER: _ClassVar[int]
    CHANGES_FIELD_NUMBER: _ClassVar[int]
    AGGREGATE_DIGEST_FIELD_NUMBER: _ClassVar[int]
    DIFF_COMPLETENESS_FIELD_NUMBER: _ClassVar[int]
    COMMAND_PROVENANCE_FIELD_NUMBER: _ClassVar[int]
    id: str
    turn_id: str
    harness_id: str
    baseline_snapshot: SnapshotRef
    candidate_snapshot: SnapshotRef
    changes: _containers.RepeatedCompositeFieldContainer[CapturedFileChange]
    aggregate_digest: str
    diff_completeness: _enum_pb2.DiffCompleteness
    command_provenance: TurnCommandProvenance
    def __init__(self, id: _Optional[str] = ..., turn_id: _Optional[str] = ..., harness_id: _Optional[str] = ..., baseline_snapshot: _Optional[_Union[SnapshotRef, _Mapping]] = ..., candidate_snapshot: _Optional[_Union[SnapshotRef, _Mapping]] = ..., changes: _Optional[_Iterable[_Union[CapturedFileChange, _Mapping]]] = ..., aggregate_digest: _Optional[str] = ..., diff_completeness: _Optional[_Union[_enum_pb2.DiffCompleteness, str]] = ..., command_provenance: _Optional[_Union[TurnCommandProvenance, _Mapping]] = ...) -> None: ...

class CapturedFileChange(_message.Message):
    __slots__ = ("id", "path_before", "path_after", "kind", "capture_class", "before", "after", "before_sha256", "after_sha256", "unified_diff", "diff_complete", "file_digest", "blocked_reason", "lines_added", "lines_removed")
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
    LINES_ADDED_FIELD_NUMBER: _ClassVar[int]
    LINES_REMOVED_FIELD_NUMBER: _ClassVar[int]
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
    lines_added: int
    lines_removed: int
    def __init__(self, id: _Optional[str] = ..., path_before: _Optional[str] = ..., path_after: _Optional[str] = ..., kind: _Optional[_Union[_enum_pb2.FileChangeKind, str]] = ..., capture_class: _Optional[_Union[_enum_pb2.FileCaptureClass, str]] = ..., before: _Optional[_Union[_message_pb2.FileContent, _Mapping]] = ..., after: _Optional[_Union[_message_pb2.FileContent, _Mapping]] = ..., before_sha256: _Optional[str] = ..., after_sha256: _Optional[str] = ..., unified_diff: _Optional[_Union[_message_pb2.ToolCallOutputRef, _Mapping]] = ..., diff_complete: bool = ..., file_digest: _Optional[str] = ..., blocked_reason: _Optional[_Union[_enum_pb2.FileReviewBlockReason, str]] = ..., lines_added: _Optional[int] = ..., lines_removed: _Optional[int] = ...) -> None: ...

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

class TurnCommandProvenance(_message.Message):
    __slots__ = ("consent_tool_call_ids", "authorized_by_auto_approve_all")
    CONSENT_TOOL_CALL_IDS_FIELD_NUMBER: _ClassVar[int]
    AUTHORIZED_BY_AUTO_APPROVE_ALL_FIELD_NUMBER: _ClassVar[int]
    consent_tool_call_ids: _containers.RepeatedScalarFieldContainer[str]
    authorized_by_auto_approve_all: bool
    def __init__(self, consent_tool_call_ids: _Optional[_Iterable[str]] = ..., authorized_by_auto_approve_all: bool = ...) -> None: ...

class FileChangeProgress(_message.Message):
    __slots__ = ("change_set_id", "files_changed", "lines_added", "lines_removed", "entries", "captured_at")
    CHANGE_SET_ID_FIELD_NUMBER: _ClassVar[int]
    FILES_CHANGED_FIELD_NUMBER: _ClassVar[int]
    LINES_ADDED_FIELD_NUMBER: _ClassVar[int]
    LINES_REMOVED_FIELD_NUMBER: _ClassVar[int]
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    CAPTURED_AT_FIELD_NUMBER: _ClassVar[int]
    change_set_id: str
    files_changed: int
    lines_added: int
    lines_removed: int
    entries: _containers.RepeatedCompositeFieldContainer[FileChangeProgressEntry]
    captured_at: str
    def __init__(self, change_set_id: _Optional[str] = ..., files_changed: _Optional[int] = ..., lines_added: _Optional[int] = ..., lines_removed: _Optional[int] = ..., entries: _Optional[_Iterable[_Union[FileChangeProgressEntry, _Mapping]]] = ..., captured_at: _Optional[str] = ...) -> None: ...

class FileChangeProgressEntry(_message.Message):
    __slots__ = ("path_before", "path_after", "kind", "lines_added", "lines_removed")
    PATH_BEFORE_FIELD_NUMBER: _ClassVar[int]
    PATH_AFTER_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    LINES_ADDED_FIELD_NUMBER: _ClassVar[int]
    LINES_REMOVED_FIELD_NUMBER: _ClassVar[int]
    path_before: str
    path_after: str
    kind: _enum_pb2.FileChangeKind
    lines_added: int
    lines_removed: int
    def __init__(self, path_before: _Optional[str] = ..., path_after: _Optional[str] = ..., kind: _Optional[_Union[_enum_pb2.FileChangeKind, str]] = ..., lines_added: _Optional[int] = ..., lines_removed: _Optional[int] = ...) -> None: ...
