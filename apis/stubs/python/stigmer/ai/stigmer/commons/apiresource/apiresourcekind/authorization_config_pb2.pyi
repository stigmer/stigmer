from ai.stigmer.iam.v1 import enum_pb2 as _enum_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AuthorizationScopeType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    AUTHORIZATION_SCOPE_TYPE_UNSPECIFIED: _ClassVar[AuthorizationScopeType]
    AUTHORIZATION_SCOPE_TYPE_PLATFORM: _ClassVar[AuthorizationScopeType]
    AUTHORIZATION_SCOPE_TYPE_ORGANIZATION: _ClassVar[AuthorizationScopeType]
    AUTHORIZATION_SCOPE_TYPE_PARENT: _ClassVar[AuthorizationScopeType]
    AUTHORIZATION_SCOPE_TYPE_OWNER_ONLY: _ClassVar[AuthorizationScopeType]
    AUTHORIZATION_SCOPE_TYPE_NONE: _ClassVar[AuthorizationScopeType]

class OwnerAttributionType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    OWNER_ATTRIBUTION_TYPE_UNSPECIFIED: _ClassVar[OwnerAttributionType]
    OWNER_ATTRIBUTION_TYPE_DIRECT: _ClassVar[OwnerAttributionType]
    OWNER_ATTRIBUTION_TYPE_INHERITED: _ClassVar[OwnerAttributionType]
    OWNER_ATTRIBUTION_TYPE_SELF: _ClassVar[OwnerAttributionType]
    OWNER_ATTRIBUTION_TYPE_NONE: _ClassVar[OwnerAttributionType]
AUTHORIZATION_SCOPE_TYPE_UNSPECIFIED: AuthorizationScopeType
AUTHORIZATION_SCOPE_TYPE_PLATFORM: AuthorizationScopeType
AUTHORIZATION_SCOPE_TYPE_ORGANIZATION: AuthorizationScopeType
AUTHORIZATION_SCOPE_TYPE_PARENT: AuthorizationScopeType
AUTHORIZATION_SCOPE_TYPE_OWNER_ONLY: AuthorizationScopeType
AUTHORIZATION_SCOPE_TYPE_NONE: AuthorizationScopeType
OWNER_ATTRIBUTION_TYPE_UNSPECIFIED: OwnerAttributionType
OWNER_ATTRIBUTION_TYPE_DIRECT: OwnerAttributionType
OWNER_ATTRIBUTION_TYPE_INHERITED: OwnerAttributionType
OWNER_ATTRIBUTION_TYPE_SELF: OwnerAttributionType
OWNER_ATTRIBUTION_TYPE_NONE: OwnerAttributionType

class VisibilityConfig(_message.Message):
    __slots__ = ("supports_public", "supports_platform")
    SUPPORTS_PUBLIC_FIELD_NUMBER: _ClassVar[int]
    SUPPORTS_PLATFORM_FIELD_NUMBER: _ClassVar[int]
    supports_public: bool
    supports_platform: bool
    def __init__(self, supports_public: bool = ..., supports_platform: bool = ...) -> None: ...

class ParentRelationConfig(_message.Message):
    __slots__ = ("kind", "relation", "spec_field")
    KIND_FIELD_NUMBER: _ClassVar[int]
    RELATION_FIELD_NUMBER: _ClassVar[int]
    SPEC_FIELD_FIELD_NUMBER: _ClassVar[int]
    kind: str
    relation: str
    spec_field: str
    def __init__(self, kind: _Optional[str] = ..., relation: _Optional[str] = ..., spec_field: _Optional[str] = ...) -> None: ...

class AuthorizationConfig(_message.Message):
    __slots__ = ("scope_type", "owner_type", "parent", "additional_parents", "visibility", "requires_creator_tuple", "grantable_roles")
    SCOPE_TYPE_FIELD_NUMBER: _ClassVar[int]
    OWNER_TYPE_FIELD_NUMBER: _ClassVar[int]
    PARENT_FIELD_NUMBER: _ClassVar[int]
    ADDITIONAL_PARENTS_FIELD_NUMBER: _ClassVar[int]
    VISIBILITY_FIELD_NUMBER: _ClassVar[int]
    REQUIRES_CREATOR_TUPLE_FIELD_NUMBER: _ClassVar[int]
    GRANTABLE_ROLES_FIELD_NUMBER: _ClassVar[int]
    scope_type: AuthorizationScopeType
    owner_type: OwnerAttributionType
    parent: ParentRelationConfig
    additional_parents: _containers.RepeatedCompositeFieldContainer[ParentRelationConfig]
    visibility: VisibilityConfig
    requires_creator_tuple: bool
    grantable_roles: _containers.RepeatedScalarFieldContainer[_enum_pb2.IamRole]
    def __init__(self, scope_type: _Optional[_Union[AuthorizationScopeType, str]] = ..., owner_type: _Optional[_Union[OwnerAttributionType, str]] = ..., parent: _Optional[_Union[ParentRelationConfig, _Mapping]] = ..., additional_parents: _Optional[_Iterable[_Union[ParentRelationConfig, _Mapping]]] = ..., visibility: _Optional[_Union[VisibilityConfig, _Mapping]] = ..., requires_creator_tuple: bool = ..., grantable_roles: _Optional[_Iterable[_Union[_enum_pb2.IamRole, str]]] = ...) -> None: ...
