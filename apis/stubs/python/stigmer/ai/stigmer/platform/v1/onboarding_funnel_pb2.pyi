from ai.stigmer.tenancy.organization.v1 import onboarding_pb2 as _onboarding_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class GetOnboardingFunnelInput(_message.Message):
    __slots__ = ("from_date", "to_date")
    FROM_DATE_FIELD_NUMBER: _ClassVar[int]
    TO_DATE_FIELD_NUMBER: _ClassVar[int]
    from_date: str
    to_date: str
    def __init__(self, from_date: _Optional[str] = ..., to_date: _Optional[str] = ...) -> None: ...

class OnboardingStepCount(_message.Message):
    __slots__ = ("id", "reached")
    ID_FIELD_NUMBER: _ClassVar[int]
    REACHED_FIELD_NUMBER: _ClassVar[int]
    id: _onboarding_pb2.OnboardingStepId
    reached: int
    def __init__(self, id: _Optional[_Union[_onboarding_pb2.OnboardingStepId, str]] = ..., reached: _Optional[int] = ...) -> None: ...

class GetOnboardingFunnelOutput(_message.Message):
    __slots__ = ("organizations", "excluded", "steps")
    ORGANIZATIONS_FIELD_NUMBER: _ClassVar[int]
    EXCLUDED_FIELD_NUMBER: _ClassVar[int]
    STEPS_FIELD_NUMBER: _ClassVar[int]
    organizations: int
    excluded: int
    steps: _containers.RepeatedCompositeFieldContainer[OnboardingStepCount]
    def __init__(self, organizations: _Optional[int] = ..., excluded: _Optional[int] = ..., steps: _Optional[_Iterable[_Union[OnboardingStepCount, _Mapping]]] = ...) -> None: ...
