import datetime

from ai.stigmer.agentic.file.v1 import api_pb2 as _api_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import field_mask_pb2 as _field_mask_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class FileId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class UploadFileInput(_message.Message):
    __slots__ = ("org", "session_id", "filename", "mime_type", "data", "upload_ref")
    ORG_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    DATA_FIELD_NUMBER: _ClassVar[int]
    UPLOAD_REF_FIELD_NUMBER: _ClassVar[int]
    org: str
    session_id: str
    filename: str
    mime_type: str
    data: bytes
    upload_ref: str
    def __init__(self, org: _Optional[str] = ..., session_id: _Optional[str] = ..., filename: _Optional[str] = ..., mime_type: _Optional[str] = ..., data: _Optional[bytes] = ..., upload_ref: _Optional[str] = ...) -> None: ...

class CreateFileUploadUrlInput(_message.Message):
    __slots__ = ("org", "session_id", "size_bytes")
    ORG_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    org: str
    session_id: str
    size_bytes: int
    def __init__(self, org: _Optional[str] = ..., session_id: _Optional[str] = ..., size_bytes: _Optional[int] = ...) -> None: ...

class FileUploadUrl(_message.Message):
    __slots__ = ("url", "upload_ref", "ttl_seconds")
    URL_FIELD_NUMBER: _ClassVar[int]
    UPLOAD_REF_FIELD_NUMBER: _ClassVar[int]
    TTL_SECONDS_FIELD_NUMBER: _ClassVar[int]
    url: str
    upload_ref: str
    ttl_seconds: int
    def __init__(self, url: _Optional[str] = ..., upload_ref: _Optional[str] = ..., ttl_seconds: _Optional[int] = ...) -> None: ...

class UpdateFileInput(_message.Message):
    __slots__ = ("resource", "update_mask")
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    UPDATE_MASK_FIELD_NUMBER: _ClassVar[int]
    resource: _api_pb2.File
    update_mask: _field_mask_pb2.FieldMask
    def __init__(self, resource: _Optional[_Union[_api_pb2.File, _Mapping]] = ..., update_mask: _Optional[_Union[_field_mask_pb2.FieldMask, _Mapping]] = ...) -> None: ...

class ListFilesRequest(_message.Message):
    __slots__ = ("org", "session_id", "page_size", "page_token", "labels", "run_id", "without_session")
    class LabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    ORG_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    WITHOUT_SESSION_FIELD_NUMBER: _ClassVar[int]
    org: str
    session_id: str
    page_size: int
    page_token: str
    labels: _containers.ScalarMap[str, str]
    run_id: str
    without_session: bool
    def __init__(self, org: _Optional[str] = ..., session_id: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., labels: _Optional[_Mapping[str, str]] = ..., run_id: _Optional[str] = ..., without_session: bool = ...) -> None: ...

class FileList(_message.Message):
    __slots__ = ("entries", "next_page_token")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.File]
    next_page_token: str
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.File, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class FileDownloadUrl(_message.Message):
    __slots__ = ("url", "expires_at")
    URL_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    url: str
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, url: _Optional[str] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class GetFileContentInput(_message.Message):
    __slots__ = ("id", "max_bytes")
    ID_FIELD_NUMBER: _ClassVar[int]
    MAX_BYTES_FIELD_NUMBER: _ClassVar[int]
    id: str
    max_bytes: int
    def __init__(self, id: _Optional[str] = ..., max_bytes: _Optional[int] = ...) -> None: ...

class FileContent(_message.Message):
    __slots__ = ("data", "truncated")
    DATA_FIELD_NUMBER: _ClassVar[int]
    TRUNCATED_FIELD_NUMBER: _ClassVar[int]
    data: bytes
    truncated: bool
    def __init__(self, data: _Optional[bytes] = ..., truncated: bool = ...) -> None: ...
