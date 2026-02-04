from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class ProjectRuntime(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    project_runtime_unspecified: _ClassVar[ProjectRuntime]
    go: _ClassVar[ProjectRuntime]
    python: _ClassVar[ProjectRuntime]
    node: _ClassVar[ProjectRuntime]
project_runtime_unspecified: ProjectRuntime
go: ProjectRuntime
python: ProjectRuntime
node: ProjectRuntime
