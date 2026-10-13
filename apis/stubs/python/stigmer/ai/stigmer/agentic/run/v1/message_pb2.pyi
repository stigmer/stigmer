from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ToolCallOutputRef(_message.Message):
    __slots__ = ("storage_key", "size_bytes", "content_hash", "mime_type", "is_image", "truncated_preview")
    STORAGE_KEY_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    CONTENT_HASH_FIELD_NUMBER: _ClassVar[int]
    MIME_TYPE_FIELD_NUMBER: _ClassVar[int]
    IS_IMAGE_FIELD_NUMBER: _ClassVar[int]
    TRUNCATED_PREVIEW_FIELD_NUMBER: _ClassVar[int]
    storage_key: str
    size_bytes: int
    content_hash: str
    mime_type: str
    is_image: bool
    truncated_preview: str
    def __init__(self, storage_key: _Optional[str] = ..., size_bytes: _Optional[int] = ..., content_hash: _Optional[str] = ..., mime_type: _Optional[str] = ..., is_image: bool = ..., truncated_preview: _Optional[str] = ...) -> None: ...

class FileContent(_message.Message):
    __slots__ = ("inline", "ref", "is_binary")
    INLINE_FIELD_NUMBER: _ClassVar[int]
    REF_FIELD_NUMBER: _ClassVar[int]
    IS_BINARY_FIELD_NUMBER: _ClassVar[int]
    inline: str
    ref: ToolCallOutputRef
    is_binary: bool
    def __init__(self, inline: _Optional[str] = ..., ref: _Optional[_Union[ToolCallOutputRef, _Mapping]] = ..., is_binary: bool = ...) -> None: ...
