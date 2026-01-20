from ai.stigmer.agentic.agentexecution.v1 import api_pb2 as _api_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from ai.stigmer.commons.apiresource import rpc_service_options_pb2 as _rpc_service_options_pb2
from ai.stigmer.iam.iampolicy.v1.rpcauthorization import method_options_pb2 as _method_options_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentExecutionUpdateStatusInput(_message.Message):
    __slots__ = ("execution_id", "status")
    EXECUTION_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    execution_id: str
    status: _api_pb2.AgentExecutionStatus
    def __init__(self, execution_id: _Optional[str] = ..., status: _Optional[_Union[_api_pb2.AgentExecutionStatus, _Mapping]] = ...) -> None: ...
