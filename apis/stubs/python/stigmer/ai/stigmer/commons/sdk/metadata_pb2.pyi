from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class SdkMetadata(_message.Message):
    __slots__ = ("language", "version", "project_name", "generated_at", "sdk_path", "host_environment")
    LANGUAGE_FIELD_NUMBER: _ClassVar[int]
    VERSION_FIELD_NUMBER: _ClassVar[int]
    PROJECT_NAME_FIELD_NUMBER: _ClassVar[int]
    GENERATED_AT_FIELD_NUMBER: _ClassVar[int]
    SDK_PATH_FIELD_NUMBER: _ClassVar[int]
    HOST_ENVIRONMENT_FIELD_NUMBER: _ClassVar[int]
    language: str
    version: str
    project_name: str
    generated_at: int
    sdk_path: str
    host_environment: str
    def __init__(self, language: _Optional[str] = ..., version: _Optional[str] = ..., project_name: _Optional[str] = ..., generated_at: _Optional[int] = ..., sdk_path: _Optional[str] = ..., host_environment: _Optional[str] = ...) -> None: ...
