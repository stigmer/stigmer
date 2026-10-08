from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class OAuthAppOverride(_message.Message):
    __slots__ = ("resource_id", "resource_kind", "org", "oauth_app_id")
    RESOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_KIND_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    OAUTH_APP_ID_FIELD_NUMBER: _ClassVar[int]
    resource_id: str
    resource_kind: str
    org: str
    oauth_app_id: str
    def __init__(self, resource_id: _Optional[str] = ..., resource_kind: _Optional[str] = ..., org: _Optional[str] = ..., oauth_app_id: _Optional[str] = ...) -> None: ...
