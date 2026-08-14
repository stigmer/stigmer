from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class VendorApprovalStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    VENDOR_APPROVAL_STATUS_UNSPECIFIED: _ClassVar[VendorApprovalStatus]
    VENDOR_APPROVAL_STATUS_PENDING: _ClassVar[VendorApprovalStatus]
    VENDOR_APPROVAL_STATUS_APPROVED: _ClassVar[VendorApprovalStatus]
    VENDOR_APPROVAL_STATUS_REJECTED: _ClassVar[VendorApprovalStatus]

class TokenEndpointAuthMethod(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TOKEN_ENDPOINT_AUTH_METHOD_UNSPECIFIED: _ClassVar[TokenEndpointAuthMethod]
    TOKEN_ENDPOINT_AUTH_METHOD_CLIENT_SECRET_BASIC: _ClassVar[TokenEndpointAuthMethod]
    TOKEN_ENDPOINT_AUTH_METHOD_CLIENT_SECRET_POST: _ClassVar[TokenEndpointAuthMethod]
VENDOR_APPROVAL_STATUS_UNSPECIFIED: VendorApprovalStatus
VENDOR_APPROVAL_STATUS_PENDING: VendorApprovalStatus
VENDOR_APPROVAL_STATUS_APPROVED: VendorApprovalStatus
VENDOR_APPROVAL_STATUS_REJECTED: VendorApprovalStatus
TOKEN_ENDPOINT_AUTH_METHOD_UNSPECIFIED: TokenEndpointAuthMethod
TOKEN_ENDPOINT_AUTH_METHOD_CLIENT_SECRET_BASIC: TokenEndpointAuthMethod
TOKEN_ENDPOINT_AUTH_METHOD_CLIENT_SECRET_POST: TokenEndpointAuthMethod

class OAuthAppSpec(_message.Message):
    __slots__ = ("provider", "client_id", "client_secret", "authorization_url", "token_url", "scopes", "userinfo_url", "scope_parameter_name", "vendor_approval_status", "vendor_approval_docs_url", "token_endpoint_auth_method")
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    CLIENT_ID_FIELD_NUMBER: _ClassVar[int]
    CLIENT_SECRET_FIELD_NUMBER: _ClassVar[int]
    AUTHORIZATION_URL_FIELD_NUMBER: _ClassVar[int]
    TOKEN_URL_FIELD_NUMBER: _ClassVar[int]
    SCOPES_FIELD_NUMBER: _ClassVar[int]
    USERINFO_URL_FIELD_NUMBER: _ClassVar[int]
    SCOPE_PARAMETER_NAME_FIELD_NUMBER: _ClassVar[int]
    VENDOR_APPROVAL_STATUS_FIELD_NUMBER: _ClassVar[int]
    VENDOR_APPROVAL_DOCS_URL_FIELD_NUMBER: _ClassVar[int]
    TOKEN_ENDPOINT_AUTH_METHOD_FIELD_NUMBER: _ClassVar[int]
    provider: str
    client_id: str
    client_secret: str
    authorization_url: str
    token_url: str
    scopes: _containers.RepeatedScalarFieldContainer[str]
    userinfo_url: str
    scope_parameter_name: str
    vendor_approval_status: VendorApprovalStatus
    vendor_approval_docs_url: str
    token_endpoint_auth_method: TokenEndpointAuthMethod
    def __init__(self, provider: _Optional[str] = ..., client_id: _Optional[str] = ..., client_secret: _Optional[str] = ..., authorization_url: _Optional[str] = ..., token_url: _Optional[str] = ..., scopes: _Optional[_Iterable[str]] = ..., userinfo_url: _Optional[str] = ..., scope_parameter_name: _Optional[str] = ..., vendor_approval_status: _Optional[_Union[VendorApprovalStatus, str]] = ..., vendor_approval_docs_url: _Optional[str] = ..., token_endpoint_auth_method: _Optional[_Union[TokenEndpointAuthMethod, str]] = ...) -> None: ...
