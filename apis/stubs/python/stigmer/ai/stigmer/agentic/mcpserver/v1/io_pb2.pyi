from ai.stigmer.agentic.mcpserver.v1 import status_pb2 as _status_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class McpServerId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class UpdateDiscoveredCapabilitiesInput(_message.Message):
    __slots__ = ("mcp_server_id", "discovered_capabilities")
    MCP_SERVER_ID_FIELD_NUMBER: _ClassVar[int]
    DISCOVERED_CAPABILITIES_FIELD_NUMBER: _ClassVar[int]
    mcp_server_id: str
    discovered_capabilities: _status_pb2.DiscoveredCapabilities
    def __init__(self, mcp_server_id: _Optional[str] = ..., discovered_capabilities: _Optional[_Union[_status_pb2.DiscoveredCapabilities, _Mapping]] = ...) -> None: ...

class DiscoverCapabilitiesInput(_message.Message):
    __slots__ = ("mcp_server_id",)
    MCP_SERVER_ID_FIELD_NUMBER: _ClassVar[int]
    mcp_server_id: str
    def __init__(self, mcp_server_id: _Optional[str] = ...) -> None: ...
