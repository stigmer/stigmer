from ai.stigmer.platform.v1 import entitlement_pb2 as _entitlement_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class GetSubscriptionForOrganizationInput(_message.Message):
    __slots__ = ("org_id",)
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    def __init__(self, org_id: _Optional[str] = ...) -> None: ...

class GetEntitlementsInput(_message.Message):
    __slots__ = ("org_id",)
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    def __init__(self, org_id: _Optional[str] = ...) -> None: ...

class GetEntitlementsOutput(_message.Message):
    __slots__ = ("entitlements", "plan_id")
    ENTITLEMENTS_FIELD_NUMBER: _ClassVar[int]
    PLAN_ID_FIELD_NUMBER: _ClassVar[int]
    entitlements: _entitlement_pb2.Entitlements
    plan_id: str
    def __init__(self, entitlements: _Optional[_Union[_entitlement_pb2.Entitlements, _Mapping]] = ..., plan_id: _Optional[str] = ...) -> None: ...

class ChangePlanInput(_message.Message):
    __slots__ = ("org_id", "plan_id")
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    PLAN_ID_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    plan_id: str
    def __init__(self, org_id: _Optional[str] = ..., plan_id: _Optional[str] = ...) -> None: ...

class CancelSubscriptionInput(_message.Message):
    __slots__ = ("org_id",)
    ORG_ID_FIELD_NUMBER: _ClassVar[int]
    org_id: str
    def __init__(self, org_id: _Optional[str] = ...) -> None: ...
