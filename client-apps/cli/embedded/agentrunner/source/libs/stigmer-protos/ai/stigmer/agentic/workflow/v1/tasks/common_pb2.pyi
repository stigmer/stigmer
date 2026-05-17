from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from typing import ClassVar as _ClassVar

DESCRIPTOR: _descriptor.FileDescriptor

class OnInvalidOutputPolicy(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    ON_INVALID_POLICY_UNSPECIFIED: _ClassVar[OnInvalidOutputPolicy]
    ON_INVALID_FAIL: _ClassVar[OnInvalidOutputPolicy]
    ON_INVALID_RETRY: _ClassVar[OnInvalidOutputPolicy]
    ON_INVALID_FALLBACK: _ClassVar[OnInvalidOutputPolicy]
ON_INVALID_POLICY_UNSPECIFIED: OnInvalidOutputPolicy
ON_INVALID_FAIL: OnInvalidOutputPolicy
ON_INVALID_RETRY: OnInvalidOutputPolicy
ON_INVALID_FALLBACK: OnInvalidOutputPolicy
