import datetime

from ai.stigmer.agentic.mcpserver.v1 import spec_pb2 as _spec_pb2
from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from ai.stigmer.iam.oauthapp.v1 import spec_pb2 as _spec_pb2_1
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ConnectPhase(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    connect_phase_unspecified: _ClassVar[ConnectPhase]
    connect_phase_connecting: _ClassVar[ConnectPhase]
    connect_phase_succeeded: _ClassVar[ConnectPhase]
    connect_phase_failed: _ClassVar[ConnectPhase]

class ValidationState(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    validation_state_unspecified: _ClassVar[ValidationState]
    valid: _ClassVar[ValidationState]
    invalid: _ClassVar[ValidationState]

class OAuthAppSource(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    OAUTH_APP_SOURCE_UNSPECIFIED: _ClassVar[OAuthAppSource]
    OAUTH_APP_SOURCE_PLATFORM: _ClassVar[OAuthAppSource]
    OAUTH_APP_SOURCE_ORG_OVERRIDE: _ClassVar[OAuthAppSource]
    OAUTH_APP_SOURCE_NONE: _ClassVar[OAuthAppSource]
connect_phase_unspecified: ConnectPhase
connect_phase_connecting: ConnectPhase
connect_phase_succeeded: ConnectPhase
connect_phase_failed: ConnectPhase
validation_state_unspecified: ValidationState
valid: ValidationState
invalid: ValidationState
OAUTH_APP_SOURCE_UNSPECIFIED: OAuthAppSource
OAUTH_APP_SOURCE_PLATFORM: OAuthAppSource
OAUTH_APP_SOURCE_ORG_OVERRIDE: OAuthAppSource
OAUTH_APP_SOURCE_NONE: OAuthAppSource

class McpServerStatus(_message.Message):
    __slots__ = ("validation_state", "validation_message", "discovered_capabilities", "tool_approvals", "oauth_status", "connect_status", "audit")
    VALIDATION_STATE_FIELD_NUMBER: _ClassVar[int]
    VALIDATION_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    DISCOVERED_CAPABILITIES_FIELD_NUMBER: _ClassVar[int]
    TOOL_APPROVALS_FIELD_NUMBER: _ClassVar[int]
    OAUTH_STATUS_FIELD_NUMBER: _ClassVar[int]
    CONNECT_STATUS_FIELD_NUMBER: _ClassVar[int]
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    validation_state: ValidationState
    validation_message: str
    discovered_capabilities: DiscoveredCapabilities
    tool_approvals: _containers.RepeatedCompositeFieldContainer[_spec_pb2.ToolApprovalPolicy]
    oauth_status: OAuthStatus
    connect_status: ConnectStatus
    audit: _status_pb2.ApiResourceAudit
    def __init__(self, validation_state: _Optional[_Union[ValidationState, str]] = ..., validation_message: _Optional[str] = ..., discovered_capabilities: _Optional[_Union[DiscoveredCapabilities, _Mapping]] = ..., tool_approvals: _Optional[_Iterable[_Union[_spec_pb2.ToolApprovalPolicy, _Mapping]]] = ..., oauth_status: _Optional[_Union[OAuthStatus, _Mapping]] = ..., connect_status: _Optional[_Union[ConnectStatus, _Mapping]] = ..., audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ...) -> None: ...

class ConnectStatus(_message.Message):
    __slots__ = ("phase", "workflow_id", "started_at", "finished_at", "failure_code", "failure_message", "warning")
    PHASE_FIELD_NUMBER: _ClassVar[int]
    WORKFLOW_ID_FIELD_NUMBER: _ClassVar[int]
    STARTED_AT_FIELD_NUMBER: _ClassVar[int]
    FINISHED_AT_FIELD_NUMBER: _ClassVar[int]
    FAILURE_CODE_FIELD_NUMBER: _ClassVar[int]
    FAILURE_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    WARNING_FIELD_NUMBER: _ClassVar[int]
    phase: ConnectPhase
    workflow_id: str
    started_at: _timestamp_pb2.Timestamp
    finished_at: _timestamp_pb2.Timestamp
    failure_code: str
    failure_message: str
    warning: str
    def __init__(self, phase: _Optional[_Union[ConnectPhase, str]] = ..., workflow_id: _Optional[str] = ..., started_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., finished_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., failure_code: _Optional[str] = ..., failure_message: _Optional[str] = ..., warning: _Optional[str] = ...) -> None: ...

class DiscoveredCapabilities(_message.Message):
    __slots__ = ("tools", "resource_templates", "last_discovered_at")
    TOOLS_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_TEMPLATES_FIELD_NUMBER: _ClassVar[int]
    LAST_DISCOVERED_AT_FIELD_NUMBER: _ClassVar[int]
    tools: _containers.RepeatedCompositeFieldContainer[DiscoveredTool]
    resource_templates: _containers.RepeatedCompositeFieldContainer[DiscoveredResourceTemplate]
    last_discovered_at: _timestamp_pb2.Timestamp
    def __init__(self, tools: _Optional[_Iterable[_Union[DiscoveredTool, _Mapping]]] = ..., resource_templates: _Optional[_Iterable[_Union[DiscoveredResourceTemplate, _Mapping]]] = ..., last_discovered_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

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

class OAuthStatus(_message.Message):
    __slots__ = ("vendor_approval_status", "vendor_approval_docs_url", "effective_oauth_source", "effective_oauth_app_id")
    VENDOR_APPROVAL_STATUS_FIELD_NUMBER: _ClassVar[int]
    VENDOR_APPROVAL_DOCS_URL_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_OAUTH_SOURCE_FIELD_NUMBER: _ClassVar[int]
    EFFECTIVE_OAUTH_APP_ID_FIELD_NUMBER: _ClassVar[int]
    vendor_approval_status: _spec_pb2_1.VendorApprovalStatus
    vendor_approval_docs_url: str
    effective_oauth_source: OAuthAppSource
    effective_oauth_app_id: str
    def __init__(self, vendor_approval_status: _Optional[_Union[_spec_pb2_1.VendorApprovalStatus, str]] = ..., vendor_approval_docs_url: _Optional[str] = ..., effective_oauth_source: _Optional[_Union[OAuthAppSource, str]] = ..., effective_oauth_app_id: _Optional[str] = ...) -> None: ...
