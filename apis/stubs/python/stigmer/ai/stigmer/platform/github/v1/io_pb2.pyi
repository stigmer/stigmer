from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class GitHubRepository(_message.Message):
    __slots__ = ("id", "full_name", "name", "owner", "owner_is_organization", "html_url", "clone_url", "default_branch", "is_private", "updated_at")
    ID_FIELD_NUMBER: _ClassVar[int]
    FULL_NAME_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    OWNER_FIELD_NUMBER: _ClassVar[int]
    OWNER_IS_ORGANIZATION_FIELD_NUMBER: _ClassVar[int]
    HTML_URL_FIELD_NUMBER: _ClassVar[int]
    CLONE_URL_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_BRANCH_FIELD_NUMBER: _ClassVar[int]
    IS_PRIVATE_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    id: int
    full_name: str
    name: str
    owner: str
    owner_is_organization: bool
    html_url: str
    clone_url: str
    default_branch: str
    is_private: bool
    updated_at: str
    def __init__(self, id: _Optional[int] = ..., full_name: _Optional[str] = ..., name: _Optional[str] = ..., owner: _Optional[str] = ..., owner_is_organization: bool = ..., html_url: _Optional[str] = ..., clone_url: _Optional[str] = ..., default_branch: _Optional[str] = ..., is_private: bool = ..., updated_at: _Optional[str] = ...) -> None: ...

class ListGitHubRepositoriesInput(_message.Message):
    __slots__ = ("org", "page")
    ORG_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    org: str
    page: int
    def __init__(self, org: _Optional[str] = ..., page: _Optional[int] = ...) -> None: ...

class SearchGitHubRepositoriesInput(_message.Message):
    __slots__ = ("org", "query", "page")
    ORG_FIELD_NUMBER: _ClassVar[int]
    QUERY_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    org: str
    query: str
    page: int
    def __init__(self, org: _Optional[str] = ..., query: _Optional[str] = ..., page: _Optional[int] = ...) -> None: ...

class GitHubRepositoryList(_message.Message):
    __slots__ = ("repositories", "has_more")
    REPOSITORIES_FIELD_NUMBER: _ClassVar[int]
    HAS_MORE_FIELD_NUMBER: _ClassVar[int]
    repositories: _containers.RepeatedCompositeFieldContainer[GitHubRepository]
    has_more: bool
    def __init__(self, repositories: _Optional[_Iterable[_Union[GitHubRepository, _Mapping]]] = ..., has_more: bool = ...) -> None: ...

class ListGitHubBranchesInput(_message.Message):
    __slots__ = ("org", "owner", "repo")
    ORG_FIELD_NUMBER: _ClassVar[int]
    OWNER_FIELD_NUMBER: _ClassVar[int]
    REPO_FIELD_NUMBER: _ClassVar[int]
    org: str
    owner: str
    repo: str
    def __init__(self, org: _Optional[str] = ..., owner: _Optional[str] = ..., repo: _Optional[str] = ...) -> None: ...

class GitHubBranchList(_message.Message):
    __slots__ = ("names",)
    NAMES_FIELD_NUMBER: _ClassVar[int]
    names: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, names: _Optional[_Iterable[str]] = ...) -> None: ...

class GetGitHubTreeInput(_message.Message):
    __slots__ = ("org", "owner", "repo", "ref")
    ORG_FIELD_NUMBER: _ClassVar[int]
    OWNER_FIELD_NUMBER: _ClassVar[int]
    REPO_FIELD_NUMBER: _ClassVar[int]
    REF_FIELD_NUMBER: _ClassVar[int]
    org: str
    owner: str
    repo: str
    ref: str
    def __init__(self, org: _Optional[str] = ..., owner: _Optional[str] = ..., repo: _Optional[str] = ..., ref: _Optional[str] = ...) -> None: ...

class GitHubTreeEntry(_message.Message):
    __slots__ = ("path", "is_directory", "size")
    PATH_FIELD_NUMBER: _ClassVar[int]
    IS_DIRECTORY_FIELD_NUMBER: _ClassVar[int]
    SIZE_FIELD_NUMBER: _ClassVar[int]
    path: str
    is_directory: bool
    size: int
    def __init__(self, path: _Optional[str] = ..., is_directory: bool = ..., size: _Optional[int] = ...) -> None: ...

class GitHubTree(_message.Message):
    __slots__ = ("entries", "truncated")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    TRUNCATED_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[GitHubTreeEntry]
    truncated: bool
    def __init__(self, entries: _Optional[_Iterable[_Union[GitHubTreeEntry, _Mapping]]] = ..., truncated: bool = ...) -> None: ...

class GetGitHubFileContentInput(_message.Message):
    __slots__ = ("org", "owner", "repo", "ref", "path")
    ORG_FIELD_NUMBER: _ClassVar[int]
    OWNER_FIELD_NUMBER: _ClassVar[int]
    REPO_FIELD_NUMBER: _ClassVar[int]
    REF_FIELD_NUMBER: _ClassVar[int]
    PATH_FIELD_NUMBER: _ClassVar[int]
    org: str
    owner: str
    repo: str
    ref: str
    path: str
    def __init__(self, org: _Optional[str] = ..., owner: _Optional[str] = ..., repo: _Optional[str] = ..., ref: _Optional[str] = ..., path: _Optional[str] = ...) -> None: ...

class GitHubFileContent(_message.Message):
    __slots__ = ("content", "size", "too_large")
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    SIZE_FIELD_NUMBER: _ClassVar[int]
    TOO_LARGE_FIELD_NUMBER: _ClassVar[int]
    content: bytes
    size: int
    too_large: bool
    def __init__(self, content: _Optional[bytes] = ..., size: _Optional[int] = ..., too_large: bool = ...) -> None: ...
