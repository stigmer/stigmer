from ai.stigmer.agentic.file.v1 import api_pb2 as _api_pb2
from ai.stigmer.commons.rpc import method_options_pb2 as _method_options_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class MountRunFilesInput(_message.Message):
    __slots__ = ("run_id",)
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    run_id: str
    def __init__(self, run_id: _Optional[str] = ...) -> None: ...

class RunFileMounts(_message.Message):
    __slots__ = ("entries",)
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[FileMount]
    def __init__(self, entries: _Optional[_Iterable[_Union[FileMount, _Mapping]]] = ...) -> None: ...

class FileMount(_message.Message):
    __slots__ = ("file_id", "mount_path", "filename", "mime_type", "size_bytes", "url")
    FILE_ID_FIELD_NUMBER: _ClassVar[int]
    MOUNT_PATH_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    file_id: str
    mount_path: str
    filename: str
    mime_type: str
    size_bytes: int
    url: str
    def __init__(self, file_id: _Optional[str] = ..., mount_path: _Optional[str] = ..., filename: _Optional[str] = ..., mime_type: _Optional[str] = ..., size_bytes: _Optional[int] = ..., url: _Optional[str] = ...) -> None: ...

class CreateOutputUploadsInput(_message.Message):
    __slots__ = ("run_id", "entries")
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    run_id: str
    entries: _containers.RepeatedCompositeFieldContainer[OutputUploadRequest]
    def __init__(self, run_id: _Optional[str] = ..., entries: _Optional[_Iterable[_Union[OutputUploadRequest, _Mapping]]] = ...) -> None: ...

class OutputUploadRequest(_message.Message):
    __slots__ = ("output_path", "size_bytes")
    OUTPUT_PATH_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    output_path: str
    size_bytes: int
    def __init__(self, output_path: _Optional[str] = ..., size_bytes: _Optional[int] = ...) -> None: ...

class OutputUploads(_message.Message):
    __slots__ = ("entries",)
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[OutputUpload]
    def __init__(self, entries: _Optional[_Iterable[_Union[OutputUpload, _Mapping]]] = ...) -> None: ...

class OutputUpload(_message.Message):
    __slots__ = ("output_path", "upload_ref", "url", "ttl_seconds")
    OUTPUT_PATH_FIELD_NUMBER: _ClassVar[int]
    UPLOAD_REF_FIELD_NUMBER: _ClassVar[int]
    URL_FIELD_NUMBER: _ClassVar[int]
    TTL_SECONDS_FIELD_NUMBER: _ClassVar[int]
    output_path: str
    upload_ref: str
    url: str
    ttl_seconds: int
    def __init__(self, output_path: _Optional[str] = ..., upload_ref: _Optional[str] = ..., url: _Optional[str] = ..., ttl_seconds: _Optional[int] = ...) -> None: ...

class RegisterOutputsInput(_message.Message):
    __slots__ = ("run_id", "entries")
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    run_id: str
    entries: _containers.RepeatedCompositeFieldContainer[OutputToRegister]
    def __init__(self, run_id: _Optional[str] = ..., entries: _Optional[_Iterable[_Union[OutputToRegister, _Mapping]]] = ...) -> None: ...

class OutputToRegister(_message.Message):
    __slots__ = ("output_path", "upload_ref", "content_sha256")
    OUTPUT_PATH_FIELD_NUMBER: _ClassVar[int]
    UPLOAD_REF_FIELD_NUMBER: _ClassVar[int]
    CONTENT_SHA256_FIELD_NUMBER: _ClassVar[int]
    output_path: str
    upload_ref: str
    content_sha256: str
    def __init__(self, output_path: _Optional[str] = ..., upload_ref: _Optional[str] = ..., content_sha256: _Optional[str] = ...) -> None: ...

class RegisteredOutputs(_message.Message):
    __slots__ = ("files",)
    FILES_FIELD_NUMBER: _ClassVar[int]
    files: _containers.RepeatedCompositeFieldContainer[_api_pb2.File]
    def __init__(self, files: _Optional[_Iterable[_Union[_api_pb2.File, _Mapping]]] = ...) -> None: ...
