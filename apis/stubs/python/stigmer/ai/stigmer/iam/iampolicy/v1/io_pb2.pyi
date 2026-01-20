from ai.stigmer.iam.iampolicy.v1 import api_pb2 as _api_pb2
from ai.stigmer.iam.iampolicy.v1 import spec_pb2 as _spec_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ApiResourceRefView(_message.Message):
    __slots__ = ("kind", "id", "relation", "name", "email", "slug", "avatar", "members", "teams")
    KIND_FIELD_NUMBER: _ClassVar[int]
    ID_FIELD_NUMBER: _ClassVar[int]
    RELATION_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    AVATAR_FIELD_NUMBER: _ClassVar[int]
    MEMBERS_FIELD_NUMBER: _ClassVar[int]
    TEAMS_FIELD_NUMBER: _ClassVar[int]
    kind: str
    id: str
    relation: str
    name: str
    email: str
    slug: str
    avatar: str
    members: _containers.RepeatedCompositeFieldContainer[ApiResourceRefView]
    teams: _containers.RepeatedCompositeFieldContainer[ApiResourceRefView]
    def __init__(self, kind: _Optional[str] = ..., id: _Optional[str] = ..., relation: _Optional[str] = ..., name: _Optional[str] = ..., email: _Optional[str] = ..., slug: _Optional[str] = ..., avatar: _Optional[str] = ..., members: _Optional[_Iterable[_Union[ApiResourceRefView, _Mapping]]] = ..., teams: _Optional[_Iterable[_Union[ApiResourceRefView, _Mapping]]] = ...) -> None: ...

class IamPolicyId(_message.Message):
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
    __slots__ = ("identity_account_id", "organization_id")
    IDENTITY_ACCOUNT_ID_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    identity_account_id: str
    organization_id: str
    def __init__(self, identity_account_id: _Optional[str] = ..., organization_id: _Optional[str] = ...) -> None: ...

class IamPoliciesList(_message.Message):
    __slots__ = ("entries",)
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.IamPolicy]
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.IamPolicy, _Mapping]]] = ...) -> None: ...

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
    __slots__ = ("policy", "contextual_policies")
    POLICY_FIELD_NUMBER: _ClassVar[int]
    CONTEXTUAL_POLICIES_FIELD_NUMBER: _ClassVar[int]
    policy: _spec_pb2.IamPolicySpec
    contextual_policies: _containers.RepeatedCompositeFieldContainer[_spec_pb2.IamPolicySpec]
    def __init__(self, policy: _Optional[_Union[_spec_pb2.IamPolicySpec, _Mapping]] = ..., contextual_policies: _Optional[_Iterable[_Union[_spec_pb2.IamPolicySpec, _Mapping]]] = ...) -> None: ...

class CheckAuthorizationResult(_message.Message):
    __slots__ = ("is_authorized",)
    IS_AUTHORIZED_FIELD_NUMBER: _ClassVar[int]
    is_authorized: bool
    def __init__(self, is_authorized: bool = ...) -> None: ...

class ListAuthorizedResourceIdsInput(_message.Message):
    __slots__ = ("principal", "resource_kind", "relation", "contextual_policies")
    PRINCIPAL_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_KIND_FIELD_NUMBER: _ClassVar[int]
    RELATION_FIELD_NUMBER: _ClassVar[int]
    CONTEXTUAL_POLICIES_FIELD_NUMBER: _ClassVar[int]
    principal: _spec_pb2.ApiResourceRef
    resource_kind: str
    relation: str
    contextual_policies: _containers.RepeatedCompositeFieldContainer[_spec_pb2.IamPolicySpec]
    def __init__(self, principal: _Optional[_Union[_spec_pb2.ApiResourceRef, _Mapping]] = ..., resource_kind: _Optional[str] = ..., relation: _Optional[str] = ..., contextual_policies: _Optional[_Iterable[_Union[_spec_pb2.IamPolicySpec, _Mapping]]] = ...) -> None: ...

class AuthorizedResourceIdsList(_message.Message):
    __slots__ = ("resource_ids",)
    RESOURCE_IDS_FIELD_NUMBER: _ClassVar[int]
    resource_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, resource_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class ListAuthorizedPrincipalIdsInput(_message.Message):
    __slots__ = ("resource", "principal_kind", "relation", "contextual_policies")
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    PRINCIPAL_KIND_FIELD_NUMBER: _ClassVar[int]
    RELATION_FIELD_NUMBER: _ClassVar[int]
    CONTEXTUAL_POLICIES_FIELD_NUMBER: _ClassVar[int]
    resource: _spec_pb2.ApiResourceRef
    principal_kind: str
    relation: str
    contextual_policies: _containers.RepeatedCompositeFieldContainer[_spec_pb2.IamPolicySpec]
    def __init__(self, resource: _Optional[_Union[_spec_pb2.ApiResourceRef, _Mapping]] = ..., principal_kind: _Optional[str] = ..., relation: _Optional[str] = ..., contextual_policies: _Optional[_Iterable[_Union[_spec_pb2.IamPolicySpec, _Mapping]]] = ...) -> None: ...

class AuthorizedPrincipalIdsList(_message.Message):
    __slots__ = ("principal_ids",)
    PRINCIPAL_IDS_FIELD_NUMBER: _ClassVar[int]
    principal_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, principal_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class GetPrincipalsCountInput(_message.Message):
    __slots__ = ("org_id", "principal_kind")
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    PRINCIPAL_KIND_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    principal_kind: str
    def __init__(self, org_id: _Optional[str] = ..., principal_kind: _Optional[str] = ...) -> None: ...

class PrincipalsCount(_message.Message):
    __slots__ = ("count",)
    COUNT_FIELD_NUMBER: _ClassVar[int]
    count: int
    def __init__(self, count: _Optional[int] = ...) -> None: ...
