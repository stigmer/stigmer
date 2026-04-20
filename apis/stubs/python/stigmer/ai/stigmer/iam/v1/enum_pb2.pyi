from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class IamPermission(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    unspecified: _ClassVar[IamPermission]
    can_view: _ClassVar[IamPermission]
    can_edit: _ClassVar[IamPermission]
    can_delete: _ClassVar[IamPermission]
    can_grant_access: _ClassVar[IamPermission]
    can_view_access: _ClassVar[IamPermission]
    can_create_agent: _ClassVar[IamPermission]
    can_create_workflow: _ClassVar[IamPermission]
    can_create_session: _ClassVar[IamPermission]
    can_create_skill: _ClassVar[IamPermission]
    can_create_project: _ClassVar[IamPermission]
    can_create_idp: _ClassVar[IamPermission]
    can_create_environment: _ClassVar[IamPermission]
    can_create_identity_account: _ClassVar[IamPermission]
    can_create_oauth_app: _ClassVar[IamPermission]
    can_create_platform_client: _ClassVar[IamPermission]
    can_create_execution_in: _ClassVar[IamPermission]
    can_create_instance: _ClassVar[IamPermission]
    can_execute: _ClassVar[IamPermission]
    can_read_secrets: _ClassVar[IamPermission]
    can_bootstrap_iam: _ClassVar[IamPermission]
    can_manage_identity_accounts: _ClassVar[IamPermission]
    can_update_execution_status: _ClassVar[IamPermission]
    login_to_back_office: _ClassVar[IamPermission]
    can_connect: _ClassVar[IamPermission]
    can_create_agent_runner: _ClassVar[IamPermission]

class IamRole(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    iam_role_unspecified: _ClassVar[IamRole]
    owner: _ClassVar[IamRole]
    admin: _ClassVar[IamRole]
    member: _ClassVar[IamRole]
    viewer: _ClassVar[IamRole]
unspecified: IamPermission
can_view: IamPermission
can_edit: IamPermission
can_delete: IamPermission
can_grant_access: IamPermission
can_view_access: IamPermission
can_create_agent: IamPermission
can_create_workflow: IamPermission
can_create_session: IamPermission
can_create_skill: IamPermission
can_create_project: IamPermission
can_create_idp: IamPermission
can_create_environment: IamPermission
can_create_identity_account: IamPermission
can_create_oauth_app: IamPermission
can_create_platform_client: IamPermission
can_create_execution_in: IamPermission
can_create_instance: IamPermission
can_execute: IamPermission
can_read_secrets: IamPermission
can_bootstrap_iam: IamPermission
can_manage_identity_accounts: IamPermission
can_update_execution_status: IamPermission
login_to_back_office: IamPermission
can_connect: IamPermission
can_create_agent_runner: IamPermission
iam_role_unspecified: IamRole
owner: IamRole
admin: IamRole
member: IamRole
viewer: IamRole
