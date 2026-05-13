from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class ArtifactStorageState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    storage_state_unspecified: _ClassVar[ArtifactStorageState]
    storage_state_pending: _ClassVar[ArtifactStorageState]
    storage_state_stored: _ClassVar[ArtifactStorageState]
    storage_state_deleted: _ClassVar[ArtifactStorageState]
storage_state_unspecified: ArtifactStorageState
storage_state_pending: ArtifactStorageState
storage_state_stored: ArtifactStorageState
storage_state_deleted: ArtifactStorageState
