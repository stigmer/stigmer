from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class NotificationTaskConfig(_message.Message):
    __slots__ = ("channel", "recipients", "subject", "body", "template", "metadata")
    class MetadataEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    CHANNEL_FIELD_NUMBER: _ClassVar[int]
    RECIPIENTS_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_FIELD_NUMBER: _ClassVar[int]
    BODY_FIELD_NUMBER: _ClassVar[int]
    TEMPLATE_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    channel: str
    recipients: _containers.RepeatedScalarFieldContainer[str]
    subject: str
    body: str
    template: str
    metadata: _containers.ScalarMap[str, str]
    def __init__(self, channel: _Optional[str] = ..., recipients: _Optional[_Iterable[str]] = ..., subject: _Optional[str] = ..., body: _Optional[str] = ..., template: _Optional[str] = ..., metadata: _Optional[_Mapping[str, str]] = ...) -> None: ...
