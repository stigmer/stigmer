from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class RunPhase(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    RUN_PHASE_UNSPECIFIED: _ClassVar[RunPhase]
    RUN_PENDING: _ClassVar[RunPhase]
    RUN_IN_PROGRESS: _ClassVar[RunPhase]
    RUN_COMPLETED: _ClassVar[RunPhase]
    RUN_FAILED: _ClassVar[RunPhase]
    RUN_CANCELLED: _ClassVar[RunPhase]
    RUN_TERMINATED: _ClassVar[RunPhase]
    RUN_WAITING_FOR_APPROVAL: _ClassVar[RunPhase]
    RUN_PAUSED: _ClassVar[RunPhase]

class RunControlSignal(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    RUN_CONTROL_SIGNAL_UNSPECIFIED: _ClassVar[RunControlSignal]
    RUN_CONTROL_SIGNAL_STOP: _ClassVar[RunControlSignal]
    RUN_CONTROL_SIGNAL_WARNING: _ClassVar[RunControlSignal]

class InteractionMode(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    INTERACTION_MODE_UNSPECIFIED: _ClassVar[InteractionMode]
    INTERACTION_MODE_AGENT: _ClassVar[InteractionMode]
    INTERACTION_MODE_PLAN: _ClassVar[InteractionMode]

class ApprovalMode(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    APPROVAL_MODE_UNSPECIFIED: _ClassVar[ApprovalMode]
    APPROVAL_MODE_INTERACTIVE: _ClassVar[ApprovalMode]
    APPROVAL_MODE_UNATTENDED: _ClassVar[ApprovalMode]

class ServiceTier(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SERVICE_TIER_UNSPECIFIED: _ClassVar[ServiceTier]
    SERVICE_TIER_STANDARD: _ClassVar[ServiceTier]
    SERVICE_TIER_FAST: _ClassVar[ServiceTier]

class ThinkingMode(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    THINKING_MODE_UNSPECIFIED: _ClassVar[ThinkingMode]
    THINKING_MODE_DISABLED: _ClassVar[ThinkingMode]
    THINKING_MODE_ENABLED: _ClassVar[ThinkingMode]

class FileChangeKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    FILE_CHANGE_KIND_UNSPECIFIED: _ClassVar[FileChangeKind]
    FILE_CHANGE_KIND_ADD: _ClassVar[FileChangeKind]
    FILE_CHANGE_KIND_MODIFY: _ClassVar[FileChangeKind]
    FILE_CHANGE_KIND_DELETE: _ClassVar[FileChangeKind]
    FILE_CHANGE_KIND_RENAME: _ClassVar[FileChangeKind]
    FILE_CHANGE_KIND_BINARY_CHANGE: _ClassVar[FileChangeKind]

class FileCaptureClass(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    FILE_CAPTURE_CLASS_UNSPECIFIED: _ClassVar[FileCaptureClass]
    FILE_CAPTURE_CLASS_GIT_TRACKED: _ClassVar[FileCaptureClass]
    FILE_CAPTURE_CLASS_GIT_UNTRACKED_CAPTURED: _ClassVar[FileCaptureClass]
    FILE_CAPTURE_CLASS_GIT_IGNORED_CAPTURED: _ClassVar[FileCaptureClass]
    FILE_CAPTURE_CLASS_NON_GIT_CAS: _ClassVar[FileCaptureClass]

class DiffCompleteness(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    DIFF_COMPLETENESS_UNSPECIFIED: _ClassVar[DiffCompleteness]
    DIFF_COMPLETENESS_COMPLETE: _ClassVar[DiffCompleteness]
    DIFF_COMPLETENESS_PARTIAL_BLOCKED: _ClassVar[DiffCompleteness]
    DIFF_COMPLETENESS_BINARY_SUMMARY_ONLY: _ClassVar[DiffCompleteness]

class SnapshotKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SNAPSHOT_KIND_UNSPECIFIED: _ClassVar[SnapshotKind]
    SNAPSHOT_KIND_GIT_TREE_REF: _ClassVar[SnapshotKind]
    SNAPSHOT_KIND_CAS_MANIFEST: _ClassVar[SnapshotKind]
    SNAPSHOT_KIND_HYBRID: _ClassVar[SnapshotKind]

class FileReviewBlockReason(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    FILE_REVIEW_BLOCK_REASON_UNSPECIFIED: _ClassVar[FileReviewBlockReason]
    FILE_REVIEW_BLOCK_REASON_SECRET_WITHHELD: _ClassVar[FileReviewBlockReason]
    FILE_REVIEW_BLOCK_REASON_SIZE_ELIDED: _ClassVar[FileReviewBlockReason]
    FILE_REVIEW_BLOCK_REASON_UNREVIEWABLE: _ClassVar[FileReviewBlockReason]

class RunValueDeclarerKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    RUN_VALUE_DECLARER_KIND_UNSPECIFIED: _ClassVar[RunValueDeclarerKind]
    RUN_VALUE_DECLARER_KIND_AGENT: _ClassVar[RunValueDeclarerKind]
    RUN_VALUE_DECLARER_KIND_TOOL: _ClassVar[RunValueDeclarerKind]
    RUN_VALUE_DECLARER_KIND_REPOSITORY: _ClassVar[RunValueDeclarerKind]
    RUN_VALUE_DECLARER_KIND_PLUGIN: _ClassVar[RunValueDeclarerKind]
    RUN_VALUE_DECLARER_KIND_SUBAGENT: _ClassVar[RunValueDeclarerKind]

class RunValueOrigin(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    RUN_VALUE_ORIGIN_UNSPECIFIED: _ClassVar[RunValueOrigin]
    RUN_VALUE_ORIGIN_REPOSITORY_TOKEN: _ClassVar[RunValueOrigin]
    RUN_VALUE_ORIGIN_MY_VAULT: _ClassVar[RunValueOrigin]
    RUN_VALUE_ORIGIN_VAULT: _ClassVar[RunValueOrigin]
    RUN_VALUE_ORIGIN_SURFACE_VAULT: _ClassVar[RunValueOrigin]
    RUN_VALUE_ORIGIN_DECLARATION: _ClassVar[RunValueOrigin]
RUN_PHASE_UNSPECIFIED: RunPhase
RUN_PENDING: RunPhase
RUN_IN_PROGRESS: RunPhase
RUN_COMPLETED: RunPhase
RUN_FAILED: RunPhase
RUN_CANCELLED: RunPhase
RUN_TERMINATED: RunPhase
RUN_WAITING_FOR_APPROVAL: RunPhase
RUN_PAUSED: RunPhase
RUN_CONTROL_SIGNAL_UNSPECIFIED: RunControlSignal
RUN_CONTROL_SIGNAL_STOP: RunControlSignal
RUN_CONTROL_SIGNAL_WARNING: RunControlSignal
INTERACTION_MODE_UNSPECIFIED: InteractionMode
INTERACTION_MODE_AGENT: InteractionMode
INTERACTION_MODE_PLAN: InteractionMode
APPROVAL_MODE_UNSPECIFIED: ApprovalMode
APPROVAL_MODE_INTERACTIVE: ApprovalMode
APPROVAL_MODE_UNATTENDED: ApprovalMode
SERVICE_TIER_UNSPECIFIED: ServiceTier
SERVICE_TIER_STANDARD: ServiceTier
SERVICE_TIER_FAST: ServiceTier
THINKING_MODE_UNSPECIFIED: ThinkingMode
THINKING_MODE_DISABLED: ThinkingMode
THINKING_MODE_ENABLED: ThinkingMode
FILE_CHANGE_KIND_UNSPECIFIED: FileChangeKind
FILE_CHANGE_KIND_ADD: FileChangeKind
FILE_CHANGE_KIND_MODIFY: FileChangeKind
FILE_CHANGE_KIND_DELETE: FileChangeKind
FILE_CHANGE_KIND_RENAME: FileChangeKind
FILE_CHANGE_KIND_BINARY_CHANGE: FileChangeKind
FILE_CAPTURE_CLASS_UNSPECIFIED: FileCaptureClass
FILE_CAPTURE_CLASS_GIT_TRACKED: FileCaptureClass
FILE_CAPTURE_CLASS_GIT_UNTRACKED_CAPTURED: FileCaptureClass
FILE_CAPTURE_CLASS_GIT_IGNORED_CAPTURED: FileCaptureClass
FILE_CAPTURE_CLASS_NON_GIT_CAS: FileCaptureClass
DIFF_COMPLETENESS_UNSPECIFIED: DiffCompleteness
DIFF_COMPLETENESS_COMPLETE: DiffCompleteness
DIFF_COMPLETENESS_PARTIAL_BLOCKED: DiffCompleteness
DIFF_COMPLETENESS_BINARY_SUMMARY_ONLY: DiffCompleteness
SNAPSHOT_KIND_UNSPECIFIED: SnapshotKind
SNAPSHOT_KIND_GIT_TREE_REF: SnapshotKind
SNAPSHOT_KIND_CAS_MANIFEST: SnapshotKind
SNAPSHOT_KIND_HYBRID: SnapshotKind
FILE_REVIEW_BLOCK_REASON_UNSPECIFIED: FileReviewBlockReason
FILE_REVIEW_BLOCK_REASON_SECRET_WITHHELD: FileReviewBlockReason
FILE_REVIEW_BLOCK_REASON_SIZE_ELIDED: FileReviewBlockReason
FILE_REVIEW_BLOCK_REASON_UNREVIEWABLE: FileReviewBlockReason
RUN_VALUE_DECLARER_KIND_UNSPECIFIED: RunValueDeclarerKind
RUN_VALUE_DECLARER_KIND_AGENT: RunValueDeclarerKind
RUN_VALUE_DECLARER_KIND_TOOL: RunValueDeclarerKind
RUN_VALUE_DECLARER_KIND_REPOSITORY: RunValueDeclarerKind
RUN_VALUE_DECLARER_KIND_PLUGIN: RunValueDeclarerKind
RUN_VALUE_DECLARER_KIND_SUBAGENT: RunValueDeclarerKind
RUN_VALUE_ORIGIN_UNSPECIFIED: RunValueOrigin
RUN_VALUE_ORIGIN_REPOSITORY_TOKEN: RunValueOrigin
RUN_VALUE_ORIGIN_MY_VAULT: RunValueOrigin
RUN_VALUE_ORIGIN_VAULT: RunValueOrigin
RUN_VALUE_ORIGIN_SURFACE_VAULT: RunValueOrigin
RUN_VALUE_ORIGIN_DECLARATION: RunValueOrigin
