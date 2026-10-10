from ai.stigmer.tenancy.organization.v1 import api_pb2 as _api_pb2
from ai.stigmer.tenancy.organization.v1 import spec_pb2 as _spec_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class Organizations(_message.Message):
    __slots__ = ("entries",)
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.Organization]
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.Organization, _Mapping]]] = ...) -> None: ...

class OrganizationList(_message.Message):
    __slots__ = ("total_pages", "entries")
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    total_pages: int
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.Organization]
    def __init__(self, total_pages: _Optional[int] = ..., entries: _Optional[_Iterable[_Union[_api_pb2.Organization, _Mapping]]] = ...) -> None: ...

class OrganizationId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class OrganizationExternalLookup(_message.Message):
    __slots__ = ("external_id", "parent_org")
    EXTERNAL_ID_FIELD_NUMBER: _ClassVar[int]
    PARENT_ORG_FIELD_NUMBER: _ClassVar[int]
    external_id: str
    parent_org: str
    def __init__(self, external_id: _Optional[str] = ..., parent_org: _Optional[str] = ...) -> None: ...

class ListChildOrgsInput(_message.Message):
    __slots__ = ("org", "page_size", "page_token")
    ORG_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    org: str
    page_size: int
    page_token: str
    def __init__(self, org: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

class ChildOrgList(_message.Message):
    __slots__ = ("entries", "next_page_token")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.Organization]
    next_page_token: str
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.Organization, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class UpdateOrganizationPoliciesInput(_message.Message):
    __slots__ = ("org_id", "policies")
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    POLICIES_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    policies: _spec_pb2.OrganizationPolicies
    def __init__(self, org_id: _Optional[str] = ..., policies: _Optional[_Union[_spec_pb2.OrganizationPolicies, _Mapping]] = ...) -> None: ...
