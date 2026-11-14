from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class OnboardingStepId(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    onboarding_step_id_unspecified: _ClassVar[OnboardingStepId]
    describe: _ClassVar[OnboardingStepId]
    key: _ClassVar[OnboardingStepId]
    watch: _ClassVar[OnboardingStepId]
    make_yours: _ClassVar[OnboardingStepId]
    in_app: _ClassVar[OnboardingStepId]
    others: _ClassVar[OnboardingStepId]
onboarding_step_id_unspecified: OnboardingStepId
describe: OnboardingStepId
key: OnboardingStepId
watch: OnboardingStepId
make_yours: OnboardingStepId
in_app: OnboardingStepId
others: OnboardingStepId

class OnboardingStep(_message.Message):
    __slots__ = ("id", "done")
    ID_FIELD_NUMBER: _ClassVar[int]
    DONE_FIELD_NUMBER: _ClassVar[int]
    id: OnboardingStepId
    done: bool
    def __init__(self, id: _Optional[_Union[OnboardingStepId, str]] = ..., done: bool = ...) -> None: ...

class OnboardingAgent(_message.Message):
    __slots__ = ("org", "slug", "name")
    ORG_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    org: str
    slug: str
    name: str
    def __init__(self, org: _Optional[str] = ..., slug: _Optional[str] = ..., name: _Optional[str] = ...) -> None: ...

class OnboardingProgress(_message.Message):
    __slots__ = ("steps", "newest_agent", "changed_agent", "served_provider", "ever_ran", "app_user_name", "joined_names", "joined_count")
    STEPS_FIELD_NUMBER: _ClassVar[int]
    NEWEST_AGENT_FIELD_NUMBER: _ClassVar[int]
    CHANGED_AGENT_FIELD_NUMBER: _ClassVar[int]
    SERVED_PROVIDER_FIELD_NUMBER: _ClassVar[int]
    EVER_RAN_FIELD_NUMBER: _ClassVar[int]
    APP_USER_NAME_FIELD_NUMBER: _ClassVar[int]
    JOINED_NAMES_FIELD_NUMBER: _ClassVar[int]
    JOINED_COUNT_FIELD_NUMBER: _ClassVar[int]
    steps: _containers.RepeatedCompositeFieldContainer[OnboardingStep]
    newest_agent: OnboardingAgent
    changed_agent: OnboardingAgent
    served_provider: str
    ever_ran: bool
    app_user_name: str
    joined_names: _containers.RepeatedScalarFieldContainer[str]
    joined_count: int
    def __init__(self, steps: _Optional[_Iterable[_Union[OnboardingStep, _Mapping]]] = ..., newest_agent: _Optional[_Union[OnboardingAgent, _Mapping]] = ..., changed_agent: _Optional[_Union[OnboardingAgent, _Mapping]] = ..., served_provider: _Optional[str] = ..., ever_ran: bool = ..., app_user_name: _Optional[str] = ..., joined_names: _Optional[_Iterable[str]] = ..., joined_count: _Optional[int] = ...) -> None: ...
