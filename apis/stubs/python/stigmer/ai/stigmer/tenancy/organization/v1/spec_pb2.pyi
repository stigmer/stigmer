from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from ai.stigmer.tenancy.organization.v1 import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class OrganizationSpec(_message.Message):
    __slots__ = ("description", "logo_url", "management_mode", "identity_provider_ref", "external_org_id", "is_personal", "preferences")
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    LOGO_URL_FIELD_NUMBER: _ClassVar[int]
    MANAGEMENT_MODE_FIELD_NUMBER: _ClassVar[int]
    IDENTITY_PROVIDER_REF_FIELD_NUMBER: _ClassVar[int]
    EXTERNAL_ORG_ID_FIELD_NUMBER: _ClassVar[int]
    IS_PERSONAL_FIELD_NUMBER: _ClassVar[int]
    PREFERENCES_FIELD_NUMBER: _ClassVar[int]
    description: str
    logo_url: str
    management_mode: _enum_pb2.ManagementMode
    identity_provider_ref: _io_pb2.ApiResourceReference
    external_org_id: str
    is_personal: bool
    preferences: OrganizationPreferences
    def __init__(self, description: _Optional[str] = ..., logo_url: _Optional[str] = ..., management_mode: _Optional[_Union[_enum_pb2.ManagementMode, str]] = ..., identity_provider_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., external_org_id: _Optional[str] = ..., is_personal: bool = ..., preferences: _Optional[_Union[OrganizationPreferences, _Mapping]] = ...) -> None: ...

class OrganizationPreferences(_message.Message):
    __slots__ = ("standing_context", "memory_enabled")
    STANDING_CONTEXT_FIELD_NUMBER: _ClassVar[int]
    MEMORY_ENABLED_FIELD_NUMBER: _ClassVar[int]
    standing_context: str
    memory_enabled: bool
    def __init__(self, standing_context: _Optional[str] = ..., memory_enabled: bool = ...) -> None: ...
