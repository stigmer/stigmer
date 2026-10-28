from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from ai.stigmer.iam.identityaccount.v1 import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class IdentityAccountSpec(_message.Message):
    __slots__ = ("idp_id", "email", "first_name", "last_name", "picture_url", "is_machine_account", "provisioning_mode", "federation_issuer_ref", "preferences")
    IDP_ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    FIRST_NAME_FIELD_NUMBER: _ClassVar[int]
    LAST_NAME_FIELD_NUMBER: _ClassVar[int]
    PICTURE_URL_FIELD_NUMBER: _ClassVar[int]
    IS_MACHINE_ACCOUNT_FIELD_NUMBER: _ClassVar[int]
    PROVISIONING_MODE_FIELD_NUMBER: _ClassVar[int]
    FEDERATION_ISSUER_REF_FIELD_NUMBER: _ClassVar[int]
    PREFERENCES_FIELD_NUMBER: _ClassVar[int]
    idp_id: str
    email: str
    first_name: str
    last_name: str
    picture_url: str
    is_machine_account: bool
    provisioning_mode: _enum_pb2.IdentityAccountProvisioningMode
    federation_issuer_ref: _io_pb2.ApiResourceReference
    preferences: IdentityAccountPreferences
    def __init__(self, idp_id: _Optional[str] = ..., email: _Optional[str] = ..., first_name: _Optional[str] = ..., last_name: _Optional[str] = ..., picture_url: _Optional[str] = ..., is_machine_account: bool = ..., provisioning_mode: _Optional[_Union[_enum_pb2.IdentityAccountProvisioningMode, str]] = ..., federation_issuer_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., preferences: _Optional[_Union[IdentityAccountPreferences, _Mapping]] = ...) -> None: ...

class IdentityAccountPreferences(_message.Message):
    __slots__ = ("standing_context", "default_harness", "default_stigmer_model", "memory_enabled", "default_auto_approve", "default_claude_model")
    STANDING_CONTEXT_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_HARNESS_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_STIGMER_MODEL_FIELD_NUMBER: _ClassVar[int]
    MEMORY_ENABLED_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_AUTO_APPROVE_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_CLAUDE_MODEL_FIELD_NUMBER: _ClassVar[int]
    standing_context: str
    default_harness: str
    default_stigmer_model: str
    memory_enabled: bool
    default_auto_approve: bool
    default_claude_model: str
    def __init__(self, standing_context: _Optional[str] = ..., default_harness: _Optional[str] = ..., default_stigmer_model: _Optional[str] = ..., memory_enabled: bool = ..., default_auto_approve: bool = ..., default_claude_model: _Optional[str] = ...) -> None: ...
