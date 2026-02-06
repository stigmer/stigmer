from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SkillSynth(_message.Message):
    __slots__ = ("local", "git", "tag")
    LOCAL_FIELD_NUMBER: _ClassVar[int]
    GIT_FIELD_NUMBER: _ClassVar[int]
    TAG_FIELD_NUMBER: _ClassVar[int]
    local: LocalDir
    git: Git
    tag: str
    def __init__(self, local: _Optional[_Union[LocalDir, _Mapping]] = ..., git: _Optional[_Union[Git, _Mapping]] = ..., tag: _Optional[str] = ...) -> None: ...

class LocalDir(_message.Message):
    __slots__ = ("path",)
    PATH_FIELD_NUMBER: _ClassVar[int]
    path: str
    def __init__(self, path: _Optional[str] = ...) -> None: ...

class Git(_message.Message):
    __slots__ = ("url", "ref", "subdir")
    URL_FIELD_NUMBER: _ClassVar[int]
    REF_FIELD_NUMBER: _ClassVar[int]
    SUBDIR_FIELD_NUMBER: _ClassVar[int]
    url: str
    ref: str
    subdir: str
    def __init__(self, url: _Optional[str] = ..., ref: _Optional[str] = ..., subdir: _Optional[str] = ...) -> None: ...
