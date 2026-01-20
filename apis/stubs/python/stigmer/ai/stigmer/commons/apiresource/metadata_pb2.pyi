from ai.stigmer.commons.apiresource import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ApiResourceMetadata(_message.Message):
    __slots__ = ("name", "slug", "id", "org", "owner_scope", "labels", "annotations", "tags", "version")
    class LabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    class AnnotationsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    NAME_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    ID_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    OWNER_SCOPE_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    ANNOTATIONS_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    name: str
    slug: str
    id: str
    org: str
    owner_scope: _enum_pb2.ApiResourceOwnerScope
    labels: _containers.ScalarMap[str, str]
    annotations: _containers.ScalarMap[str, str]
    tags: _containers.RepeatedScalarFieldContainer[str]
    version: ApiResourceMetadataVersion
    def __init__(self, name: _Optional[str] = ..., slug: _Optional[str] = ..., id: _Optional[str] = ..., org: _Optional[str] = ..., owner_scope: _Optional[_Union[_enum_pb2.ApiResourceOwnerScope, str]] = ..., labels: _Optional[_Mapping[str, str]] = ..., annotations: _Optional[_Mapping[str, str]] = ..., tags: _Optional[_Iterable[str]] = ..., version: _Optional[_Union[ApiResourceMetadataVersion, _Mapping]] = ...) -> None: ...

class ApiResourceMetadataVersion(_message.Message):
    __slots__ = ("id", "message", "previous_version_id")
    ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    PREVIOUS_VERSION_ID_FIELD_NUMBER: _ClassVar[int]
    id: str
    message: str
    previous_version_id: str
    def __init__(self, id: _Optional[str] = ..., message: _Optional[str] = ..., previous_version_id: _Optional[str] = ...) -> None: ...
