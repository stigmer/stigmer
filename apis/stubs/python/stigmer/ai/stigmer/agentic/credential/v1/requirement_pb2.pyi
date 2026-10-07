from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class EnvVarDeclaration(_message.Message):
    __slots__ = ("is_secret", "description", "optional")
    IS_SECRET_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    OPTIONAL_FIELD_NUMBER: _ClassVar[int]
    is_secret: bool
    description: str
    optional: bool
    def __init__(self, is_secret: bool = ..., description: _Optional[str] = ..., optional: bool = ...) -> None: ...

class CredentialTarget(_message.Message):
    __slots__ = ("mcp_server", "agent", "git_host")
    MCP_SERVER_FIELD_NUMBER: _ClassVar[int]
    AGENT_FIELD_NUMBER: _ClassVar[int]
    GIT_HOST_FIELD_NUMBER: _ClassVar[int]
    mcp_server: _io_pb2.ApiResourceReference
    agent: _io_pb2.ApiResourceReference
    git_host: str
    def __init__(self, mcp_server: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., agent: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., git_host: _Optional[str] = ...) -> None: ...

class RequirementRef(_message.Message):
    __slots__ = ("declarer", "key")
    DECLARER_FIELD_NUMBER: _ClassVar[int]
    KEY_FIELD_NUMBER: _ClassVar[int]
    declarer: CredentialTarget
    key: str
    def __init__(self, declarer: _Optional[_Union[CredentialTarget, _Mapping]] = ..., key: _Optional[str] = ...) -> None: ...

class CredentialFieldRef(_message.Message):
    __slots__ = ("credential", "field")
    CREDENTIAL_FIELD_NUMBER: _ClassVar[int]
    FIELD_FIELD_NUMBER: _ClassVar[int]
    credential: _io_pb2.ApiResourceReference
    field: str
    def __init__(self, credential: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., field: _Optional[str] = ...) -> None: ...

class CredentialAssignment(_message.Message):
    __slots__ = ("requirement", "credential", "literal", "writer")
    REQUIREMENT_FIELD_NUMBER: _ClassVar[int]
    CREDENTIAL_FIELD_NUMBER: _ClassVar[int]
    LITERAL_FIELD_NUMBER: _ClassVar[int]
    WRITER_FIELD_NUMBER: _ClassVar[int]
    requirement: RequirementRef
    credential: CredentialFieldRef
    literal: str
    writer: str
    def __init__(self, requirement: _Optional[_Union[RequirementRef, _Mapping]] = ..., credential: _Optional[_Union[CredentialFieldRef, _Mapping]] = ..., literal: _Optional[str] = ..., writer: _Optional[str] = ...) -> None: ...
