import datetime

from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from ai.stigmer.iam.grant.v1 import api_pb2 as _api_pb2
from ai.stigmer.iam.grant.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.iam.identityaccount.v1 import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AccessChange(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    access_change_unspecified: _ClassVar[AccessChange]
    granted: _ClassVar[AccessChange]
    revoked: _ClassVar[AccessChange]

class AccessChangeCause(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    access_change_cause_unspecified: _ClassVar[AccessChangeCause]
    grant: _ClassVar[AccessChangeCause]
    revoke: _ClassVar[AccessChangeCause]
    structural: _ClassVar[AccessChangeCause]
    organization_access_revoked: _ClassVar[AccessChangeCause]
    left_organization: _ClassVar[AccessChangeCause]
    resource_deleted: _ClassVar[AccessChangeCause]
    organization_created: _ClassVar[AccessChangeCause]
    first_sign_in: _ClassVar[AccessChangeCause]
    role_reconciliation: _ClassVar[AccessChangeCause]
    operator_ownership: _ClassVar[AccessChangeCause]
    service_account_created: _ClassVar[AccessChangeCause]
access_change_unspecified: AccessChange
granted: AccessChange
revoked: AccessChange
access_change_cause_unspecified: AccessChangeCause
grant: AccessChangeCause
revoke: AccessChangeCause
structural: AccessChangeCause
organization_access_revoked: AccessChangeCause
left_organization: AccessChangeCause
resource_deleted: AccessChangeCause
organization_created: AccessChangeCause
first_sign_in: AccessChangeCause
role_reconciliation: AccessChangeCause
operator_ownership: AccessChangeCause
service_account_created: AccessChangeCause

class ApiResourceRefView(_message.Message):
    __slots__ = ("kind", "id", "relation", "name", "email", "slug", "avatar", "members", "teams", "identity_origin")
    KIND_FIELD_NUMBER: _ClassVar[int]
    ID_FIELD_NUMBER: _ClassVar[int]
    RELATION_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    AVATAR_FIELD_NUMBER: _ClassVar[int]
    MEMBERS_FIELD_NUMBER: _ClassVar[int]
    TEAMS_FIELD_NUMBER: _ClassVar[int]
    IDENTITY_ORIGIN_FIELD_NUMBER: _ClassVar[int]
    kind: str
    id: str
    relation: str
    name: str
    email: str
    slug: str
    avatar: str
    members: _containers.RepeatedCompositeFieldContainer[ApiResourceRefView]
    teams: _containers.RepeatedCompositeFieldContainer[ApiResourceRefView]
    identity_origin: IdentityOrigin
    def __init__(self, kind: _Optional[str] = ..., id: _Optional[str] = ..., relation: _Optional[str] = ..., name: _Optional[str] = ..., email: _Optional[str] = ..., slug: _Optional[str] = ..., avatar: _Optional[str] = ..., members: _Optional[_Iterable[_Union[ApiResourceRefView, _Mapping]]] = ..., teams: _Optional[_Iterable[_Union[ApiResourceRefView, _Mapping]]] = ..., identity_origin: _Optional[_Union[IdentityOrigin, _Mapping]] = ...) -> None: ...

class IdentityOrigin(_message.Message):
    __slots__ = ("provisioning_mode", "provider_display_name")
    PROVISIONING_MODE_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    provisioning_mode: _enum_pb2.IdentityAccountProvisioningMode
    provider_display_name: str
    def __init__(self, provisioning_mode: _Optional[_Union[_enum_pb2.IdentityAccountProvisioningMode, str]] = ..., provider_display_name: _Optional[str] = ...) -> None: ...

class GrantId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class PrincipalResourceInput(_message.Message):
    __slots__ = ("principal", "resource")
    PRINCIPAL_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    principal: _spec_pb2.ApiResourceRef
    resource: _spec_pb2.ApiResourceRef
    def __init__(self, principal: _Optional[_Union[_spec_pb2.ApiResourceRef, _Mapping]] = ..., resource: _Optional[_Union[_spec_pb2.ApiResourceRef, _Mapping]] = ...) -> None: ...

class ResourcePrincipalsInput(_message.Message):
    __slots__ = ("resource", "principals")
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    PRINCIPALS_FIELD_NUMBER: _ClassVar[int]
    resource: _spec_pb2.ApiResourceRef
    principals: _containers.RepeatedCompositeFieldContainer[_spec_pb2.ApiResourceRef]
    def __init__(self, resource: _Optional[_Union[_spec_pb2.ApiResourceRef, _Mapping]] = ..., principals: _Optional[_Iterable[_Union[_spec_pb2.ApiResourceRef, _Mapping]]] = ...) -> None: ...

class RevokeOrgAccessInput(_message.Message):
    __slots__ = ("identity_account_id", "org")
    IDENTITY_ACCOUNT_ID_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    identity_account_id: str
    org: str
    def __init__(self, identity_account_id: _Optional[str] = ..., org: _Optional[str] = ...) -> None: ...

class GrantsList(_message.Message):
    __slots__ = ("entries",)
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.Grant]
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.Grant, _Mapping]]] = ...) -> None: ...

class ListResourceAccessInput(_message.Message):
    __slots__ = ("resource", "include_inherited")
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_INHERITED_FIELD_NUMBER: _ClassVar[int]
    resource: _spec_pb2.ApiResourceRef
    include_inherited: bool
    def __init__(self, resource: _Optional[_Union[_spec_pb2.ApiResourceRef, _Mapping]] = ..., include_inherited: bool = ...) -> None: ...

class ResourceAccessByPrincipalList(_message.Message):
    __slots__ = ("entries",)
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[PrincipalAccess]
    def __init__(self, entries: _Optional[_Iterable[_Union[PrincipalAccess, _Mapping]]] = ...) -> None: ...

class PrincipalAccess(_message.Message):
    __slots__ = ("principal", "roles")
    PRINCIPAL_FIELD_NUMBER: _ClassVar[int]
    ROLES_FIELD_NUMBER: _ClassVar[int]
    principal: ApiResourceRefView
    roles: _containers.RepeatedCompositeFieldContainer[RoleGrant]
    def __init__(self, principal: _Optional[_Union[ApiResourceRefView, _Mapping]] = ..., roles: _Optional[_Iterable[_Union[RoleGrant, _Mapping]]] = ...) -> None: ...

class RoleGrant(_message.Message):
    __slots__ = ("role", "owner_resource", "is_inherited")
    ROLE_FIELD_NUMBER: _ClassVar[int]
    OWNER_RESOURCE_FIELD_NUMBER: _ClassVar[int]
    IS_INHERITED_FIELD_NUMBER: _ClassVar[int]
    role: RoleInfo
    owner_resource: _spec_pb2.ApiResourceRef
    is_inherited: bool
    def __init__(self, role: _Optional[_Union[RoleInfo, _Mapping]] = ..., owner_resource: _Optional[_Union[_spec_pb2.ApiResourceRef, _Mapping]] = ..., is_inherited: bool = ...) -> None: ...

class ResourceAccessByRoleList(_message.Message):
    __slots__ = ("entries",)
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[RoleAccess]
    def __init__(self, entries: _Optional[_Iterable[_Union[RoleAccess, _Mapping]]] = ...) -> None: ...

class RoleAccess(_message.Message):
    __slots__ = ("role", "principals")
    ROLE_FIELD_NUMBER: _ClassVar[int]
    PRINCIPALS_FIELD_NUMBER: _ClassVar[int]
    role: RoleGrant
    principals: _containers.RepeatedCompositeFieldContainer[ApiResourceRefView]
    def __init__(self, role: _Optional[_Union[RoleGrant, _Mapping]] = ..., principals: _Optional[_Iterable[_Union[ApiResourceRefView, _Mapping]]] = ...) -> None: ...

class RoleInfo(_message.Message):
    __slots__ = ("id", "code", "name", "description")
    ID_FIELD_NUMBER: _ClassVar[int]
    CODE_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    id: str
    code: str
    name: str
    description: str
    def __init__(self, id: _Optional[str] = ..., code: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ...) -> None: ...

class PrincipalResourceRoles(_message.Message):
    __slots__ = ("roles",)
    ROLES_FIELD_NUMBER: _ClassVar[int]
    roles: _containers.RepeatedCompositeFieldContainer[RoleInfo]
    def __init__(self, roles: _Optional[_Iterable[_Union[RoleInfo, _Mapping]]] = ...) -> None: ...

class CheckAuthorizationInput(_message.Message):
    __slots__ = ("grant", "contextual_grants")
    GRANT_FIELD_NUMBER: _ClassVar[int]
    CONTEXTUAL_GRANTS_FIELD_NUMBER: _ClassVar[int]
    grant: _spec_pb2.GrantSpec
    contextual_grants: _containers.RepeatedCompositeFieldContainer[_spec_pb2.GrantSpec]
    def __init__(self, grant: _Optional[_Union[_spec_pb2.GrantSpec, _Mapping]] = ..., contextual_grants: _Optional[_Iterable[_Union[_spec_pb2.GrantSpec, _Mapping]]] = ...) -> None: ...

class CheckAuthorizationResult(_message.Message):
    __slots__ = ("is_authorized",)
    IS_AUTHORIZED_FIELD_NUMBER: _ClassVar[int]
    is_authorized: bool
    def __init__(self, is_authorized: bool = ...) -> None: ...

class CheckMyPermissionInput(_message.Message):
    __slots__ = ("resource", "relation", "contextual_grants")
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    RELATION_FIELD_NUMBER: _ClassVar[int]
    CONTEXTUAL_GRANTS_FIELD_NUMBER: _ClassVar[int]
    resource: _spec_pb2.ApiResourceRef
    relation: str
    contextual_grants: _containers.RepeatedCompositeFieldContainer[_spec_pb2.GrantSpec]
    def __init__(self, resource: _Optional[_Union[_spec_pb2.ApiResourceRef, _Mapping]] = ..., relation: _Optional[str] = ..., contextual_grants: _Optional[_Iterable[_Union[_spec_pb2.GrantSpec, _Mapping]]] = ...) -> None: ...

class ListAuthorizedResourceIdsInput(_message.Message):
    __slots__ = ("principal", "resource_kind", "relation", "contextual_grants")
    PRINCIPAL_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_KIND_FIELD_NUMBER: _ClassVar[int]
    RELATION_FIELD_NUMBER: _ClassVar[int]
    CONTEXTUAL_GRANTS_FIELD_NUMBER: _ClassVar[int]
    principal: _spec_pb2.ApiResourceRef
    resource_kind: str
    relation: str
    contextual_grants: _containers.RepeatedCompositeFieldContainer[_spec_pb2.GrantSpec]
    def __init__(self, principal: _Optional[_Union[_spec_pb2.ApiResourceRef, _Mapping]] = ..., resource_kind: _Optional[str] = ..., relation: _Optional[str] = ..., contextual_grants: _Optional[_Iterable[_Union[_spec_pb2.GrantSpec, _Mapping]]] = ...) -> None: ...

class AuthorizedResourceIdsList(_message.Message):
    __slots__ = ("resource_ids",)
    RESOURCE_IDS_FIELD_NUMBER: _ClassVar[int]
    resource_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, resource_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class ListAuthorizedPrincipalIdsInput(_message.Message):
    __slots__ = ("resource", "principal_kind", "relation", "contextual_grants")
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    PRINCIPAL_KIND_FIELD_NUMBER: _ClassVar[int]
    RELATION_FIELD_NUMBER: _ClassVar[int]
    CONTEXTUAL_GRANTS_FIELD_NUMBER: _ClassVar[int]
    resource: _spec_pb2.ApiResourceRef
    principal_kind: str
    relation: str
    contextual_grants: _containers.RepeatedCompositeFieldContainer[_spec_pb2.GrantSpec]
    def __init__(self, resource: _Optional[_Union[_spec_pb2.ApiResourceRef, _Mapping]] = ..., principal_kind: _Optional[str] = ..., relation: _Optional[str] = ..., contextual_grants: _Optional[_Iterable[_Union[_spec_pb2.GrantSpec, _Mapping]]] = ...) -> None: ...

class AuthorizedPrincipalIdsList(_message.Message):
    __slots__ = ("principal_ids",)
    PRINCIPAL_IDS_FIELD_NUMBER: _ClassVar[int]
    principal_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, principal_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class GetPrincipalsCountInput(_message.Message):
    __slots__ = ("org", "principal_kind")
    ORG_FIELD_NUMBER: _ClassVar[int]
    PRINCIPAL_KIND_FIELD_NUMBER: _ClassVar[int]
    org: str
    principal_kind: str
    def __init__(self, org: _Optional[str] = ..., principal_kind: _Optional[str] = ...) -> None: ...

class PrincipalsCount(_message.Message):
    __slots__ = ("count",)
    COUNT_FIELD_NUMBER: _ClassVar[int]
    count: int
    def __init__(self, count: _Optional[int] = ...) -> None: ...

class ListAccessHistoryInput(_message.Message):
    __slots__ = ("org", "page_size", "page_token", "after_sequence")
    ORG_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    AFTER_SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    org: str
    page_size: int
    page_token: str
    after_sequence: int
    def __init__(self, org: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., after_sequence: _Optional[int] = ...) -> None: ...

class AccessHistoryPage(_message.Message):
    __slots__ = ("entries", "next_page_token", "oldest_sequence", "retention_days")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    OLDEST_SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    RETENTION_DAYS_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[AccessHistoryEntry]
    next_page_token: str
    oldest_sequence: int
    retention_days: int
    def __init__(self, entries: _Optional[_Iterable[_Union[AccessHistoryEntry, _Mapping]]] = ..., next_page_token: _Optional[str] = ..., oldest_sequence: _Optional[int] = ..., retention_days: _Optional[int] = ...) -> None: ...

class AccessHistoryEntry(_message.Message):
    __slots__ = ("sequence", "occurred_at", "change", "cause", "actor", "actor_class", "principal", "role", "resource")
    SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    OCCURRED_AT_FIELD_NUMBER: _ClassVar[int]
    CHANGE_FIELD_NUMBER: _ClassVar[int]
    CAUSE_FIELD_NUMBER: _ClassVar[int]
    ACTOR_FIELD_NUMBER: _ClassVar[int]
    ACTOR_CLASS_FIELD_NUMBER: _ClassVar[int]
    PRINCIPAL_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    sequence: int
    occurred_at: _timestamp_pb2.Timestamp
    change: AccessChange
    cause: AccessChangeCause
    actor: ApiResourceRefView
    actor_class: str
    principal: ApiResourceRefView
    role: RoleInfo
    resource: _io_pb2.ApiResourceReference
    def __init__(self, sequence: _Optional[int] = ..., occurred_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., change: _Optional[_Union[AccessChange, str]] = ..., cause: _Optional[_Union[AccessChangeCause, str]] = ..., actor: _Optional[_Union[ApiResourceRefView, _Mapping]] = ..., actor_class: _Optional[str] = ..., principal: _Optional[_Union[ApiResourceRefView, _Mapping]] = ..., role: _Optional[_Union[RoleInfo, _Mapping]] = ..., resource: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ...) -> None: ...
