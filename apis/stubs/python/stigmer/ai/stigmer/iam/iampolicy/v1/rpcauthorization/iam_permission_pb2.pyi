from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class ApiResourceIamPermission(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    unspecified: _ClassVar[ApiResourceIamPermission]
    create: _ClassVar[ApiResourceIamPermission]
    can_delete: _ClassVar[ApiResourceIamPermission]
    can_view: _ClassVar[ApiResourceIamPermission]
    can_edit: _ClassVar[ApiResourceIamPermission]
    operator: _ClassVar[ApiResourceIamPermission]
    platform: _ClassVar[ApiResourceIamPermission]
    login_to_back_office: _ClassVar[ApiResourceIamPermission]
    can_grant_access: _ClassVar[ApiResourceIamPermission]
    can_view_access: _ClassVar[ApiResourceIamPermission]
    owner: _ClassVar[ApiResourceIamPermission]
    member: _ClassVar[ApiResourceIamPermission]
    identity_account: _ClassVar[ApiResourceIamPermission]
    organization: _ClassVar[ApiResourceIamPermission]
    session: _ClassVar[ApiResourceIamPermission]
    agent: _ClassVar[ApiResourceIamPermission]
    can_create_agent: _ClassVar[ApiResourceIamPermission]
    can_create_workflow: _ClassVar[ApiResourceIamPermission]
    can_create_session: _ClassVar[ApiResourceIamPermission]
    can_create_execution_in: _ClassVar[ApiResourceIamPermission]
    can_create_instance: _ClassVar[ApiResourceIamPermission]
    can_create_skill: _ClassVar[ApiResourceIamPermission]
    can_execute: _ClassVar[ApiResourceIamPermission]
unspecified: ApiResourceIamPermission
create: ApiResourceIamPermission
can_delete: ApiResourceIamPermission
can_view: ApiResourceIamPermission
can_edit: ApiResourceIamPermission
operator: ApiResourceIamPermission
platform: ApiResourceIamPermission
login_to_back_office: ApiResourceIamPermission
can_grant_access: ApiResourceIamPermission
can_view_access: ApiResourceIamPermission
owner: ApiResourceIamPermission
member: ApiResourceIamPermission
identity_account: ApiResourceIamPermission
organization: ApiResourceIamPermission
session: ApiResourceIamPermission
agent: ApiResourceIamPermission
can_create_agent: ApiResourceIamPermission
can_create_workflow: ApiResourceIamPermission
can_create_session: ApiResourceIamPermission
can_create_execution_in: ApiResourceIamPermission
can_create_instance: ApiResourceIamPermission
can_create_skill: ApiResourceIamPermission
can_execute: ApiResourceIamPermission
