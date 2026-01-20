from ai.stigmer.agentic.workflow.v1 import api_pb2 as _api_pb2
from ai.stigmer.commons.sdk import metadata_pb2 as _metadata_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class WorkflowManifest(_message.Message):
    __slots__ = ("sdk_metadata", "workflows")
    SDK_METADATA_FIELD_NUMBER: _ClassVar[int]
    WORKFLOWS_FIELD_NUMBER: _ClassVar[int]
    sdk_metadata: _metadata_pb2.SdkMetadata
    workflows: _containers.RepeatedCompositeFieldContainer[_api_pb2.Workflow]
    def __init__(self, sdk_metadata: _Optional[_Union[_metadata_pb2.SdkMetadata, _Mapping]] = ..., workflows: _Optional[_Iterable[_Union[_api_pb2.Workflow, _Mapping]]] = ...) -> None: ...
