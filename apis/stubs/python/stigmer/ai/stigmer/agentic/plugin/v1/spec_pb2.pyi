from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PluginDialect(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    PLUGIN_DIALECT_UNSPECIFIED: _ClassVar[PluginDialect]
    PLUGIN_DIALECT_AGENT_PLUGINS: _ClassVar[PluginDialect]
    PLUGIN_DIALECT_CLAUDE: _ClassVar[PluginDialect]
    PLUGIN_DIALECT_CURSOR: _ClassVar[PluginDialect]
    PLUGIN_DIALECT_CODEX: _ClassVar[PluginDialect]
PLUGIN_DIALECT_UNSPECIFIED: PluginDialect
PLUGIN_DIALECT_AGENT_PLUGINS: PluginDialect
PLUGIN_DIALECT_CLAUDE: PluginDialect
PLUGIN_DIALECT_CURSOR: PluginDialect
PLUGIN_DIALECT_CODEX: PluginDialect

class PluginSpec(_message.Message):
    __slots__ = ("name", "version", "description", "author", "homepage", "repository", "license", "keywords", "dialect")
    NAME_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    AUTHOR_FIELD_NUMBER: _ClassVar[int]
    HOMEPAGE_FIELD_NUMBER: _ClassVar[int]
    REPOSITORY_FIELD_NUMBER: _ClassVar[int]
    LICENSE_FIELD_NUMBER: _ClassVar[int]
    KEYWORDS_FIELD_NUMBER: _ClassVar[int]
    DIALECT_FIELD_NUMBER: _ClassVar[int]
    name: str
    version: str
    description: str
    author: PluginAuthor
    homepage: str
    repository: str
    license: str
    keywords: _containers.RepeatedScalarFieldContainer[str]
    dialect: PluginDialect
    def __init__(self, name: _Optional[str] = ..., version: _Optional[str] = ..., description: _Optional[str] = ..., author: _Optional[_Union[PluginAuthor, _Mapping]] = ..., homepage: _Optional[str] = ..., repository: _Optional[str] = ..., license: _Optional[str] = ..., keywords: _Optional[_Iterable[str]] = ..., dialect: _Optional[_Union[PluginDialect, str]] = ...) -> None: ...

class PluginAuthor(_message.Message):
    __slots__ = ("name", "email", "url")
    NAME_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    name: str
    email: str
    url: str
    def __init__(self, name: _Optional[str] = ..., email: _Optional[str] = ..., url: _Optional[str] = ...) -> None: ...
