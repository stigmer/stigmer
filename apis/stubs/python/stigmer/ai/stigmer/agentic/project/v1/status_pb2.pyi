from ai.stigmer.commons.apiresource.apiresourcekind import api_resource_kind_pb2 as _api_resource_kind_pb2
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
    created: _containers.RepeatedCompositeFieldContainer[ResourceChangeRecord]
    updated: _containers.RepeatedCompositeFieldContainer[ResourceChangeRecord]
    deleted: _containers.RepeatedCompositeFieldContainer[ResourceChangeRecord]
    def __init__(self, created: _Optional[_Iterable[_Union[ResourceChangeRecord, _Mapping]]] = ..., updated: _Optional[_Iterable[_Union[ResourceChangeRecord, _Mapping]]] = ..., deleted: _Optional[_Iterable[_Union[ResourceChangeRecord, _Mapping]]] = ...) -> None: ...

class ResourceChangeRecord(_message.Message):
    __slots__ = ("kind", "slug", "resource_id")
    KIND_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    kind: _api_resource_kind_pb2.ApiResourceKind
    slug: str
    resource_id: str
    def __init__(self, kind: _Optional[_Union[_api_resource_kind_pb2.ApiResourceKind, str]] = ..., slug: _Optional[str] = ..., resource_id: _Optional[str] = ...) -> None: ...

class ProjectStatus(_message.Message):
    __slots__ = ("last_reconciliation", "audit")
    LAST_RECONCILIATION_FIELD_NUMBER: _ClassVar[int]
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    last_reconciliation: ReconciliationSummary
    audit: _status_pb2.ApiResourceAudit
    def __init__(self, last_reconciliation: _Optional[_Union[ReconciliationSummary, _Mapping]] = ..., audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ...) -> None: ...
