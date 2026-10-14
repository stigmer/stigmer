from ai.stigmer.iam.v1 import enum_pb2 as _enum_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class FederationIssuerSpec(_message.Message):
    __slots__ = ("display_name", "jwks_uri", "allowed_issuers", "expected_audience", "userinfo_endpoint", "external_id_claim", "create_accounts_on_sign_in", "sign_in_role")
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    JWKS_URI_FIELD_NUMBER: _ClassVar[int]
    ALLOWED_ISSUERS_FIELD_NUMBER: _ClassVar[int]
    EXPECTED_AUDIENCE_FIELD_NUMBER: _ClassVar[int]
    USERINFO_ENDPOINT_FIELD_NUMBER: _ClassVar[int]
    EXTERNAL_ID_CLAIM_FIELD_NUMBER: _ClassVar[int]
    CREATE_ACCOUNTS_ON_SIGN_IN_FIELD_NUMBER: _ClassVar[int]
    SIGN_IN_ROLE_FIELD_NUMBER: _ClassVar[int]
    display_name: str
    jwks_uri: str
    allowed_issuers: _containers.RepeatedScalarFieldContainer[str]
    expected_audience: str
    userinfo_endpoint: str
    external_id_claim: str
    create_accounts_on_sign_in: bool
    sign_in_role: _enum_pb2.IamRole
    def __init__(self, display_name: _Optional[str] = ..., jwks_uri: _Optional[str] = ..., allowed_issuers: _Optional[_Iterable[str]] = ..., expected_audience: _Optional[str] = ..., userinfo_endpoint: _Optional[str] = ..., external_id_claim: _Optional[str] = ..., create_accounts_on_sign_in: bool = ..., sign_in_role: _Optional[_Union[_enum_pb2.IamRole, str]] = ...) -> None: ...
