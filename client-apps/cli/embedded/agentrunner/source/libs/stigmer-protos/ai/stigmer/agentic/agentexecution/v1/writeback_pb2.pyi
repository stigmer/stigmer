from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class WorkspaceWriteBackPhase(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    WORKSPACE_WRITE_BACK_PHASE_UNSPECIFIED: _ClassVar[WorkspaceWriteBackPhase]
    WORKSPACE_WRITE_BACK_COMMITTED: _ClassVar[WorkspaceWriteBackPhase]
    WORKSPACE_WRITE_BACK_PUSHED: _ClassVar[WorkspaceWriteBackPhase]
    WORKSPACE_WRITE_BACK_PR_CREATED: _ClassVar[WorkspaceWriteBackPhase]
    WORKSPACE_WRITE_BACK_FAILED: _ClassVar[WorkspaceWriteBackPhase]
WORKSPACE_WRITE_BACK_PHASE_UNSPECIFIED: WorkspaceWriteBackPhase
WORKSPACE_WRITE_BACK_COMMITTED: WorkspaceWriteBackPhase
WORKSPACE_WRITE_BACK_PUSHED: WorkspaceWriteBackPhase
WORKSPACE_WRITE_BACK_PR_CREATED: WorkspaceWriteBackPhase
WORKSPACE_WRITE_BACK_FAILED: WorkspaceWriteBackPhase

class WorkspaceWriteBack(_message.Message):
    __slots__ = ("workspace_entry_name", "branch_name", "base_branch", "commit_sha", "pull_request_url", "pull_request_number", "diff_summary", "phase", "error")
    WORKSPACE_ENTRY_NAME_FIELD_NUMBER: _ClassVar[int]
    BRANCH_NAME_FIELD_NUMBER: _ClassVar[int]
    BASE_BRANCH_FIELD_NUMBER: _ClassVar[int]
    COMMIT_SHA_FIELD_NUMBER: _ClassVar[int]
    PULL_REQUEST_URL_FIELD_NUMBER: _ClassVar[int]
    PULL_REQUEST_NUMBER_FIELD_NUMBER: _ClassVar[int]
    DIFF_SUMMARY_FIELD_NUMBER: _ClassVar[int]
    PHASE_FIELD_NUMBER: _ClassVar[int]
    ERROR_FIELD_NUMBER: _ClassVar[int]
    workspace_entry_name: str
    branch_name: str
    base_branch: str
    commit_sha: str
    pull_request_url: str
    pull_request_number: int
    diff_summary: str
    phase: WorkspaceWriteBackPhase
    error: str
    def __init__(self, workspace_entry_name: _Optional[str] = ..., branch_name: _Optional[str] = ..., base_branch: _Optional[str] = ..., commit_sha: _Optional[str] = ..., pull_request_url: _Optional[str] = ..., pull_request_number: _Optional[int] = ..., diff_summary: _Optional[str] = ..., phase: _Optional[_Union[WorkspaceWriteBackPhase, str]] = ..., error: _Optional[str] = ...) -> None: ...
