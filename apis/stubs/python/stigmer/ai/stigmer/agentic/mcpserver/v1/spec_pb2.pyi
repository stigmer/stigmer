from ai.stigmer.agentic.environment.v1 import spec_pb2 as _spec_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class McpServerSpec(_message.Message):
    __slots__ = ("description", "icon_url", "tags", "stdio", "http", "docker", "default_enabled_tools", "env_spec")
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_URL_FIELD_NUMBER: _ClassVar[int]
    TAGS_FIELD_NUMBER: _ClassVar[int]
    STDIO_FIELD_NUMBER: _ClassVar[int]
    HTTP_FIELD_NUMBER: _ClassVar[int]
    DOCKER_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_ENABLED_TOOLS_FIELD_NUMBER: _ClassVar[int]
    ENV_SPEC_FIELD_NUMBER: _ClassVar[int]
    description: str
    icon_url: str
    tags: _containers.RepeatedScalarFieldContainer[str]
    stdio: StdioServerConfig
    http: HttpServerConfig
    docker: DockerServerConfig
    default_enabled_tools: _containers.RepeatedScalarFieldContainer[str]
    env_spec: _spec_pb2.EnvironmentSpec
    def __init__(self, description: _Optional[str] = ..., icon_url: _Optional[str] = ..., tags: _Optional[_Iterable[str]] = ..., stdio: _Optional[_Union[StdioServerConfig, _Mapping]] = ..., http: _Optional[_Union[HttpServerConfig, _Mapping]] = ..., docker: _Optional[_Union[DockerServerConfig, _Mapping]] = ..., default_enabled_tools: _Optional[_Iterable[str]] = ..., env_spec: _Optional[_Union[_spec_pb2.EnvironmentSpec, _Mapping]] = ...) -> None: ...

class StdioServerConfig(_message.Message):
    __slots__ = ("command", "args", "working_dir")
    COMMAND_FIELD_NUMBER: _ClassVar[int]
    ARGS_FIELD_NUMBER: _ClassVar[int]
    WORKING_DIR_FIELD_NUMBER: _ClassVar[int]
    command: str
    args: _containers.RepeatedScalarFieldContainer[str]
    working_dir: str
    def __init__(self, command: _Optional[str] = ..., args: _Optional[_Iterable[str]] = ..., working_dir: _Optional[str] = ...) -> None: ...

class HttpServerConfig(_message.Message):
    __slots__ = ("url", "headers", "query_params", "timeout_seconds")
    class HeadersEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    class QueryParamsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    URL_FIELD_NUMBER: _ClassVar[int]
    HEADERS_FIELD_NUMBER: _ClassVar[int]
    QUERY_PARAMS_FIELD_NUMBER: _ClassVar[int]
    TIMEOUT_SECONDS_FIELD_NUMBER: _ClassVar[int]
    url: str
    headers: _containers.ScalarMap[str, str]
    query_params: _containers.ScalarMap[str, str]
    timeout_seconds: int
    def __init__(self, url: _Optional[str] = ..., headers: _Optional[_Mapping[str, str]] = ..., query_params: _Optional[_Mapping[str, str]] = ..., timeout_seconds: _Optional[int] = ...) -> None: ...

class DockerServerConfig(_message.Message):
    __slots__ = ("image", "args", "volumes", "network", "ports", "container_name")
    IMAGE_FIELD_NUMBER: _ClassVar[int]
    ARGS_FIELD_NUMBER: _ClassVar[int]
    VOLUMES_FIELD_NUMBER: _ClassVar[int]
    NETWORK_FIELD_NUMBER: _ClassVar[int]
    PORTS_FIELD_NUMBER: _ClassVar[int]
    CONTAINER_NAME_FIELD_NUMBER: _ClassVar[int]
    image: str
    args: _containers.RepeatedScalarFieldContainer[str]
    volumes: _containers.RepeatedCompositeFieldContainer[VolumeMount]
    network: str
    ports: _containers.RepeatedCompositeFieldContainer[PortMapping]
    container_name: str
    def __init__(self, image: _Optional[str] = ..., args: _Optional[_Iterable[str]] = ..., volumes: _Optional[_Iterable[_Union[VolumeMount, _Mapping]]] = ..., network: _Optional[str] = ..., ports: _Optional[_Iterable[_Union[PortMapping, _Mapping]]] = ..., container_name: _Optional[str] = ...) -> None: ...

class VolumeMount(_message.Message):
    __slots__ = ("host_path", "container_path", "read_only")
    HOST_PATH_FIELD_NUMBER: _ClassVar[int]
    CONTAINER_PATH_FIELD_NUMBER: _ClassVar[int]
    READ_ONLY_FIELD_NUMBER: _ClassVar[int]
    host_path: str
    container_path: str
    read_only: bool
    def __init__(self, host_path: _Optional[str] = ..., container_path: _Optional[str] = ..., read_only: bool = ...) -> None: ...

class PortMapping(_message.Message):
    __slots__ = ("host_port", "container_port", "protocol")
    HOST_PORT_FIELD_NUMBER: _ClassVar[int]
    CONTAINER_PORT_FIELD_NUMBER: _ClassVar[int]
    PROTOCOL_FIELD_NUMBER: _ClassVar[int]
    host_port: int
    container_port: int
    protocol: str
    def __init__(self, host_port: _Optional[int] = ..., container_port: _Optional[int] = ..., protocol: _Optional[str] = ...) -> None: ...
