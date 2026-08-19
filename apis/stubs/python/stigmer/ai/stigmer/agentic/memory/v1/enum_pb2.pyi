from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class MemoryLifecycleState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    lifecycle_state_unspecified: _ClassVar[MemoryLifecycleState]
    lifecycle_state_proposed: _ClassVar[MemoryLifecycleState]
    lifecycle_state_confirmed: _ClassVar[MemoryLifecycleState]
    lifecycle_state_rejected: _ClassVar[MemoryLifecycleState]
lifecycle_state_unspecified: MemoryLifecycleState
lifecycle_state_proposed: MemoryLifecycleState
lifecycle_state_confirmed: MemoryLifecycleState
lifecycle_state_rejected: MemoryLifecycleState
