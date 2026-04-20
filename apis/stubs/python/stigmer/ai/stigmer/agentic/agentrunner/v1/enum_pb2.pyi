from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class AgentRunnerPhase(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    AGENT_RUNNER_PHASE_UNSPECIFIED: _ClassVar[AgentRunnerPhase]
    AGENT_RUNNER_PHASE_PENDING: _ClassVar[AgentRunnerPhase]
    AGENT_RUNNER_PHASE_READY: _ClassVar[AgentRunnerPhase]
    AGENT_RUNNER_PHASE_BUSY: _ClassVar[AgentRunnerPhase]
    AGENT_RUNNER_PHASE_STOPPED: _ClassVar[AgentRunnerPhase]
    AGENT_RUNNER_PHASE_FAILED: _ClassVar[AgentRunnerPhase]
AGENT_RUNNER_PHASE_UNSPECIFIED: AgentRunnerPhase
AGENT_RUNNER_PHASE_PENDING: AgentRunnerPhase
AGENT_RUNNER_PHASE_READY: AgentRunnerPhase
AGENT_RUNNER_PHASE_BUSY: AgentRunnerPhase
AGENT_RUNNER_PHASE_STOPPED: AgentRunnerPhase
AGENT_RUNNER_PHASE_FAILED: AgentRunnerPhase
