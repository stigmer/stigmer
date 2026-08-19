from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from ai.stigmer.iam.identityaccount.v1 import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class IdentityAccountSpec(_message.Message):
    __slots__ = ("idp_id", "email", "first_name", "last_name", "picture_url", "is_machine_account", "provisioning_mode", "identity_provider_ref", "preferences")
    IDP_ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    FIRST_NAME_FIELD_NUMBER: _ClassVar[int]
    LAST_NAME_FIELD_NUMBER: _ClassVar[int]
    PICTURE_URL_FIELD_NUMBER: _ClassVar[int]
    IS_MACHINE_ACCOUNT_FIELD_NUMBER: _ClassVar[int]
    PROVISIONING_MODE_FIELD_NUMBER: _ClassVar[int]
    IDENTITY_PROVIDER_REF_FIELD_NUMBER: _ClassVar[int]
    PREFERENCES_FIELD_NUMBER: _ClassVar[int]
    idp_id: str
    email: str
    first_name: str
    last_name: str
    picture_url: str
    is_machine_account: bool
    provisioning_mode: _enum_pb2.IdentityAccountProvisioningMode
    identity_provider_ref: _io_pb2.ApiResourceReference
    preferences: IdentityAccountPreferences
    def __init__(self, idp_id: _Optional[str] = ..., email: _Optional[str] = ..., first_name: _Optional[str] = ..., last_name: _Optional[str] = ..., picture_url: _Optional[str] = ..., is_machine_account: bool = ..., provisioning_mode: _Optional[_Union[_enum_pb2.IdentityAccountProvisioningMode, str]] = ..., identity_provider_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., preferences: _Optional[_Union[IdentityAccountPreferences, _Mapping]] = ...) -> None: ...

class IdentityAccountPreferences(_message.Message):
    __slots__ = ("standing_context", "default_harness", "default_native_model", "default_cursor_model", "memory_enabled")
    STANDING_CONTEXT_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_HARNESS_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_NATIVE_MODEL_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_CURSOR_MODEL_FIELD_NUMBER: _ClassVar[int]
    MEMORY_ENABLED_FIELD_NUMBER: _ClassVar[int]
    standing_context: str
    default_harness: str
    default_native_model: str
    default_cursor_model: str
    memory_enabled: bool
    def __init__(self, standing_context: _Optional[str] = ..., default_harness: _Optional[str] = ..., default_native_model: _Optional[str] = ..., default_cursor_model: _Optional[str] = ..., memory_enabled: bool = ...) -> None: ...
