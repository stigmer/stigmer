from ai.stigmer.iam.iampolicy.v1 import spec_pb2 as _spec_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class FieldType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    field_type_unspecified: _ClassVar[FieldType]
    string: _ClassVar[FieldType]
    integer: _ClassVar[FieldType]
    number: _ClassVar[FieldType]
    bool: _ClassVar[FieldType]
    timestamp: _ClassVar[FieldType]
    date: _ClassVar[FieldType]
    time: _ClassVar[FieldType]
    json: _ClassVar[FieldType]

class DatastoreVerb(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    datastore_verb_unspecified: _ClassVar[DatastoreVerb]
    read: _ClassVar[DatastoreVerb]
    insert: _ClassVar[DatastoreVerb]
    update: _ClassVar[DatastoreVerb]
    delete: _ClassVar[DatastoreVerb]

class DatastoreGrantScope(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    datastore_grant_scope_unspecified: _ClassVar[DatastoreGrantScope]
    all: _ClassVar[DatastoreGrantScope]
    own: _ClassVar[DatastoreGrantScope]
field_type_unspecified: FieldType
string: FieldType
integer: FieldType
number: FieldType
bool: FieldType
timestamp: FieldType
date: FieldType
time: FieldType
json: FieldType
datastore_verb_unspecified: DatastoreVerb
read: DatastoreVerb
insert: DatastoreVerb
update: DatastoreVerb
delete: DatastoreVerb
datastore_grant_scope_unspecified: DatastoreGrantScope
all: DatastoreGrantScope
own: DatastoreGrantScope

class DatastoreSpec(_message.Message):
    __slots__ = ("description", "timezone", "authorization", "collections")
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    TIMEZONE_FIELD_NUMBER: _ClassVar[int]
    AUTHORIZATION_FIELD_NUMBER: _ClassVar[int]
    COLLECTIONS_FIELD_NUMBER: _ClassVar[int]
    description: str
    timezone: str
    authorization: DatastoreAuthorization
    collections: _containers.RepeatedCompositeFieldContainer[CollectionDeclaration]
    def __init__(self, description: _Optional[str] = ..., timezone: _Optional[str] = ..., authorization: _Optional[_Union[DatastoreAuthorization, _Mapping]] = ..., collections: _Optional[_Iterable[_Union[CollectionDeclaration, _Mapping]]] = ...) -> None: ...

class CollectionDeclaration(_message.Message):
    __slots__ = ("name", "description", "fields", "uniques", "checks", "exists", "not_exists", "grants", "seed_records")
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    FIELDS_FIELD_NUMBER: _ClassVar[int]
    UNIQUES_FIELD_NUMBER: _ClassVar[int]
    CHECKS_FIELD_NUMBER: _ClassVar[int]
    EXISTS_FIELD_NUMBER: _ClassVar[int]
    NOT_EXISTS_FIELD_NUMBER: _ClassVar[int]
    GRANTS_FIELD_NUMBER: _ClassVar[int]
    SEED_RECORDS_FIELD_NUMBER: _ClassVar[int]
    name: str
    description: str
    fields: _containers.RepeatedCompositeFieldContainer[FieldDeclaration]
    uniques: _containers.RepeatedCompositeFieldContainer[UniqueConstraint]
    checks: _containers.RepeatedCompositeFieldContainer[CheckConstraint]
    exists: _containers.RepeatedCompositeFieldContainer[ExistsConstraint]
    not_exists: _containers.RepeatedCompositeFieldContainer[ExistsConstraint]
    grants: _containers.RepeatedCompositeFieldContainer[DatastoreGrant]
    seed_records: _containers.RepeatedCompositeFieldContainer[_struct_pb2.Struct]
    def __init__(self, name: _Optional[str] = ..., description: _Optional[str] = ..., fields: _Optional[_Iterable[_Union[FieldDeclaration, _Mapping]]] = ..., uniques: _Optional[_Iterable[_Union[UniqueConstraint, _Mapping]]] = ..., checks: _Optional[_Iterable[_Union[CheckConstraint, _Mapping]]] = ..., exists: _Optional[_Iterable[_Union[ExistsConstraint, _Mapping]]] = ..., not_exists: _Optional[_Iterable[_Union[ExistsConstraint, _Mapping]]] = ..., grants: _Optional[_Iterable[_Union[DatastoreGrant, _Mapping]]] = ..., seed_records: _Optional[_Iterable[_Union[_struct_pb2.Struct, _Mapping]]] = ...) -> None: ...

class FieldDeclaration(_message.Message):
    __slots__ = ("name", "type", "required", "default", "enum_values", "description")
    NAME_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    REQUIRED_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_FIELD_NUMBER: _ClassVar[int]
    ENUM_VALUES_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    name: str
    type: FieldType
    required: bool
    default: _struct_pb2.Value
    enum_values: _containers.RepeatedScalarFieldContainer[str]
    description: str
    def __init__(self, name: _Optional[str] = ..., type: _Optional[_Union[FieldType, str]] = ..., required: bool = ..., default: _Optional[_Union[_struct_pb2.Value, _Mapping]] = ..., enum_values: _Optional[_Iterable[str]] = ..., description: _Optional[str] = ...) -> None: ...

class UniqueConstraint(_message.Message):
    __slots__ = ("name", "fields", "where", "message")
    NAME_FIELD_NUMBER: _ClassVar[int]
    FIELDS_FIELD_NUMBER: _ClassVar[int]
    WHERE_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    name: str
    fields: _containers.RepeatedScalarFieldContainer[str]
    where: UniqueWhere
    message: str
    def __init__(self, name: _Optional[str] = ..., fields: _Optional[_Iterable[str]] = ..., where: _Optional[_Union[UniqueWhere, _Mapping]] = ..., message: _Optional[str] = ...) -> None: ...

class UniqueWhere(_message.Message):
    __slots__ = ("field", "equals")
    FIELD_FIELD_NUMBER: _ClassVar[int]
    EQUALS_FIELD_NUMBER: _ClassVar[int]
    field: str
    equals: _struct_pb2.Value
    def __init__(self, field: _Optional[str] = ..., equals: _Optional[_Union[_struct_pb2.Value, _Mapping]] = ...) -> None: ...

class CheckConstraint(_message.Message):
    __slots__ = ("name", "expression", "when", "message")
    NAME_FIELD_NUMBER: _ClassVar[int]
    EXPRESSION_FIELD_NUMBER: _ClassVar[int]
    WHEN_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    name: str
    expression: str
    when: str
    message: str
    def __init__(self, name: _Optional[str] = ..., expression: _Optional[str] = ..., when: _Optional[str] = ..., message: _Optional[str] = ...) -> None: ...

class ExistsConstraint(_message.Message):
    __slots__ = ("name", "collection", "where", "when", "message")
    NAME_FIELD_NUMBER: _ClassVar[int]
    COLLECTION_FIELD_NUMBER: _ClassVar[int]
    WHERE_FIELD_NUMBER: _ClassVar[int]
    WHEN_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    name: str
    collection: str
    where: str
    when: str
    message: str
    def __init__(self, name: _Optional[str] = ..., collection: _Optional[str] = ..., where: _Optional[str] = ..., when: _Optional[str] = ..., message: _Optional[str] = ...) -> None: ...

class DatastoreAuthorization(_message.Message):
    __slots__ = ("roles", "bindings", "default_role")
    ROLES_FIELD_NUMBER: _ClassVar[int]
    BINDINGS_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_ROLE_FIELD_NUMBER: _ClassVar[int]
    roles: _containers.RepeatedCompositeFieldContainer[DatastoreRole]
    bindings: _containers.RepeatedCompositeFieldContainer[DatastoreRoleBinding]
    default_role: str
    def __init__(self, roles: _Optional[_Iterable[_Union[DatastoreRole, _Mapping]]] = ..., bindings: _Optional[_Iterable[_Union[DatastoreRoleBinding, _Mapping]]] = ..., default_role: _Optional[str] = ...) -> None: ...

class DatastoreRole(_message.Message):
    __slots__ = ("name",)
    NAME_FIELD_NUMBER: _ClassVar[int]
    name: str
    def __init__(self, name: _Optional[str] = ...) -> None: ...

class DatastoreRoleBinding(_message.Message):
    __slots__ = ("subject", "role")
    SUBJECT_FIELD_NUMBER: _ClassVar[int]
    ROLE_FIELD_NUMBER: _ClassVar[int]
    subject: DatastoreSubject
    role: str
    def __init__(self, subject: _Optional[_Union[DatastoreSubject, _Mapping]] = ..., role: _Optional[str] = ...) -> None: ...

class DatastoreSubject(_message.Message):
    __slots__ = ("channel_sender", "principal")
    CHANNEL_SENDER_FIELD_NUMBER: _ClassVar[int]
    PRINCIPAL_FIELD_NUMBER: _ClassVar[int]
    channel_sender: ChannelSenderSubject
    principal: _spec_pb2.ApiResourceRef
    def __init__(self, channel_sender: _Optional[_Union[ChannelSenderSubject, _Mapping]] = ..., principal: _Optional[_Union[_spec_pb2.ApiResourceRef, _Mapping]] = ...) -> None: ...

class ChannelSenderSubject(_message.Message):
    __slots__ = ("sender_kind", "value")
    SENDER_KIND_FIELD_NUMBER: _ClassVar[int]
    VALUE_FIELD_NUMBER: _ClassVar[int]
    sender_kind: str
    value: str
    def __init__(self, sender_kind: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...

class DatastoreGrant(_message.Message):
    __slots__ = ("role", "verbs", "scope")
    ROLE_FIELD_NUMBER: _ClassVar[int]
    VERBS_FIELD_NUMBER: _ClassVar[int]
    SCOPE_FIELD_NUMBER: _ClassVar[int]
    role: str
    verbs: _containers.RepeatedScalarFieldContainer[DatastoreVerb]
    scope: DatastoreGrantScope
    def __init__(self, role: _Optional[str] = ..., verbs: _Optional[_Iterable[_Union[DatastoreVerb, str]]] = ..., scope: _Optional[_Union[DatastoreGrantScope, str]] = ...) -> None: ...
