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
    HARNESS_STIGMER: _ClassVar[Harness]
    HARNESS_CLAUDE: _ClassVar[Harness]

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
GIT_WRITE_BACK_MODE_UNSPECIFIED: GitWriteBackMode
GIT_WRITE_BACK_BRANCH_AND_PR: GitWriteBackMode
HARNESS_UNSPECIFIED: Harness
HARNESS_STIGMER: Harness
HARNESS_CLAUDE: Harness
ENVIRONMENT_SOURCE_UNSPECIFIED: EnvironmentSource
ENVIRONMENT_SOURCE_SESSION: EnvironmentSource
ENVIRONMENT_SOURCE_ROUTINE: EnvironmentSource
ENVIRONMENT_SOURCE_AGENT: EnvironmentSource
ENVIRONMENT_SOURCE_ORGANIZATION: EnvironmentSource
EXECUTION_TARGET_UNSPECIFIED: ExecutionTarget
EXECUTION_TARGET_LOCAL: ExecutionTarget
EXECUTION_TARGET_CLOUD: ExecutionTarget
