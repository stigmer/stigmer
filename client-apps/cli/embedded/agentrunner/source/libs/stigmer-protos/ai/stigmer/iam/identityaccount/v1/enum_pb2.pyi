from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class IdentityAccountProvisioningMode(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    identity_account_provisioning_mode_unspecified: _ClassVar[IdentityAccountProvisioningMode]
    direct: _ClassVar[IdentityAccountProvisioningMode]
    federated: _ClassVar[IdentityAccountProvisioningMode]
    machine: _ClassVar[IdentityAccountProvisioningMode]
    platform_client: _ClassVar[IdentityAccountProvisioningMode]
identity_account_provisioning_mode_unspecified: IdentityAccountProvisioningMode
direct: IdentityAccountProvisioningMode
federated: IdentityAccountProvisioningMode
machine: IdentityAccountProvisioningMode
platform_client: IdentityAccountProvisioningMode
