from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class CredentialSource(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    credential_source_unspecified: _ClassVar[CredentialSource]
    credential_source_static: _ClassVar[CredentialSource]
    credential_source_oauth: _ClassVar[CredentialSource]
credential_source_unspecified: CredentialSource
credential_source_static: CredentialSource
credential_source_oauth: CredentialSource

class CredentialStatus(_message.Message):
    __slots__ = ("audit", "source")
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    SOURCE_FIELD_NUMBER: _ClassVar[int]
    audit: _status_pb2.ApiResourceAudit
    source: CredentialSource
    def __init__(self, audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ..., source: _Optional[_Union[CredentialSource, str]] = ...) -> None: ...
