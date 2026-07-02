from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class ExecutionPhase(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    EXECUTION_PHASE_UNSPECIFIED: _ClassVar[ExecutionPhase]
    EXECUTION_PENDING: _ClassVar[ExecutionPhase]
    EXECUTION_IN_PROGRESS: _ClassVar[ExecutionPhase]
    EXECUTION_COMPLETED: _ClassVar[ExecutionPhase]
    EXECUTION_FAILED: _ClassVar[ExecutionPhase]
    EXECUTION_CANCELLED: _ClassVar[ExecutionPhase]
    EXECUTION_TERMINATED: _ClassVar[ExecutionPhase]
    EXECUTION_WAITING_FOR_APPROVAL: _ClassVar[ExecutionPhase]
    EXECUTION_PAUSED: _ClassVar[ExecutionPhase]

class MessageType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    MESSAGE_TYPE_UNSPECIFIED: _ClassVar[MessageType]
    MESSAGE_HUMAN: _ClassVar[MessageType]
    MESSAGE_AI: _ClassVar[MessageType]
    MESSAGE_TOOL: _ClassVar[MessageType]
    MESSAGE_SYSTEM: _ClassVar[MessageType]
    MESSAGE_THINKING: _ClassVar[MessageType]

class ToolCallStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TOOL_CALL_STATUS_UNSPECIFIED: _ClassVar[ToolCallStatus]
    TOOL_CALL_PENDING: _ClassVar[ToolCallStatus]
    TOOL_CALL_RUNNING: _ClassVar[ToolCallStatus]
    TOOL_CALL_COMPLETED: _ClassVar[ToolCallStatus]
    TOOL_CALL_FAILED: _ClassVar[ToolCallStatus]
    TOOL_CALL_WAITING_APPROVAL: _ClassVar[ToolCallStatus]
    TOOL_CALL_SKIPPED: _ClassVar[ToolCallStatus]

class ToolKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TOOL_KIND_UNSPECIFIED: _ClassVar[ToolKind]
    TOOL_KIND_FILE_READ: _ClassVar[ToolKind]
    TOOL_KIND_FILE_WRITE: _ClassVar[ToolKind]
    TOOL_KIND_FILE_EDIT: _ClassVar[ToolKind]
    TOOL_KIND_FILE_DELETE: _ClassVar[ToolKind]
    TOOL_KIND_SHELL: _ClassVar[ToolKind]
    TOOL_KIND_SEARCH: _ClassVar[ToolKind]
    TOOL_KIND_LIST: _ClassVar[ToolKind]
    TOOL_KIND_FETCH: _ClassVar[ToolKind]
    TOOL_KIND_WEB_SEARCH: _ClassVar[ToolKind]
    TOOL_KIND_THINK: _ClassVar[ToolKind]
    TOOL_KIND_TODO: _ClassVar[ToolKind]
    TOOL_KIND_SUBAGENT: _ClassVar[ToolKind]
    TOOL_KIND_MCP: _ClassVar[ToolKind]

class TodoStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TODO_STATUS_UNSPECIFIED: _ClassVar[TodoStatus]
    TODO_PENDING: _ClassVar[TodoStatus]
    TODO_IN_PROGRESS: _ClassVar[TodoStatus]
    TODO_COMPLETED: _ClassVar[TodoStatus]
    TODO_CANCELLED: _ClassVar[TodoStatus]

class SubAgentStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SUB_AGENT_STATUS_UNSPECIFIED: _ClassVar[SubAgentStatus]
    SUB_AGENT_PENDING: _ClassVar[SubAgentStatus]
    SUB_AGENT_IN_PROGRESS: _ClassVar[SubAgentStatus]
    SUB_AGENT_COMPLETED: _ClassVar[SubAgentStatus]
    SUB_AGENT_FAILED: _ClassVar[SubAgentStatus]
    SUB_AGENT_CANCELLED: _ClassVar[SubAgentStatus]

class ExecutionArtifactKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    EXECUTION_ARTIFACT_KIND_UNSPECIFIED: _ClassVar[ExecutionArtifactKind]
    EXECUTION_ARTIFACT_KIND_FILE: _ClassVar[ExecutionArtifactKind]
    EXECUTION_ARTIFACT_KIND_DIRECTORY: _ClassVar[ExecutionArtifactKind]

class SummarizationSource(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SUMMARIZATION_SOURCE_UNSPECIFIED: _ClassVar[SummarizationSource]
    graph_start: _ClassVar[SummarizationSource]
    mid_execution: _ClassVar[SummarizationSource]

class ToolCallStreamingSource(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TOOL_CALL_STREAMING_SOURCE_UNSPECIFIED: _ClassVar[ToolCallStreamingSource]
    TOOL_CALL_STREAMING_SOURCE_INPUT: _ClassVar[ToolCallStreamingSource]
    TOOL_CALL_STREAMING_SOURCE_OUTPUT: _ClassVar[ToolCallStreamingSource]

class ExecutionControlSignal(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    EXECUTION_CONTROL_SIGNAL_UNSPECIFIED: _ClassVar[ExecutionControlSignal]
    EXECUTION_CONTROL_SIGNAL_STOP: _ClassVar[ExecutionControlSignal]
    EXECUTION_CONTROL_SIGNAL_WARNING: _ClassVar[ExecutionControlSignal]

class ApprovalAction(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    APPROVAL_ACTION_UNSPECIFIED: _ClassVar[ApprovalAction]
    APPROVAL_ACTION_APPROVE: _ClassVar[ApprovalAction]
    APPROVAL_ACTION_SKIP: _ClassVar[ApprovalAction]
    APPROVAL_ACTION_REJECT: _ClassVar[ApprovalAction]
    APPROVAL_ACTION_APPROVE_ALL: _ClassVar[ApprovalAction]

class ApprovalPolicySource(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    APPROVAL_POLICY_SOURCE_UNSPECIFIED: _ClassVar[ApprovalPolicySource]
    APPROVAL_POLICY_SOURCE_CLASSIFIER_DEFAULT: _ClassVar[ApprovalPolicySource]
    APPROVAL_POLICY_SOURCE_PINNED_OVERRIDE: _ClassVar[ApprovalPolicySource]
    APPROVAL_POLICY_SOURCE_AGENT_OVERRIDE: _ClassVar[ApprovalPolicySource]
    APPROVAL_POLICY_SOURCE_AUTO_APPROVE_ALL: _ClassVar[ApprovalPolicySource]
    APPROVAL_POLICY_SOURCE_APPROVAL_LEASE: _ClassVar[ApprovalPolicySource]
    APPROVAL_POLICY_SOURCE_BUILTIN_CATEGORY: _ClassVar[ApprovalPolicySource]
    APPROVAL_POLICY_SOURCE_ANNOTATION_DESTRUCTIVE_TIGHTEN: _ClassVar[ApprovalPolicySource]

class ApprovalEventType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    APPROVAL_EVENT_TYPE_UNSPECIFIED: _ClassVar[ApprovalEventType]
    APPROVAL_EVENT_TYPE_REQUESTED: _ClassVar[ApprovalEventType]
    APPROVAL_EVENT_TYPE_APPROVED: _ClassVar[ApprovalEventType]
    APPROVAL_EVENT_TYPE_REJECTED: _ClassVar[ApprovalEventType]
    APPROVAL_EVENT_TYPE_SKIPPED: _ClassVar[ApprovalEventType]
    APPROVAL_EVENT_TYPE_RETRACTED: _ClassVar[ApprovalEventType]

class ApprovalRetractionReason(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    APPROVAL_RETRACTION_REASON_UNSPECIFIED: _ClassVar[ApprovalRetractionReason]
    APPROVAL_RETRACTION_REASON_SUB_AGENT_TERMINAL: _ClassVar[ApprovalRetractionReason]
    APPROVAL_RETRACTION_REASON_SUPERSEDED: _ClassVar[ApprovalRetractionReason]

class InteractionMode(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    INTERACTION_MODE_UNSPECIFIED: _ClassVar[InteractionMode]
    INTERACTION_MODE_AGENT: _ClassVar[InteractionMode]
    INTERACTION_MODE_PLAN: _ClassVar[InteractionMode]

class FileChangeType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    FILE_CHANGE_TYPE_UNSPECIFIED: _ClassVar[FileChangeType]
    FILE_CHANGE_TYPE_CREATE: _ClassVar[FileChangeType]
    FILE_CHANGE_TYPE_MODIFY: _ClassVar[FileChangeType]
    FILE_CHANGE_TYPE_DELETE: _ClassVar[FileChangeType]
    FILE_CHANGE_TYPE_RENAME: _ClassVar[FileChangeType]

class FileChangeCaptureLevel(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    FILE_CHANGE_CAPTURE_LEVEL_UNSPECIFIED: _ClassVar[FileChangeCaptureLevel]
    FILE_CHANGE_CAPTURE_LEVEL_WHOLE_FILE: _ClassVar[FileChangeCaptureLevel]
    FILE_CHANGE_CAPTURE_LEVEL_HUNK_ONLY: _ClassVar[FileChangeCaptureLevel]

class FileChangeSetStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    FILE_CHANGE_SET_STATUS_UNSPECIFIED: _ClassVar[FileChangeSetStatus]
    FILE_CHANGE_SET_STATUS_CAPTURING: _ClassVar[FileChangeSetStatus]
    FILE_CHANGE_SET_STATUS_AWAITING_REVIEW: _ClassVar[FileChangeSetStatus]
    FILE_CHANGE_SET_STATUS_DECIDED: _ClassVar[FileChangeSetStatus]
    FILE_CHANGE_SET_STATUS_RECONCILED: _ClassVar[FileChangeSetStatus]
    FILE_CHANGE_SET_STATUS_FAILED: _ClassVar[FileChangeSetStatus]

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

class FileDecisionScope(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    FILE_DECISION_SCOPE_UNSPECIFIED: _ClassVar[FileDecisionScope]
    FILE_DECISION_SCOPE_CHANGE_SET: _ClassVar[FileDecisionScope]
    FILE_DECISION_SCOPE_FILE: _ClassVar[FileDecisionScope]

class FileDecisionAction(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    FILE_DECISION_ACTION_UNSPECIFIED: _ClassVar[FileDecisionAction]
    FILE_DECISION_ACTION_APPROVE: _ClassVar[FileDecisionAction]
    FILE_DECISION_ACTION_REJECT: _ClassVar[FileDecisionAction]

class FileDecisionOrigin(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    FILE_DECISION_ORIGIN_UNSPECIFIED: _ClassVar[FileDecisionOrigin]
    FILE_DECISION_ORIGIN_USER: _ClassVar[FileDecisionOrigin]
    FILE_DECISION_ORIGIN_POLICY_APPROVED_COMMAND: _ClassVar[FileDecisionOrigin]

class FileReviewEventType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    FILE_REVIEW_EVENT_TYPE_UNSPECIFIED: _ClassVar[FileReviewEventType]
    FILE_REVIEW_EVENT_TYPE_BASELINE_CAPTURED: _ClassVar[FileReviewEventType]
    FILE_REVIEW_EVENT_TYPE_CANDIDATE_CAPTURED: _ClassVar[FileReviewEventType]
    FILE_REVIEW_EVENT_TYPE_FILE_DECIDED: _ClassVar[FileReviewEventType]
    FILE_REVIEW_EVENT_TYPE_RECONCILED: _ClassVar[FileReviewEventType]
    FILE_REVIEW_EVENT_TYPE_FAILED: _ClassVar[FileReviewEventType]

class FileReviewFailureKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    FILE_REVIEW_FAILURE_KIND_UNSPECIFIED: _ClassVar[FileReviewFailureKind]
    FILE_REVIEW_FAILURE_KIND_CAPTURE_FAILED: _ClassVar[FileReviewFailureKind]
    FILE_REVIEW_FAILURE_KIND_DIFF_UNREVIEWABLE: _ClassVar[FileReviewFailureKind]
    FILE_REVIEW_FAILURE_KIND_RECONCILE_FAILED: _ClassVar[FileReviewFailureKind]
    FILE_REVIEW_FAILURE_KIND_HASH_MISMATCH: _ClassVar[FileReviewFailureKind]

class FileReviewBlockReason(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    FILE_REVIEW_BLOCK_REASON_UNSPECIFIED: _ClassVar[FileReviewBlockReason]
    FILE_REVIEW_BLOCK_REASON_SECRET_WITHHELD: _ClassVar[FileReviewBlockReason]
    FILE_REVIEW_BLOCK_REASON_SIZE_ELIDED: _ClassVar[FileReviewBlockReason]
    FILE_REVIEW_BLOCK_REASON_UNREVIEWABLE: _ClassVar[FileReviewBlockReason]
EXECUTION_PHASE_UNSPECIFIED: ExecutionPhase
EXECUTION_PENDING: ExecutionPhase
EXECUTION_IN_PROGRESS: ExecutionPhase
EXECUTION_COMPLETED: ExecutionPhase
EXECUTION_FAILED: ExecutionPhase
EXECUTION_CANCELLED: ExecutionPhase
EXECUTION_TERMINATED: ExecutionPhase
EXECUTION_WAITING_FOR_APPROVAL: ExecutionPhase
EXECUTION_PAUSED: ExecutionPhase
MESSAGE_TYPE_UNSPECIFIED: MessageType
MESSAGE_HUMAN: MessageType
MESSAGE_AI: MessageType
MESSAGE_TOOL: MessageType
MESSAGE_SYSTEM: MessageType
MESSAGE_THINKING: MessageType
TOOL_CALL_STATUS_UNSPECIFIED: ToolCallStatus
TOOL_CALL_PENDING: ToolCallStatus
TOOL_CALL_RUNNING: ToolCallStatus
TOOL_CALL_COMPLETED: ToolCallStatus
TOOL_CALL_FAILED: ToolCallStatus
TOOL_CALL_WAITING_APPROVAL: ToolCallStatus
TOOL_CALL_SKIPPED: ToolCallStatus
TOOL_KIND_UNSPECIFIED: ToolKind
TOOL_KIND_FILE_READ: ToolKind
TOOL_KIND_FILE_WRITE: ToolKind
TOOL_KIND_FILE_EDIT: ToolKind
TOOL_KIND_FILE_DELETE: ToolKind
TOOL_KIND_SHELL: ToolKind
TOOL_KIND_SEARCH: ToolKind
TOOL_KIND_LIST: ToolKind
TOOL_KIND_FETCH: ToolKind
TOOL_KIND_WEB_SEARCH: ToolKind
TOOL_KIND_THINK: ToolKind
TOOL_KIND_TODO: ToolKind
TOOL_KIND_SUBAGENT: ToolKind
TOOL_KIND_MCP: ToolKind
TODO_STATUS_UNSPECIFIED: TodoStatus
TODO_PENDING: TodoStatus
TODO_IN_PROGRESS: TodoStatus
TODO_COMPLETED: TodoStatus
TODO_CANCELLED: TodoStatus
SUB_AGENT_STATUS_UNSPECIFIED: SubAgentStatus
SUB_AGENT_PENDING: SubAgentStatus
SUB_AGENT_IN_PROGRESS: SubAgentStatus
SUB_AGENT_COMPLETED: SubAgentStatus
SUB_AGENT_FAILED: SubAgentStatus
SUB_AGENT_CANCELLED: SubAgentStatus
EXECUTION_ARTIFACT_KIND_UNSPECIFIED: ExecutionArtifactKind
EXECUTION_ARTIFACT_KIND_FILE: ExecutionArtifactKind
EXECUTION_ARTIFACT_KIND_DIRECTORY: ExecutionArtifactKind
SUMMARIZATION_SOURCE_UNSPECIFIED: SummarizationSource
graph_start: SummarizationSource
mid_execution: SummarizationSource
TOOL_CALL_STREAMING_SOURCE_UNSPECIFIED: ToolCallStreamingSource
TOOL_CALL_STREAMING_SOURCE_INPUT: ToolCallStreamingSource
TOOL_CALL_STREAMING_SOURCE_OUTPUT: ToolCallStreamingSource
EXECUTION_CONTROL_SIGNAL_UNSPECIFIED: ExecutionControlSignal
EXECUTION_CONTROL_SIGNAL_STOP: ExecutionControlSignal
EXECUTION_CONTROL_SIGNAL_WARNING: ExecutionControlSignal
APPROVAL_ACTION_UNSPECIFIED: ApprovalAction
APPROVAL_ACTION_APPROVE: ApprovalAction
APPROVAL_ACTION_SKIP: ApprovalAction
APPROVAL_ACTION_REJECT: ApprovalAction
APPROVAL_ACTION_APPROVE_ALL: ApprovalAction
APPROVAL_POLICY_SOURCE_UNSPECIFIED: ApprovalPolicySource
APPROVAL_POLICY_SOURCE_CLASSIFIER_DEFAULT: ApprovalPolicySource
APPROVAL_POLICY_SOURCE_PINNED_OVERRIDE: ApprovalPolicySource
APPROVAL_POLICY_SOURCE_AGENT_OVERRIDE: ApprovalPolicySource
APPROVAL_POLICY_SOURCE_AUTO_APPROVE_ALL: ApprovalPolicySource
APPROVAL_POLICY_SOURCE_APPROVAL_LEASE: ApprovalPolicySource
APPROVAL_POLICY_SOURCE_BUILTIN_CATEGORY: ApprovalPolicySource
APPROVAL_POLICY_SOURCE_ANNOTATION_DESTRUCTIVE_TIGHTEN: ApprovalPolicySource
APPROVAL_EVENT_TYPE_UNSPECIFIED: ApprovalEventType
APPROVAL_EVENT_TYPE_REQUESTED: ApprovalEventType
APPROVAL_EVENT_TYPE_APPROVED: ApprovalEventType
APPROVAL_EVENT_TYPE_REJECTED: ApprovalEventType
APPROVAL_EVENT_TYPE_SKIPPED: ApprovalEventType
APPROVAL_EVENT_TYPE_RETRACTED: ApprovalEventType
APPROVAL_RETRACTION_REASON_UNSPECIFIED: ApprovalRetractionReason
APPROVAL_RETRACTION_REASON_SUB_AGENT_TERMINAL: ApprovalRetractionReason
APPROVAL_RETRACTION_REASON_SUPERSEDED: ApprovalRetractionReason
INTERACTION_MODE_UNSPECIFIED: InteractionMode
INTERACTION_MODE_AGENT: InteractionMode
INTERACTION_MODE_PLAN: InteractionMode
FILE_CHANGE_TYPE_UNSPECIFIED: FileChangeType
FILE_CHANGE_TYPE_CREATE: FileChangeType
FILE_CHANGE_TYPE_MODIFY: FileChangeType
FILE_CHANGE_TYPE_DELETE: FileChangeType
FILE_CHANGE_TYPE_RENAME: FileChangeType
FILE_CHANGE_CAPTURE_LEVEL_UNSPECIFIED: FileChangeCaptureLevel
FILE_CHANGE_CAPTURE_LEVEL_WHOLE_FILE: FileChangeCaptureLevel
FILE_CHANGE_CAPTURE_LEVEL_HUNK_ONLY: FileChangeCaptureLevel
FILE_CHANGE_SET_STATUS_UNSPECIFIED: FileChangeSetStatus
FILE_CHANGE_SET_STATUS_CAPTURING: FileChangeSetStatus
FILE_CHANGE_SET_STATUS_AWAITING_REVIEW: FileChangeSetStatus
FILE_CHANGE_SET_STATUS_DECIDED: FileChangeSetStatus
FILE_CHANGE_SET_STATUS_RECONCILED: FileChangeSetStatus
FILE_CHANGE_SET_STATUS_FAILED: FileChangeSetStatus
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
FILE_DECISION_SCOPE_UNSPECIFIED: FileDecisionScope
FILE_DECISION_SCOPE_CHANGE_SET: FileDecisionScope
FILE_DECISION_SCOPE_FILE: FileDecisionScope
FILE_DECISION_ACTION_UNSPECIFIED: FileDecisionAction
FILE_DECISION_ACTION_APPROVE: FileDecisionAction
FILE_DECISION_ACTION_REJECT: FileDecisionAction
FILE_DECISION_ORIGIN_UNSPECIFIED: FileDecisionOrigin
FILE_DECISION_ORIGIN_USER: FileDecisionOrigin
FILE_DECISION_ORIGIN_POLICY_APPROVED_COMMAND: FileDecisionOrigin
FILE_REVIEW_EVENT_TYPE_UNSPECIFIED: FileReviewEventType
FILE_REVIEW_EVENT_TYPE_BASELINE_CAPTURED: FileReviewEventType
FILE_REVIEW_EVENT_TYPE_CANDIDATE_CAPTURED: FileReviewEventType
FILE_REVIEW_EVENT_TYPE_FILE_DECIDED: FileReviewEventType
FILE_REVIEW_EVENT_TYPE_RECONCILED: FileReviewEventType
FILE_REVIEW_EVENT_TYPE_FAILED: FileReviewEventType
FILE_REVIEW_FAILURE_KIND_UNSPECIFIED: FileReviewFailureKind
FILE_REVIEW_FAILURE_KIND_CAPTURE_FAILED: FileReviewFailureKind
FILE_REVIEW_FAILURE_KIND_DIFF_UNREVIEWABLE: FileReviewFailureKind
FILE_REVIEW_FAILURE_KIND_RECONCILE_FAILED: FileReviewFailureKind
FILE_REVIEW_FAILURE_KIND_HASH_MISMATCH: FileReviewFailureKind
FILE_REVIEW_BLOCK_REASON_UNSPECIFIED: FileReviewBlockReason
FILE_REVIEW_BLOCK_REASON_SECRET_WITHHELD: FileReviewBlockReason
FILE_REVIEW_BLOCK_REASON_SIZE_ELIDED: FileReviewBlockReason
FILE_REVIEW_BLOCK_REASON_UNREVIEWABLE: FileReviewBlockReason
