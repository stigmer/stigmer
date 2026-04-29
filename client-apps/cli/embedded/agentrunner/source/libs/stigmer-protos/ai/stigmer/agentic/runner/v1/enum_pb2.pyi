from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class RunnerPhase(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    RUNNER_PHASE_UNSPECIFIED: _ClassVar[RunnerPhase]
    RUNNER_PHASE_PENDING: _ClassVar[RunnerPhase]
    RUNNER_PHASE_READY: _ClassVar[RunnerPhase]
    RUNNER_PHASE_BUSY: _ClassVar[RunnerPhase]
    RUNNER_PHASE_STOPPED: _ClassVar[RunnerPhase]
    RUNNER_PHASE_FAILED: _ClassVar[RunnerPhase]
RUNNER_PHASE_UNSPECIFIED: RunnerPhase
RUNNER_PHASE_PENDING: RunnerPhase
RUNNER_PHASE_READY: RunnerPhase
RUNNER_PHASE_BUSY: RunnerPhase
RUNNER_PHASE_STOPPED: RunnerPhase
RUNNER_PHASE_FAILED: RunnerPhase
