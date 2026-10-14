from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from ai.stigmer.iam.v1 import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class OrganizationSpec(_message.Message):
    __slots__ = ("description", "logo_url", "external_id", "preferences", "parent_org", "policies", "embedding")
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    LOGO_URL_FIELD_NUMBER: _ClassVar[int]
    EXTERNAL_ID_FIELD_NUMBER: _ClassVar[int]
    PREFERENCES_FIELD_NUMBER: _ClassVar[int]
    PARENT_ORG_FIELD_NUMBER: _ClassVar[int]
    POLICIES_FIELD_NUMBER: _ClassVar[int]
    EMBEDDING_FIELD_NUMBER: _ClassVar[int]
    description: str
    logo_url: str
    external_id: str
    preferences: OrganizationPreferences
    parent_org: str
    policies: OrganizationPolicies
    embedding: OrganizationEmbedding
    def __init__(self, description: _Optional[str] = ..., logo_url: _Optional[str] = ..., external_id: _Optional[str] = ..., preferences: _Optional[_Union[OrganizationPreferences, _Mapping]] = ..., parent_org: _Optional[str] = ..., policies: _Optional[_Union[OrganizationPolicies, _Mapping]] = ..., embedding: _Optional[_Union[OrganizationEmbedding, _Mapping]] = ...) -> None: ...

class OrganizationEmbedding(_message.Message):
    __slots__ = ("allowed_origins", "create_accounts_on_sign_in", "sign_in_role", "vaults")
    ALLOWED_ORIGINS_FIELD_NUMBER: _ClassVar[int]
    CREATE_ACCOUNTS_ON_SIGN_IN_FIELD_NUMBER: _ClassVar[int]
    SIGN_IN_ROLE_FIELD_NUMBER: _ClassVar[int]
    VAULTS_FIELD_NUMBER: _ClassVar[int]
    allowed_origins: _containers.RepeatedScalarFieldContainer[str]
    create_accounts_on_sign_in: bool
    sign_in_role: _enum_pb2.IamRole
    vaults: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    def __init__(self, allowed_origins: _Optional[_Iterable[str]] = ..., create_accounts_on_sign_in: bool = ..., sign_in_role: _Optional[_Union[_enum_pb2.IamRole, str]] = ..., vaults: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ...) -> None: ...

class OrganizationPreferences(_message.Message):
    __slots__ = ("standing_context", "memory_enabled")
    STANDING_CONTEXT_FIELD_NUMBER: _ClassVar[int]
    MEMORY_ENABLED_FIELD_NUMBER: _ClassVar[int]
    standing_context: str
    memory_enabled: bool
    def __init__(self, standing_context: _Optional[str] = ..., memory_enabled: bool = ...) -> None: ...

class OrganizationPolicies(_message.Message):
    __slots__ = ("members_can_create_agents",)
    MEMBERS_CAN_CREATE_AGENTS_FIELD_NUMBER: _ClassVar[int]
    members_can_create_agents: bool
    def __init__(self, members_can_create_agents: bool = ...) -> None: ...
