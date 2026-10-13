import datetime

from ai.stigmer.iam.iampolicy.v1 import io_pb2 as _io_pb2
from ai.stigmer.iam.identityprovider.v1 import api_pb2 as _api_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import field_mask_pb2 as _field_mask_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class IdentityProviderId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class IdentityProviders(_message.Message):
    __slots__ = ("entries",)
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.IdentityProvider]
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.IdentityProvider, _Mapping]]] = ...) -> None: ...

class IdentityProviderList(_message.Message):
    __slots__ = ("total_pages", "entries")
    TOTAL_PAGES_FIELD_NUMBER: _ClassVar[int]
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    total_pages: int
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.IdentityProvider]
    def __init__(self, total_pages: _Optional[int] = ..., entries: _Optional[_Iterable[_Union[_api_pb2.IdentityProvider, _Mapping]]] = ...) -> None: ...

class ListIdentityProvidersByOrgInput(_message.Message):
    __slots__ = ("org",)
    ORG_FIELD_NUMBER: _ClassVar[int]
    org: str
    def __init__(self, org: _Optional[str] = ...) -> None: ...

class OrganizationSsoLookup(_message.Message):
    __slots__ = ("org",)
    ORG_FIELD_NUMBER: _ClassVar[int]
    org: str
    def __init__(self, org: _Optional[str] = ...) -> None: ...

class SsoProviderInfo(_message.Message):
    __slots__ = ("display_name", "oidc_client_id", "issuer", "expected_audience", "sso_required")
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    OIDC_CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    ISSUER_FIELD_NUMBER: _ClassVar[int]
    EXPECTED_AUDIENCE_FIELD_NUMBER: _ClassVar[int]
    SSO_REQUIRED_FIELD_NUMBER: _ClassVar[int]
    display_name: str
    oidc_client_id: str
    issuer: str
    expected_audience: str
    sso_required: bool
    def __init__(self, display_name: _Optional[str] = ..., oidc_client_id: _Optional[str] = ..., issuer: _Optional[str] = ..., expected_audience: _Optional[str] = ..., sso_required: bool = ...) -> None: ...

class AccessMoveRequest(_message.Message):
    __slots__ = ("org",)
    ORG_FIELD_NUMBER: _ClassVar[int]
    org: str
    def __init__(self, org: _Optional[str] = ...) -> None: ...

class AccessMoveTicket(_message.Message):
    __slots__ = ("ticket", "expires_at", "org", "provider", "preview", "invitation_ids")
    TICKET_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    PREVIEW_FIELD_NUMBER: _ClassVar[int]
    INVITATION_IDS_FIELD_NUMBER: _ClassVar[int]
    ticket: str
    expires_at: _timestamp_pb2.Timestamp
    org: str
    provider: SsoProviderInfo
    preview: _io_pb2.MoveOrgAccessResult
    invitation_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, ticket: _Optional[str] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., org: _Optional[str] = ..., provider: _Optional[_Union[SsoProviderInfo, _Mapping]] = ..., preview: _Optional[_Union[_io_pb2.MoveOrgAccessResult, _Mapping]] = ..., invitation_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class RedeemAccessMoveInput(_message.Message):
    __slots__ = ("ticket",)
    TICKET_FIELD_NUMBER: _ClassVar[int]
    ticket: str
    def __init__(self, ticket: _Optional[str] = ...) -> None: ...

class AccessMoveResult(_message.Message):
    __slots__ = ("org", "moved", "invitation_ids")
    ORG_FIELD_NUMBER: _ClassVar[int]
    MOVED_FIELD_NUMBER: _ClassVar[int]
    INVITATION_IDS_FIELD_NUMBER: _ClassVar[int]
    org: str
    moved: _io_pb2.MoveOrgAccessResult
    invitation_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, org: _Optional[str] = ..., moved: _Optional[_Union[_io_pb2.MoveOrgAccessResult, _Mapping]] = ..., invitation_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class SsoRequirementPreviewInput(_message.Message):
    __slots__ = ("org",)
    ORG_FIELD_NUMBER: _ClassVar[int]
    org: str
    def __init__(self, org: _Optional[str] = ...) -> None: ...

class SsoRequirementPreview(_message.Message):
    __slots__ = ("members", "exempt_owners")
    MEMBERS_FIELD_NUMBER: _ClassVar[int]
    EXEMPT_OWNERS_FIELD_NUMBER: _ClassVar[int]
    members: _containers.RepeatedCompositeFieldContainer[SsoRequirementMember]
    exempt_owners: _containers.RepeatedCompositeFieldContainer[SsoRequirementMember]
    def __init__(self, members: _Optional[_Iterable[_Union[SsoRequirementMember, _Mapping]]] = ..., exempt_owners: _Optional[_Iterable[_Union[SsoRequirementMember, _Mapping]]] = ...) -> None: ...

class SsoRequirementMember(_message.Message):
    __slots__ = ("identity_account_id", "email", "display_name", "invitation_ids", "automations")
    IDENTITY_ACCOUNT_ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    INVITATION_IDS_FIELD_NUMBER: _ClassVar[int]
    AUTOMATIONS_FIELD_NUMBER: _ClassVar[int]
    identity_account_id: str
    email: str
    display_name: str
    invitation_ids: _containers.RepeatedScalarFieldContainer[str]
    automations: _containers.RepeatedCompositeFieldContainer[_io_pb2.AccountAutomation]
    def __init__(self, identity_account_id: _Optional[str] = ..., email: _Optional[str] = ..., display_name: _Optional[str] = ..., invitation_ids: _Optional[_Iterable[str]] = ..., automations: _Optional[_Iterable[_Union[_io_pb2.AccountAutomation, _Mapping]]] = ...) -> None: ...

class UpdateIdentityProviderInput(_message.Message):
    __slots__ = ("resource", "update_mask")
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    UPDATE_MASK_FIELD_NUMBER: _ClassVar[int]
    resource: _api_pb2.IdentityProvider
    update_mask: _field_mask_pb2.FieldMask
    def __init__(self, resource: _Optional[_Union[_api_pb2.IdentityProvider, _Mapping]] = ..., update_mask: _Optional[_Union[_field_mask_pb2.FieldMask, _Mapping]] = ...) -> None: ...
