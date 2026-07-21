import datetime

from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class DatastoreSyncOutcome(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    datastore_sync_outcome_unspecified: _ClassVar[DatastoreSyncOutcome]
    synced: _ClassVar[DatastoreSyncOutcome]
    rejected: _ClassVar[DatastoreSyncOutcome]

class CollectionMaterializationState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    collection_materialization_state_unspecified: _ClassVar[CollectionMaterializationState]
    pending: _ClassVar[CollectionMaterializationState]
    active: _ClassVar[CollectionMaterializationState]
    removed: _ClassVar[CollectionMaterializationState]
datastore_sync_outcome_unspecified: DatastoreSyncOutcome
synced: DatastoreSyncOutcome
rejected: DatastoreSyncOutcome
collection_materialization_state_unspecified: CollectionMaterializationState
pending: CollectionMaterializationState
active: CollectionMaterializationState
removed: CollectionMaterializationState

class DatastoreStatus(_message.Message):
    __slots__ = ("last_sync_outcome", "last_synced_at", "collections", "audit")
    LAST_SYNC_OUTCOME_FIELD_NUMBER: _ClassVar[int]
    LAST_SYNCED_AT_FIELD_NUMBER: _ClassVar[int]
    COLLECTIONS_FIELD_NUMBER: _ClassVar[int]
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    last_sync_outcome: DatastoreSyncOutcome
    last_synced_at: _timestamp_pb2.Timestamp
    collections: _containers.RepeatedCompositeFieldContainer[CollectionStatus]
    audit: _status_pb2.ApiResourceAudit
    def __init__(self, last_sync_outcome: _Optional[_Union[DatastoreSyncOutcome, str]] = ..., last_synced_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., collections: _Optional[_Iterable[_Union[CollectionStatus, _Mapping]]] = ..., audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ...) -> None: ...

class CollectionStatus(_message.Message):
    __slots__ = ("name", "state", "record_count", "ignored_seed_count", "materialized_at")
    NAME_FIELD_NUMBER: _ClassVar[int]
    STATE_FIELD_NUMBER: _ClassVar[int]
    RECORD_COUNT_FIELD_NUMBER: _ClassVar[int]
    IGNORED_SEED_COUNT_FIELD_NUMBER: _ClassVar[int]
    MATERIALIZED_AT_FIELD_NUMBER: _ClassVar[int]
    name: str
    state: CollectionMaterializationState
    record_count: int
    ignored_seed_count: int
    materialized_at: _timestamp_pb2.Timestamp
    def __init__(self, name: _Optional[str] = ..., state: _Optional[_Union[CollectionMaterializationState, str]] = ..., record_count: _Optional[int] = ..., ignored_seed_count: _Optional[int] = ..., materialized_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...
