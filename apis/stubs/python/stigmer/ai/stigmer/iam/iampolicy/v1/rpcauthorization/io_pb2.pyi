from ai.stigmer.commons.apiresource.apiresourcekind import api_resource_kind_pb2 as _api_resource_kind_pb2
from ai.stigmer.iam.iampolicy.v1.rpcauthorization import iam_permission_pb2 as _iam_permission_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class RpcAuthorizationConfig(_message.Message):
    __slots__ = ("permission", "resource_kind", "resource_kind_path", "field_path", "error_msg", "resource_id")
    PERMISSION_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_KIND_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_KIND_PATH_FIELD_NUMBER: _ClassVar[int]
    FIELD_PATH_FIELD_NUMBER: _ClassVar[int]
    ERROR_MSG_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    permission: _iam_permission_pb2.ApiResourceIamPermission
    resource_kind: _api_resource_kind_pb2.ApiResourceKind
    resource_kind_path: str
    field_path: str
    error_msg: str
    resource_id: str
    def __init__(self, permission: _Optional[_Union[_iam_permission_pb2.ApiResourceIamPermission, str]] = ..., resource_kind: _Optional[_Union[_api_resource_kind_pb2.ApiResourceKind, str]] = ..., resource_kind_path: _Optional[str] = ..., field_path: _Optional[str] = ..., error_msg: _Optional[str] = ..., resource_id: _Optional[str] = ...) -> None: ...
