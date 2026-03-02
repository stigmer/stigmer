from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ReconciliationSummary(_message.Message):
    __slots__ = ("created", "updated", "deleted")
    CREATED_FIELD_NUMBER: _ClassVar[int]
    UPDATED_FIELD_NUMBER: _ClassVar[int]
    DELETED_FIELD_NUMBER: _ClassVar[int]
    created: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    updated: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    deleted: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    def __init__(self, created: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ..., updated: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ..., deleted: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ...) -> None: ...

class ProjectStatus(_message.Message):
    __slots__ = ("last_reconciliation", "audit")
    LAST_RECONCILIATION_FIELD_NUMBER: _ClassVar[int]
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    last_reconciliation: ReconciliationSummary
    audit: _status_pb2.ApiResourceAudit
    def __init__(self, last_reconciliation: _Optional[_Union[ReconciliationSummary, _Mapping]] = ..., audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ...) -> None: ...
