from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class WorkspaceSource(_message.Message):
    __slots__ = ("git_repo",)
    GIT_REPO_FIELD_NUMBER: _ClassVar[int]
    git_repo: GitRepoSource
    def __init__(self, git_repo: _Optional[_Union[GitRepoSource, _Mapping]] = ...) -> None: ...

class GitRepoSource(_message.Message):
    __slots__ = ("url", "branch", "commit", "depth")
    URL_FIELD_NUMBER: _ClassVar[int]
    BRANCH_FIELD_NUMBER: _ClassVar[int]
    COMMIT_FIELD_NUMBER: _ClassVar[int]
    DEPTH_FIELD_NUMBER: _ClassVar[int]
    url: str
    branch: str
    commit: str
    depth: int
    def __init__(self, url: _Optional[str] = ..., branch: _Optional[str] = ..., commit: _Optional[str] = ..., depth: _Optional[int] = ...) -> None: ...
