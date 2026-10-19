from ai.stigmer.agentic.session.v1 import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SessionResource(_message.Message):
    __slots__ = ("name", "file", "git_repository", "local_path")
    NAME_FIELD_NUMBER: _ClassVar[int]
    FILE_FIELD_NUMBER: _ClassVar[int]
    GIT_REPOSITORY_FIELD_NUMBER: _ClassVar[int]
    LOCAL_PATH_FIELD_NUMBER: _ClassVar[int]
    name: str
    file: FileResource
    git_repository: GitRepositoryResource
    local_path: LocalPathResource
    def __init__(self, name: _Optional[str] = ..., file: _Optional[_Union[FileResource, _Mapping]] = ..., git_repository: _Optional[_Union[GitRepositoryResource, _Mapping]] = ..., local_path: _Optional[_Union[LocalPathResource, _Mapping]] = ...) -> None: ...

class FileResource(_message.Message):
    __slots__ = ("file_id", "mount_path")
    FILE_ID_FIELD_NUMBER: _ClassVar[int]
    MOUNT_PATH_FIELD_NUMBER: _ClassVar[int]
    file_id: str
    mount_path: str
    def __init__(self, file_id: _Optional[str] = ..., mount_path: _Optional[str] = ...) -> None: ...

class GitRepositoryResource(_message.Message):
    __slots__ = ("url", "branch", "commit", "write_back_mode", "token")
    URL_FIELD_NUMBER: _ClassVar[int]
    BRANCH_FIELD_NUMBER: _ClassVar[int]
    COMMIT_FIELD_NUMBER: _ClassVar[int]
    WRITE_BACK_MODE_FIELD_NUMBER: _ClassVar[int]
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    url: str
    branch: str
    commit: str
    write_back_mode: _enum_pb2.GitWriteBackMode
    token: str
    def __init__(self, url: _Optional[str] = ..., branch: _Optional[str] = ..., commit: _Optional[str] = ..., write_back_mode: _Optional[_Union[_enum_pb2.GitWriteBackMode, str]] = ..., token: _Optional[str] = ...) -> None: ...

class LocalPathResource(_message.Message):
    __slots__ = ("path",)
    PATH_FIELD_NUMBER: _ClassVar[int]
    path: str
    def __init__(self, path: _Optional[str] = ...) -> None: ...
