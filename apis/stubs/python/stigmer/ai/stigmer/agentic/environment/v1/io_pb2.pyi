from ai.stigmer.agentic.environment.v1 import api_pb2 as _api_pb2
from ai.stigmer.agentic.environment.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.commons.rpc import pagination_pb2 as _pagination_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class EnvironmentId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class EnvironmentSecretValueInput(_message.Message):
    __slots__ = ("environment_id", "key")
    ENVIRONMENT_ID_FIELD_NUMBER: _ClassVar[int]
    KEY_FIELD_NUMBER: _ClassVar[int]
    environment_id: str
    key: str
    def __init__(self, environment_id: _Optional[str] = ..., key: _Optional[str] = ...) -> None: ...

class ListEnvironmentsRequest(_message.Message):
    __slots__ = ("org", "labels", "page_info")
    class LabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ORG_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    PAGE_INFO_FIELD_NUMBER: _ClassVar[int]
    org: str
    labels: _containers.ScalarMap[str, str]
    page_info: _pagination_pb2.PageInfo
    def __init__(self, org: _Optional[str] = ..., labels: _Optional[_Mapping[str, str]] = ..., page_info: _Optional[_Union[_pagination_pb2.PageInfo, _Mapping]] = ...) -> None: ...

class EnvironmentList(_message.Message):
    __slots__ = ("total_count", "items")
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    total_count: int
    items: _containers.RepeatedCompositeFieldContainer[_api_pb2.Environment]
    def __init__(self, total_count: _Optional[int] = ..., items: _Optional[_Iterable[_Union[_api_pb2.Environment, _Mapping]]] = ...) -> None: ...

class UpdateEnvironmentVariablesRequest(_message.Message):
    __slots__ = ("environment_id", "variables")
    class VariablesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: _spec_pb2.EnvironmentValue
        def __init__(self, key: _Optional[str] = ..., value: _Optional[_Union[_spec_pb2.EnvironmentValue, _Mapping]] = ...) -> None: ...
    ENVIRONMENT_ID_FIELD_NUMBER: _ClassVar[int]
    VARIABLES_FIELD_NUMBER: _ClassVar[int]
    environment_id: str
    variables: _containers.MessageMap[str, _spec_pb2.EnvironmentValue]
    def __init__(self, environment_id: _Optional[str] = ..., variables: _Optional[_Mapping[str, _spec_pb2.EnvironmentValue]] = ...) -> None: ...

class RemoveEnvironmentVariablesRequest(_message.Message):
    __slots__ = ("environment_id", "keys")
    ENVIRONMENT_ID_FIELD_NUMBER: _ClassVar[int]
    KEYS_FIELD_NUMBER: _ClassVar[int]
    environment_id: str
    keys: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, environment_id: _Optional[str] = ..., keys: _Optional[_Iterable[str]] = ...) -> None: ...
