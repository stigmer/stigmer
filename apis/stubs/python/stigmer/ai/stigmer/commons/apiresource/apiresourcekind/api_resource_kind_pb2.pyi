from ai.stigmer.commons.apiresource.apiresourcekind import api_resource_group_pb2 as _api_resource_group_pb2
from google.protobuf import descriptor_pb2 as _descriptor_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ApiResourceVersion(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    api_resource_version_unspecified: _ClassVar[ApiResourceVersion]
    v1: _ClassVar[ApiResourceVersion]

class ResourceTier(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TIER_UNSPECIFIED: _ClassVar[ResourceTier]
    TIER_OPEN_SOURCE: _ClassVar[ResourceTier]
    TIER_CLOUD_ONLY: _ClassVar[ResourceTier]

class PlatformIdValue(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    platform_id_value_unspecified: _ClassVar[PlatformIdValue]
    stigmer: _ClassVar[PlatformIdValue]

class ApiResourceKind(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    api_resource_kind_unknown: _ClassVar[ApiResourceKind]
    api_resource_version: _ClassVar[ApiResourceKind]
    iam_policy: _ClassVar[ApiResourceKind]
    identity_account: _ClassVar[ApiResourceKind]
    api_key: _ClassVar[ApiResourceKind]
    credential: _ClassVar[ApiResourceKind]
    organization: _ClassVar[ApiResourceKind]
    platform: _ClassVar[ApiResourceKind]
    agent: _ClassVar[ApiResourceKind]
    agent_execution: _ClassVar[ApiResourceKind]
    session: _ClassVar[ApiResourceKind]
    skill: _ClassVar[ApiResourceKind]
    mcp_server: _ClassVar[ApiResourceKind]
    agent_instance: _ClassVar[ApiResourceKind]
    workflow: _ClassVar[ApiResourceKind]
    workflow_instance: _ClassVar[ApiResourceKind]
    workflow_execution: _ClassVar[ApiResourceKind]
    environment: _ClassVar[ApiResourceKind]
    execution_context: _ClassVar[ApiResourceKind]
api_resource_version_unspecified: ApiResourceVersion
v1: ApiResourceVersion
TIER_UNSPECIFIED: ResourceTier
TIER_OPEN_SOURCE: ResourceTier
TIER_CLOUD_ONLY: ResourceTier
platform_id_value_unspecified: PlatformIdValue
stigmer: PlatformIdValue
api_resource_kind_unknown: ApiResourceKind
api_resource_version: ApiResourceKind
iam_policy: ApiResourceKind
identity_account: ApiResourceKind
api_key: ApiResourceKind
credential: ApiResourceKind
organization: ApiResourceKind
platform: ApiResourceKind
agent: ApiResourceKind
agent_execution: ApiResourceKind
session: ApiResourceKind
skill: ApiResourceKind
mcp_server: ApiResourceKind
agent_instance: ApiResourceKind
workflow: ApiResourceKind
workflow_instance: ApiResourceKind
workflow_execution: ApiResourceKind
environment: ApiResourceKind
execution_context: ApiResourceKind
KIND_META_FIELD_NUMBER: _ClassVar[int]
kind_meta: _descriptor.FieldDescriptor

class ApiResourceKindMeta(_message.Message):
    __slots__ = ("group", "version", "name", "display_name", "id_prefix", "is_versioned", "not_search_indexed", "tier")
    GROUP_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    ID_PREFIX_FIELD_NUMBER: _ClassVar[int]
    IS_VERSIONED_FIELD_NUMBER: _ClassVar[int]
    NOT_SEARCH_INDEXED_FIELD_NUMBER: _ClassVar[int]
    TIER_FIELD_NUMBER: _ClassVar[int]
    group: _api_resource_group_pb2.ApiResourceGroup
    version: ApiResourceVersion
    name: str
    display_name: str
    id_prefix: str
    is_versioned: bool
    not_search_indexed: bool
    tier: ResourceTier
    def __init__(self, group: _Optional[_Union[_api_resource_group_pb2.ApiResourceGroup, str]] = ..., version: _Optional[_Union[ApiResourceVersion, str]] = ..., name: _Optional[str] = ..., display_name: _Optional[str] = ..., id_prefix: _Optional[str] = ..., is_versioned: bool = ..., not_search_indexed: bool = ..., tier: _Optional[_Union[ResourceTier, str]] = ...) -> None: ...
