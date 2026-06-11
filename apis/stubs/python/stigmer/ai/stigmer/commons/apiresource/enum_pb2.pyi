from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class ApiResourceEventType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    unspecified: _ClassVar[ApiResourceEventType]
    created: _ClassVar[ApiResourceEventType]
    updated: _ClassVar[ApiResourceEventType]
    deleted: _ClassVar[ApiResourceEventType]
    renamed: _ClassVar[ApiResourceEventType]
    stack_outputs_updated: _ClassVar[ApiResourceEventType]

class ApiResourceStateOperationType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    api_resource_state_operation_type_unspecified: _ClassVar[ApiResourceStateOperationType]
    create: _ClassVar[ApiResourceStateOperationType]
    update: _ClassVar[ApiResourceStateOperationType]
    delete: _ClassVar[ApiResourceStateOperationType]
    read: _ClassVar[ApiResourceStateOperationType]
    stream: _ClassVar[ApiResourceStateOperationType]

class ApiResourceVisibility(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    api_resource_visibility_unspecified: _ClassVar[ApiResourceVisibility]
    visibility_private: _ClassVar[ApiResourceVisibility]
    visibility_public: _ClassVar[ApiResourceVisibility]
    visibility_org: _ClassVar[ApiResourceVisibility]
    visibility_platform: _ClassVar[ApiResourceVisibility]
unspecified: ApiResourceEventType
created: ApiResourceEventType
updated: ApiResourceEventType
deleted: ApiResourceEventType
renamed: ApiResourceEventType
stack_outputs_updated: ApiResourceEventType
api_resource_state_operation_type_unspecified: ApiResourceStateOperationType
create: ApiResourceStateOperationType
update: ApiResourceStateOperationType
delete: ApiResourceStateOperationType
read: ApiResourceStateOperationType
stream: ApiResourceStateOperationType
api_resource_visibility_unspecified: ApiResourceVisibility
visibility_private: ApiResourceVisibility
visibility_public: ApiResourceVisibility
visibility_org: ApiResourceVisibility
visibility_platform: ApiResourceVisibility
