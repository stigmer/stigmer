import datetime

from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ValidationState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    validation_state_unspecified: _ClassVar[ValidationState]
    valid: _ClassVar[ValidationState]
    invalid: _ClassVar[ValidationState]

class DiscoverySource(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    discovery_source_unspecified: _ClassVar[DiscoverySource]
    seedpack: _ClassVar[DiscoverySource]
    cli: _ClassVar[DiscoverySource]
    agent_runner: _ClassVar[DiscoverySource]
validation_state_unspecified: ValidationState
valid: ValidationState
invalid: ValidationState
discovery_source_unspecified: DiscoverySource
seedpack: DiscoverySource
cli: DiscoverySource
agent_runner: DiscoverySource

class McpServerStatus(_message.Message):
    __slots__ = ("validation_state", "validation_message", "discovered_capabilities", "audit")
    VALIDATION_STATE_FIELD_NUMBER: _ClassVar[int]
    VALIDATION_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    DISCOVERED_CAPABILITIES_FIELD_NUMBER: _ClassVar[int]
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    validation_state: ValidationState
    validation_message: str
    discovered_capabilities: DiscoveredCapabilities
    audit: _status_pb2.ApiResourceAudit
    def __init__(self, validation_state: _Optional[_Union[ValidationState, str]] = ..., validation_message: _Optional[str] = ..., discovered_capabilities: _Optional[_Union[DiscoveredCapabilities, _Mapping]] = ..., audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ...) -> None: ...

class DiscoveredCapabilities(_message.Message):
    __slots__ = ("tools", "resource_templates", "last_discovered_at", "discovered_by")
    TOOLS_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_TEMPLATES_FIELD_NUMBER: _ClassVar[int]
    LAST_DISCOVERED_AT_FIELD_NUMBER: _ClassVar[int]
    DISCOVERED_BY_FIELD_NUMBER: _ClassVar[int]
    tools: _containers.RepeatedCompositeFieldContainer[DiscoveredTool]
    resource_templates: _containers.RepeatedCompositeFieldContainer[DiscoveredResourceTemplate]
    last_discovered_at: _timestamp_pb2.Timestamp
    discovered_by: DiscoverySource
    def __init__(self, tools: _Optional[_Iterable[_Union[DiscoveredTool, _Mapping]]] = ..., resource_templates: _Optional[_Iterable[_Union[DiscoveredResourceTemplate, _Mapping]]] = ..., last_discovered_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., discovered_by: _Optional[_Union[DiscoverySource, str]] = ...) -> None: ...

class DiscoveredTool(_message.Message):
    __slots__ = ("name", "description", "input_schema")
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    INPUT_SCHEMA_FIELD_NUMBER: _ClassVar[int]
    name: str
    description: str
    input_schema: _struct_pb2.Struct
    def __init__(self, name: _Optional[str] = ..., description: _Optional[str] = ..., input_schema: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ...) -> None: ...

class DiscoveredResourceTemplate(_message.Message):
    __slots__ = ("uri_template", "name", "description", "mime_type")
    URI_TEMPLATE_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    uri_template: str
    name: str
    description: str
    mime_type: str
    def __init__(self, uri_template: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., mime_type: _Optional[str] = ...) -> None: ...
