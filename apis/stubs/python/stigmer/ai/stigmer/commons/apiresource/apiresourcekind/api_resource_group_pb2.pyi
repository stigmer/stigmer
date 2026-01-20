from google.protobuf import descriptor_pb2 as _descriptor_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class ApiResourceGroup(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    api_resource_group_unspecified: _ClassVar[ApiResourceGroup]
    agentic: _ClassVar[ApiResourceGroup]
    iam: _ClassVar[ApiResourceGroup]
    tenancy: _ClassVar[ApiResourceGroup]
api_resource_group_unspecified: ApiResourceGroup
agentic: ApiResourceGroup
iam: ApiResourceGroup
tenancy: ApiResourceGroup
GROUP_META_FIELD_NUMBER: _ClassVar[int]
group_meta: _descriptor.FieldDescriptor

class ApiResourceGroupMeta(_message.Message):
    __slots__ = ("domain", "display_name")
    DOMAIN_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    domain: str
    display_name: str
    def __init__(self, domain: _Optional[str] = ..., display_name: _Optional[str] = ...) -> None: ...
