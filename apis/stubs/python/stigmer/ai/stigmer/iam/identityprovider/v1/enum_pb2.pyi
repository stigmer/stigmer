from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class IdentityProviderLifecycleState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    identity_provider_lifecycle_state_unspecified: _ClassVar[IdentityProviderLifecycleState]
    active: _ClassVar[IdentityProviderLifecycleState]
    suspended: _ClassVar[IdentityProviderLifecycleState]
    revoked: _ClassVar[IdentityProviderLifecycleState]
identity_provider_lifecycle_state_unspecified: IdentityProviderLifecycleState
active: IdentityProviderLifecycleState
suspended: IdentityProviderLifecycleState
revoked: IdentityProviderLifecycleState
