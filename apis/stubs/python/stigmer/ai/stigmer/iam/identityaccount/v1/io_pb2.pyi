from ai.stigmer.commons.rpc import pagination_pb2 as _pagination_pb2
from ai.stigmer.iam.identityaccount.v1 import api_pb2 as _api_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class IdentityAccounts(_message.Message):
    __slots__ = ("entries",)
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.IdentityAccount]
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.IdentityAccount, _Mapping]]] = ...) -> None: ...

class IdentityAccountId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class IdentityAccountEmail(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class IdpId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class ListWithIdentityAccountIdReq(_message.Message):
    __slots__ = ("identity_account_id", "page")
    IDENTITY_ACCOUNT_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    identity_account_id: str
    page: _pagination_pb2.PageInfo
    def __init__(self, identity_account_id: _Optional[str] = ..., page: _Optional[_Union[_pagination_pb2.PageInfo, _Mapping]] = ...) -> None: ...

class IdentityAccountsList(_message.Message):
    __slots__ = ("total_pages", "entries")
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    total_pages: int
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.IdentityAccount]
    def __init__(self, total_pages: _Optional[int] = ..., entries: _Optional[_Iterable[_Union[_api_pb2.IdentityAccount, _Mapping]]] = ...) -> None: ...

class ListWithIdentityOrg(_message.Message):
    __slots__ = ("org", "page")
    ORG_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    org: str
    page: _pagination_pb2.PageInfo
    def __init__(self, org: _Optional[str] = ..., page: _Optional[_Union[_pagination_pb2.PageInfo, _Mapping]] = ...) -> None: ...
