from ai.stigmer.agentic.plugineval.v1 import api_pb2 as _api_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PluginEvalId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class ListPluginEvalsByPluginRequest(_message.Message):
    __slots__ = ("plugin_id",)
    PLUGIN_ID_FIELD_NUMBER: _ClassVar[int]
    plugin_id: str
    def __init__(self, plugin_id: _Optional[str] = ...) -> None: ...

class PluginEvalList(_message.Message):
    __slots__ = ("total_count", "items")
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    total_count: int
    items: _containers.RepeatedCompositeFieldContainer[_api_pb2.PluginEval]
    def __init__(self, total_count: _Optional[int] = ..., items: _Optional[_Iterable[_Union[_api_pb2.PluginEval, _Mapping]]] = ...) -> None: ...
