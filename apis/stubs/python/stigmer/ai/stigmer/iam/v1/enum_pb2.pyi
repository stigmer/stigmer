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
    login_to_back_office: _ClassVar[IamPermission]
    can_connect: _ClassVar[IamPermission]
    can_create_runner: _ClassVar[IamPermission]
    can_delete_session: _ClassVar[IamPermission]
    can_view_billing: _ClassVar[IamPermission]
    can_manage_billing: _ClassVar[IamPermission]
    can_execute_billing_ops: _ClassVar[IamPermission]
    can_create_agent_share: _ClassVar[IamPermission]
    can_create_channel_app: _ClassVar[IamPermission]
    can_manage_model_pricing: _ClassVar[IamPermission]
    can_use_records: _ClassVar[IamPermission]
    can_create_datastore: _ClassVar[IamPermission]
    can_manage_cursor_accounts: _ClassVar[IamPermission]
    can_participate: _ClassVar[IamPermission]
    can_write_reserved_labels: _ClassVar[IamPermission]

class IamRole(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    iam_role_unspecified: _ClassVar[IamRole]
    owner: _ClassVar[IamRole]
    admin: _ClassVar[IamRole]
    member: _ClassVar[IamRole]
    viewer: _ClassVar[IamRole]
    participant: _ClassVar[IamRole]
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
login_to_back_office: IamPermission
can_connect: IamPermission
can_create_runner: IamPermission
can_delete_session: IamPermission
can_view_billing: IamPermission
can_manage_billing: IamPermission
can_execute_billing_ops: IamPermission
can_create_agent_share: IamPermission
can_create_channel_app: IamPermission
can_manage_model_pricing: IamPermission
can_use_records: IamPermission
can_create_datastore: IamPermission
can_manage_cursor_accounts: IamPermission
can_participate: IamPermission
can_write_reserved_labels: IamPermission
iam_role_unspecified: IamRole
owner: IamRole
admin: IamRole
member: IamRole
viewer: IamRole
participant: IamRole
