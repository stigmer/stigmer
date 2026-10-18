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

class EnvironmentSource(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ENVIRONMENT_SOURCE_UNSPECIFIED: _ClassVar[EnvironmentSource]
    ENVIRONMENT_SOURCE_SESSION: _ClassVar[EnvironmentSource]
    ENVIRONMENT_SOURCE_ROUTINE: _ClassVar[EnvironmentSource]
    ENVIRONMENT_SOURCE_AGENT: _ClassVar[EnvironmentSource]
    ENVIRONMENT_SOURCE_ORGANIZATION: _ClassVar[EnvironmentSource]

class ExecutionTarget(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    EXECUTION_TARGET_UNSPECIFIED: _ClassVar[ExecutionTarget]
    EXECUTION_TARGET_LOCAL: _ClassVar[ExecutionTarget]
    EXECUTION_TARGET_CLOUD: _ClassVar[ExecutionTarget]

class CursorMode(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    CURSOR_MODE_UNSPECIFIED: _ClassVar[CursorMode]
    CURSOR_MODE_LOCAL: _ClassVar[CursorMode]
    CURSOR_MODE_CLOUD: _ClassVar[CursorMode]
GIT_WRITE_BACK_MODE_UNSPECIFIED: GitWriteBackMode
GIT_WRITE_BACK_BRANCH_AND_PR: GitWriteBackMode
HARNESS_UNSPECIFIED: Harness
HARNESS_NATIVE: Harness
HARNESS_CURSOR: Harness
ENVIRONMENT_SOURCE_UNSPECIFIED: EnvironmentSource
ENVIRONMENT_SOURCE_SESSION: EnvironmentSource
ENVIRONMENT_SOURCE_ROUTINE: EnvironmentSource
ENVIRONMENT_SOURCE_AGENT: EnvironmentSource
ENVIRONMENT_SOURCE_ORGANIZATION: EnvironmentSource
EXECUTION_TARGET_UNSPECIFIED: ExecutionTarget
EXECUTION_TARGET_LOCAL: ExecutionTarget
EXECUTION_TARGET_CLOUD: ExecutionTarget
CURSOR_MODE_UNSPECIFIED: CursorMode
CURSOR_MODE_LOCAL: CursorMode
CURSOR_MODE_CLOUD: CursorMode
