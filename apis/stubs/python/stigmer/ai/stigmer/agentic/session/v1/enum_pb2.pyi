from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class GitWriteBackMode(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    GIT_WRITE_BACK_MODE_UNSPECIFIED: _ClassVar[GitWriteBackMode]
    GIT_WRITE_BACK_BRANCH_AND_PR: _ClassVar[GitWriteBackMode]

class Harness(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    HARNESS_UNSPECIFIED: _ClassVar[Harness]
    HARNESS_NATIVE: _ClassVar[Harness]
    HARNESS_CURSOR: _ClassVar[Harness]
GIT_WRITE_BACK_MODE_UNSPECIFIED: GitWriteBackMode
GIT_WRITE_BACK_BRANCH_AND_PR: GitWriteBackMode
HARNESS_UNSPECIFIED: Harness
HARNESS_NATIVE: Harness
HARNESS_CURSOR: Harness
