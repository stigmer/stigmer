from ai.stigmer.agentic.session.v1 import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ProviderAvailability(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    provider_availability_unspecified: _ClassVar[ProviderAvailability]
    served_by_organization: _ClassVar[ProviderAvailability]
    served_by_parent_organization: _ClassVar[ProviderAvailability]
    served_by_runners: _ClassVar[ProviderAvailability]
    missing_from_organization: _ClassVar[ProviderAvailability]
    missing_from_runners: _ClassVar[ProviderAvailability]
    availability_unknown: _ClassVar[ProviderAvailability]
provider_availability_unspecified: ProviderAvailability
served_by_organization: ProviderAvailability
served_by_parent_organization: ProviderAvailability
served_by_runners: ProviderAvailability
missing_from_organization: ProviderAvailability
missing_from_runners: ProviderAvailability
availability_unknown: ProviderAvailability

class GetModelReadinessInput(_message.Message):
    __slots__ = ("org", "model")
    ORG_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    org: str
    model: ModelOnEngine
    def __init__(self, org: _Optional[str] = ..., model: _Optional[_Union[ModelOnEngine, _Mapping]] = ...) -> None: ...

class ModelOnEngine(_message.Message):
    __slots__ = ("harness", "model")
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    harness: _enum_pb2.Harness
    model: str
    def __init__(self, harness: _Optional[_Union[_enum_pb2.Harness, str]] = ..., model: _Optional[str] = ...) -> None: ...

class ProviderReadiness(_message.Message):
    __slots__ = ("provider", "availability", "parent_org")
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    AVAILABILITY_FIELD_NUMBER: _ClassVar[int]
    PARENT_ORG_FIELD_NUMBER: _ClassVar[int]
    provider: str
    availability: ProviderAvailability
    parent_org: str
    def __init__(self, provider: _Optional[str] = ..., availability: _Optional[_Union[ProviderAvailability, str]] = ..., parent_org: _Optional[str] = ...) -> None: ...

class ModelReadiness(_message.Message):
    __slots__ = ("harness", "model", "provider", "availability")
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    AVAILABILITY_FIELD_NUMBER: _ClassVar[int]
    harness: _enum_pb2.Harness
    model: str
    provider: str
    availability: ProviderAvailability
    def __init__(self, harness: _Optional[_Union[_enum_pb2.Harness, str]] = ..., model: _Optional[str] = ..., provider: _Optional[str] = ..., availability: _Optional[_Union[ProviderAvailability, str]] = ...) -> None: ...

class GetModelReadinessOutput(_message.Message):
    __slots__ = ("providers", "models", "judged")
    PROVIDERS_FIELD_NUMBER: _ClassVar[int]
    MODELS_FIELD_NUMBER: _ClassVar[int]
    JUDGED_FIELD_NUMBER: _ClassVar[int]
    providers: _containers.RepeatedCompositeFieldContainer[ProviderReadiness]
    models: _containers.RepeatedCompositeFieldContainer[ModelReadiness]
    judged: ModelReadiness
    def __init__(self, providers: _Optional[_Iterable[_Union[ProviderReadiness, _Mapping]]] = ..., models: _Optional[_Iterable[_Union[ModelReadiness, _Mapping]]] = ..., judged: _Optional[_Union[ModelReadiness, _Mapping]] = ...) -> None: ...
