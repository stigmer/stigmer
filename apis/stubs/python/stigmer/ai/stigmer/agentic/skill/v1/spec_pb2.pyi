from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SkillSpec(_message.Message):
    __slots__ = ("skill_md", "tag", "name", "source", "description")
    SKILL_MD_FIELD_NUMBER: _ClassVar[int]
    TAG_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    skill_md: str
    tag: str
    name: str
    source: SkillSource
    description: str
    def __init__(self, skill_md: _Optional[str] = ..., tag: _Optional[str] = ..., name: _Optional[str] = ..., source: _Optional[_Union[SkillSource, _Mapping]] = ..., description: _Optional[str] = ...) -> None: ...

class SkillSource(_message.Message):
    __slots__ = ("local", "git")
    LOCAL_FIELD_NUMBER: _ClassVar[int]
    GIT_FIELD_NUMBER: _ClassVar[int]
    local: LocalSource
    git: GitSource
    def __init__(self, local: _Optional[_Union[LocalSource, _Mapping]] = ..., git: _Optional[_Union[GitSource, _Mapping]] = ...) -> None: ...

class LocalSource(_message.Message):
    __slots__ = ("git_remote_url", "git_commit", "subdir", "is_git_repo")
    GIT_REMOTE_URL_FIELD_NUMBER: _ClassVar[int]
    GIT_COMMIT_FIELD_NUMBER: _ClassVar[int]
    SUBDIR_FIELD_NUMBER: _ClassVar[int]
    IS_GIT_REPO_FIELD_NUMBER: _ClassVar[int]
    git_remote_url: str
    git_commit: str
    subdir: str
    is_git_repo: bool
    def __init__(self, git_remote_url: _Optional[str] = ..., git_commit: _Optional[str] = ..., subdir: _Optional[str] = ..., is_git_repo: bool = ...) -> None: ...

class GitSource(_message.Message):
    __slots__ = ("url", "ref", "subdir")
    URL_FIELD_NUMBER: _ClassVar[int]
    REF_FIELD_NUMBER: _ClassVar[int]
    SUBDIR_FIELD_NUMBER: _ClassVar[int]
    url: str
    ref: str
    subdir: str
    def __init__(self, url: _Optional[str] = ..., ref: _Optional[str] = ..., subdir: _Optional[str] = ...) -> None: ...
