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

class ReconciliationResult(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    reconciliation_result_unspecified: _ClassVar[ReconciliationResult]
    success: _ClassVar[ReconciliationResult]
    partial: _ClassVar[ReconciliationResult]
    failed: _ClassVar[ReconciliationResult]
project_runtime_unspecified: ProjectRuntime
go: ProjectRuntime
python: ProjectRuntime
node: ProjectRuntime
reconciliation_result_unspecified: ReconciliationResult
success: ReconciliationResult
partial: ReconciliationResult
failed: ReconciliationResult
