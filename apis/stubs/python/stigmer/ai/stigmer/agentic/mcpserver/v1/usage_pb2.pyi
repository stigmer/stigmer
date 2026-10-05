from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class McpServerUsage(_message.Message):
    __slots__ = ("mcp_server_ref",)
    MCP_SERVER_REF_FIELD_NUMBER: _ClassVar[int]
    mcp_server_ref: _io_pb2.ApiResourceReference
    def __init__(self, mcp_server_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ...) -> None: ...
