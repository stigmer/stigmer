from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class OrganizationSpec(_message.Message):
    __slots__ = ("description", "logo_url", "external_id", "preferences", "parent_org")
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    LOGO_URL_FIELD_NUMBER: _ClassVar[int]
    EXTERNAL_ID_FIELD_NUMBER: _ClassVar[int]
    PREFERENCES_FIELD_NUMBER: _ClassVar[int]
    PARENT_ORG_FIELD_NUMBER: _ClassVar[int]
    description: str
    logo_url: str
    external_id: str
    preferences: OrganizationPreferences
    parent_org: str
    def __init__(self, description: _Optional[str] = ..., logo_url: _Optional[str] = ..., external_id: _Optional[str] = ..., preferences: _Optional[_Union[OrganizationPreferences, _Mapping]] = ..., parent_org: _Optional[str] = ...) -> None: ...

class OrganizationPreferences(_message.Message):
    __slots__ = ("standing_context", "memory_enabled")
    STANDING_CONTEXT_FIELD_NUMBER: _ClassVar[int]
    MEMORY_ENABLED_FIELD_NUMBER: _ClassVar[int]
    standing_context: str
    memory_enabled: bool
    def __init__(self, standing_context: _Optional[str] = ..., memory_enabled: bool = ...) -> None: ...
