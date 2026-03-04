from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class WorkspaceSource(_message.Message):
    __slots__ = ("git_repo", "local_path")
    GIT_REPO_FIELD_NUMBER: _ClassVar[int]
    LOCAL_PATH_FIELD_NUMBER: _ClassVar[int]
    git_repo: GitRepoSource
    local_path: LocalPathSource
    def __init__(self, git_repo: _Optional[_Union[GitRepoSource, _Mapping]] = ..., local_path: _Optional[_Union[LocalPathSource, _Mapping]] = ...) -> None: ...

class WorkspaceEntry(_message.Message):
    __slots__ = ("name", "source")
    NAME_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    name: str
    source: WorkspaceSource
    def __init__(self, name: _Optional[str] = ..., source: _Optional[_Union[WorkspaceSource, _Mapping]] = ...) -> None: ...

class LocalPathSource(_message.Message):
    __slots__ = ("path",)
    PATH_FIELD_NUMBER: _ClassVar[int]
    path: str
    def __init__(self, path: _Optional[str] = ...) -> None: ...

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
