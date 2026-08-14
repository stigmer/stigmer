from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class EmitEventSpec(_message.Message):
    __slots__ = ("type", "source", "data", "subject")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_FIELD_NUMBER: _ClassVar[int]
    type: str
    source: str
    data: _struct_pb2.Struct
    subject: str
    def __init__(self, type: _Optional[str] = ..., source: _Optional[str] = ..., data: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., subject: _Optional[str] = ...) -> None: ...

class EmitEventTaskConfig(_message.Message):
    __slots__ = ("event", "delivery")
    EVENT_FIELD_NUMBER: _ClassVar[int]
    DELIVERY_FIELD_NUMBER: _ClassVar[int]
    event: EmitEventSpec
    delivery: _containers.RepeatedCompositeFieldContainer[EmitDeliveryTarget]
    def __init__(self, event: _Optional[_Union[EmitEventSpec, _Mapping]] = ..., delivery: _Optional[_Iterable[_Union[EmitDeliveryTarget, _Mapping]]] = ...) -> None: ...

class EmitDeliveryTarget(_message.Message):
    __slots__ = ("webhook", "signal")
    WEBHOOK_FIELD_NUMBER: _ClassVar[int]
    SIGNAL_FIELD_NUMBER: _ClassVar[int]
    webhook: WebhookDelivery
    signal: SignalDelivery
    def __init__(self, webhook: _Optional[_Union[WebhookDelivery, _Mapping]] = ..., signal: _Optional[_Union[SignalDelivery, _Mapping]] = ...) -> None: ...

class WebhookDelivery(_message.Message):
    __slots__ = ("url", "headers")
    class HeadersEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    URL_FIELD_NUMBER: _ClassVar[int]
    HEADERS_FIELD_NUMBER: _ClassVar[int]
    url: str
    headers: _containers.ScalarMap[str, str]
    def __init__(self, url: _Optional[str] = ..., headers: _Optional[_Mapping[str, str]] = ...) -> None: ...

class SignalDelivery(_message.Message):
    __slots__ = ("execution_id", "signal_name")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    SIGNAL_NAME_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    signal_name: str
    def __init__(self, execution_id: _Optional[str] = ..., signal_name: _Optional[str] = ...) -> None: ...
