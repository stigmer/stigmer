from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class ManagementMode(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    management_mode_unspecified: _ClassVar[ManagementMode]
    self_managed: _ClassVar[ManagementMode]
    platform_managed: _ClassVar[ManagementMode]
management_mode_unspecified: ManagementMode
self_managed: ManagementMode
platform_managed: ManagementMode
