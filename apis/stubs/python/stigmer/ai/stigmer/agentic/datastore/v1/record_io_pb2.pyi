import datetime

from ai.stigmer.agentic.datastore.v1 import spec_pb2 as _spec_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class RecordConditionOp(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    record_condition_op_unspecified: _ClassVar[RecordConditionOp]
    eq: _ClassVar[RecordConditionOp]
    neq: _ClassVar[RecordConditionOp]
    gt: _ClassVar[RecordConditionOp]
    gte: _ClassVar[RecordConditionOp]
    lt: _ClassVar[RecordConditionOp]
    lte: _ClassVar[RecordConditionOp]
    is_in: _ClassVar[RecordConditionOp]
    not_in: _ClassVar[RecordConditionOp]
    is_null: _ClassVar[RecordConditionOp]
    not_null: _ClassVar[RecordConditionOp]

class RecordSortDirection(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    record_sort_direction_unspecified: _ClassVar[RecordSortDirection]
    asc: _ClassVar[RecordSortDirection]
    desc: _ClassVar[RecordSortDirection]

class ConstraintKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    constraint_kind_unspecified: _ClassVar[ConstraintKind]
    unique: _ClassVar[ConstraintKind]
    check: _ClassVar[ConstraintKind]
    exists: _ClassVar[ConstraintKind]
    not_exists: _ClassVar[ConstraintKind]
record_condition_op_unspecified: RecordConditionOp
eq: RecordConditionOp
neq: RecordConditionOp
gt: RecordConditionOp
gte: RecordConditionOp
lt: RecordConditionOp
lte: RecordConditionOp
is_in: RecordConditionOp
not_in: RecordConditionOp
is_null: RecordConditionOp
not_null: RecordConditionOp
record_sort_direction_unspecified: RecordSortDirection
asc: RecordSortDirection
desc: RecordSortDirection
constraint_kind_unspecified: ConstraintKind
unique: ConstraintKind
check: ConstraintKind
exists: ConstraintKind
not_exists: ConstraintKind

class RecordEnvelope(_message.Message):
    __slots__ = ("id", "created_at", "updated_at", "created_by", "fields")
    ID_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    CREATED_BY_FIELD_NUMBER: _ClassVar[int]
    FIELDS_FIELD_NUMBER: _ClassVar[int]
    id: str
    created_at: _timestamp_pb2.Timestamp
    updated_at: _timestamp_pb2.Timestamp
    created_by: _spec_pb2.DatastoreSubject
    fields: _struct_pb2.Struct
    def __init__(self, id: _Optional[str] = ..., created_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., updated_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., created_by: _Optional[_Union[_spec_pb2.DatastoreSubject, _Mapping]] = ..., fields: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...) -> None: ...

class RecordList(_message.Message):
    __slots__ = ("records", "total", "limit", "offset")
    RECORDS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    OFFSET_FIELD_NUMBER: _ClassVar[int]
    records: _containers.RepeatedCompositeFieldContainer[RecordEnvelope]
    total: int
    limit: int
    offset: int
    def __init__(self, records: _Optional[_Iterable[_Union[RecordEnvelope, _Mapping]]] = ..., total: _Optional[int] = ..., limit: _Optional[int] = ..., offset: _Optional[int] = ...) -> None: ...

class RecordFilter(_message.Message):
    __slots__ = ("conditions",)
    CONDITIONS_FIELD_NUMBER: _ClassVar[int]
    conditions: _containers.RepeatedCompositeFieldContainer[RecordCondition]
    def __init__(self, conditions: _Optional[_Iterable[_Union[RecordCondition, _Mapping]]] = ...) -> None: ...

class RecordCondition(_message.Message):
    __slots__ = ("field", "op", "value", "values")
    FIELD_FIELD_NUMBER: _ClassVar[int]
    OP_FIELD_NUMBER: _ClassVar[int]
    VALUE_FIELD_NUMBER: _ClassVar[int]
    VALUES_FIELD_NUMBER: _ClassVar[int]
    field: str
    op: RecordConditionOp
    value: _struct_pb2.Value
    values: _containers.RepeatedCompositeFieldContainer[_struct_pb2.Value]
    def __init__(self, field: _Optional[str] = ..., op: _Optional[_Union[RecordConditionOp, str]] = ..., value: _Optional[_Union[_struct_pb2.Value, _Mapping]] = ..., values: _Optional[_Iterable[_Union[_struct_pb2.Value, _Mapping]]] = ...) -> None: ...

class RecordOrderBy(_message.Message):
    __slots__ = ("field", "direction")
    FIELD_FIELD_NUMBER: _ClassVar[int]
    DIRECTION_FIELD_NUMBER: _ClassVar[int]
    field: str
    direction: RecordSortDirection
    def __init__(self, field: _Optional[str] = ..., direction: _Optional[_Union[RecordSortDirection, str]] = ...) -> None: ...

class FindRecordsRequest(_message.Message):
    __slots__ = ("datastore", "collection", "filter", "order_by", "limit", "offset", "partition", "org")
    DATASTORE_FIELD_NUMBER: _ClassVar[int]
    COLLECTION_FIELD_NUMBER: _ClassVar[int]
    FILTER_FIELD_NUMBER: _ClassVar[int]
    ORDER_BY_FIELD_NUMBER: _ClassVar[int]
    LIMIT_FIELD_NUMBER: _ClassVar[int]
    OFFSET_FIELD_NUMBER: _ClassVar[int]
    PARTITION_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    datastore: str
    collection: str
    filter: RecordFilter
    order_by: RecordOrderBy
    limit: int
    offset: int
    partition: str
    org: str
    def __init__(self, datastore: _Optional[str] = ..., collection: _Optional[str] = ..., filter: _Optional[_Union[RecordFilter, _Mapping]] = ..., order_by: _Optional[_Union[RecordOrderBy, _Mapping]] = ..., limit: _Optional[int] = ..., offset: _Optional[int] = ..., partition: _Optional[str] = ..., org: _Optional[str] = ...) -> None: ...

class InsertRecordRequest(_message.Message):
    __slots__ = ("datastore", "collection", "record", "partition", "org")
    DATASTORE_FIELD_NUMBER: _ClassVar[int]
    COLLECTION_FIELD_NUMBER: _ClassVar[int]
    RECORD_FIELD_NUMBER: _ClassVar[int]
    PARTITION_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    datastore: str
    collection: str
    record: _struct_pb2.Struct
    partition: str
    org: str
    def __init__(self, datastore: _Optional[str] = ..., collection: _Optional[str] = ..., record: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., partition: _Optional[str] = ..., org: _Optional[str] = ...) -> None: ...

class UpdateRecordRequest(_message.Message):
    __slots__ = ("datastore", "collection", "id", "fields", "partition", "org")
    DATASTORE_FIELD_NUMBER: _ClassVar[int]
    COLLECTION_FIELD_NUMBER: _ClassVar[int]
    ID_FIELD_NUMBER: _ClassVar[int]
    FIELDS_FIELD_NUMBER: _ClassVar[int]
    PARTITION_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    datastore: str
    collection: str
    id: str
    fields: _struct_pb2.Struct
    partition: str
    org: str
    def __init__(self, datastore: _Optional[str] = ..., collection: _Optional[str] = ..., id: _Optional[str] = ..., fields: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., partition: _Optional[str] = ..., org: _Optional[str] = ...) -> None: ...

class DeleteRecordRequest(_message.Message):
    __slots__ = ("datastore", "collection", "id", "partition", "org")
    DATASTORE_FIELD_NUMBER: _ClassVar[int]
    COLLECTION_FIELD_NUMBER: _ClassVar[int]
    ID_FIELD_NUMBER: _ClassVar[int]
    PARTITION_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    datastore: str
    collection: str
    id: str
    partition: str
    org: str
    def __init__(self, datastore: _Optional[str] = ..., collection: _Optional[str] = ..., id: _Optional[str] = ..., partition: _Optional[str] = ..., org: _Optional[str] = ...) -> None: ...

class DescribeDatastoreRequest(_message.Message):
    __slots__ = ("datastore", "org")
    DATASTORE_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    datastore: str
    org: str
    def __init__(self, datastore: _Optional[str] = ..., org: _Optional[str] = ...) -> None: ...

class DatastoreDescription(_message.Message):
    __slots__ = ("datastore", "description", "timezone", "collections", "partitions")
    DATASTORE_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    TIMEZONE_FIELD_NUMBER: _ClassVar[int]
    COLLECTIONS_FIELD_NUMBER: _ClassVar[int]
    PARTITIONS_FIELD_NUMBER: _ClassVar[int]
    datastore: str
    description: str
    timezone: str
    collections: _containers.RepeatedCompositeFieldContainer[CollectionDescription]
    partitions: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, datastore: _Optional[str] = ..., description: _Optional[str] = ..., timezone: _Optional[str] = ..., collections: _Optional[_Iterable[_Union[CollectionDescription, _Mapping]]] = ..., partitions: _Optional[_Iterable[str]] = ...) -> None: ...

class CollectionDescription(_message.Message):
    __slots__ = ("name", "description", "fields", "constraints", "access")
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    FIELDS_FIELD_NUMBER: _ClassVar[int]
    CONSTRAINTS_FIELD_NUMBER: _ClassVar[int]
    ACCESS_FIELD_NUMBER: _ClassVar[int]
    name: str
    description: str
    fields: _containers.RepeatedCompositeFieldContainer[_spec_pb2.FieldDeclaration]
    constraints: _containers.RepeatedCompositeFieldContainer[ConstraintDescription]
    access: _containers.RepeatedCompositeFieldContainer[VerbGrantDescription]
    def __init__(self, name: _Optional[str] = ..., description: _Optional[str] = ..., fields: _Optional[_Iterable[_Union[_spec_pb2.FieldDeclaration, _Mapping]]] = ..., constraints: _Optional[_Iterable[_Union[ConstraintDescription, _Mapping]]] = ..., access: _Optional[_Iterable[_Union[VerbGrantDescription, _Mapping]]] = ...) -> None: ...

class ConstraintDescription(_message.Message):
    __slots__ = ("name", "kind", "message")
    NAME_FIELD_NUMBER: _ClassVar[int]
    KIND_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    name: str
    kind: ConstraintKind
    message: str
    def __init__(self, name: _Optional[str] = ..., kind: _Optional[_Union[ConstraintKind, str]] = ..., message: _Optional[str] = ...) -> None: ...

class VerbGrantDescription(_message.Message):
    __slots__ = ("verb", "own_scope", "readable_fields")
    VERB_FIELD_NUMBER: _ClassVar[int]
    OWN_SCOPE_FIELD_NUMBER: _ClassVar[int]
    READABLE_FIELDS_FIELD_NUMBER: _ClassVar[int]
    verb: _spec_pb2.DatastoreVerb
    own_scope: bool
    readable_fields: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, verb: _Optional[_Union[_spec_pb2.DatastoreVerb, str]] = ..., own_scope: bool = ..., readable_fields: _Optional[_Iterable[str]] = ...) -> None: ...
