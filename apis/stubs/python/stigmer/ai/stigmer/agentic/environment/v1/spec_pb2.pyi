from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class NetworkingType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    networking_type_unspecified: _ClassVar[NetworkingType]
    unrestricted: _ClassVar[NetworkingType]
    limited: _ClassVar[NetworkingType]
networking_type_unspecified: NetworkingType
unrestricted: NetworkingType
limited: NetworkingType

class EnvironmentSpec(_message.Message):
    __slots__ = ("description", "networking", "packages")
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    NETWORKING_FIELD_NUMBER: _ClassVar[int]
    PACKAGES_FIELD_NUMBER: _ClassVar[int]
    description: str
    networking: EnvironmentNetworking
    packages: EnvironmentPackages
    def __init__(self, description: _Optional[str] = ..., networking: _Optional[_Union[EnvironmentNetworking, _Mapping]] = ..., packages: _Optional[_Union[EnvironmentPackages, _Mapping]] = ...) -> None: ...

class EnvironmentNetworking(_message.Message):
    __slots__ = ("type", "allowed_hosts", "allow_package_managers", "allow_mcp_servers")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    ALLOWED_HOSTS_FIELD_NUMBER: _ClassVar[int]
    ALLOW_PACKAGE_MANAGERS_FIELD_NUMBER: _ClassVar[int]
    ALLOW_MCP_SERVERS_FIELD_NUMBER: _ClassVar[int]
    type: NetworkingType
    allowed_hosts: _containers.RepeatedScalarFieldContainer[str]
    allow_package_managers: bool
    allow_mcp_servers: bool
    def __init__(self, type: _Optional[_Union[NetworkingType, str]] = ..., allowed_hosts: _Optional[_Iterable[str]] = ..., allow_package_managers: bool = ..., allow_mcp_servers: bool = ...) -> None: ...

class EnvironmentPackages(_message.Message):
    __slots__ = ("apt", "cargo", "gem", "go", "npm", "pip")
    APT_FIELD_NUMBER: _ClassVar[int]
    CARGO_FIELD_NUMBER: _ClassVar[int]
    GEM_FIELD_NUMBER: _ClassVar[int]
    GO_FIELD_NUMBER: _ClassVar[int]
    NPM_FIELD_NUMBER: _ClassVar[int]
    PIP_FIELD_NUMBER: _ClassVar[int]
    apt: _containers.RepeatedScalarFieldContainer[str]
    cargo: _containers.RepeatedScalarFieldContainer[str]
    gem: _containers.RepeatedScalarFieldContainer[str]
    go: _containers.RepeatedScalarFieldContainer[str]
    npm: _containers.RepeatedScalarFieldContainer[str]
    pip: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, apt: _Optional[_Iterable[str]] = ..., cargo: _Optional[_Iterable[str]] = ..., gem: _Optional[_Iterable[str]] = ..., go: _Optional[_Iterable[str]] = ..., npm: _Optional[_Iterable[str]] = ..., pip: _Optional[_Iterable[str]] = ...) -> None: ...
