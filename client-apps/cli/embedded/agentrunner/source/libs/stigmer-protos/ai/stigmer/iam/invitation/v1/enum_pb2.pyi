from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class InvitationState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    invitation_state_unspecified: _ClassVar[InvitationState]
    active: _ClassVar[InvitationState]
    expired: _ClassVar[InvitationState]
    revoked: _ClassVar[InvitationState]
    fully_redeemed: _ClassVar[InvitationState]
invitation_state_unspecified: InvitationState
active: InvitationState
expired: InvitationState
revoked: InvitationState
fully_redeemed: InvitationState
