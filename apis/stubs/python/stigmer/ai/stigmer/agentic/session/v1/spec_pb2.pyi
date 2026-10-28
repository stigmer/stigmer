from ai.stigmer.agentic.session.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.session.v1 import resource_pb2 as _resource_pb2
from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from ai.stigmer.commons.apiresource import io_pb2 as _io_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SessionSpec(_message.Message):
    __slots__ = ("agent_ref", "subject", "metadata", "skill_refs", "harness", "execution_target", "vaults", "include_my_vault", "plugins", "file_review", "environment_ref", "resources")
    class MetadataEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    AGENT_REF_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_FIELD_NUMBER: _ClassVar[int]
    METADATA_FIELD_NUMBER: _ClassVar[int]
    SKILL_REFS_FIELD_NUMBER: _ClassVar[int]
    HARNESS_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_TARGET_FIELD_NUMBER: _ClassVar[int]
    VAULTS_FIELD_NUMBER: _ClassVar[int]
    INCLUDE_MY_VAULT_FIELD_NUMBER: _ClassVar[int]
    PLUGINS_FIELD_NUMBER: _ClassVar[int]
    FILE_REVIEW_FIELD_NUMBER: _ClassVar[int]
    ENVIRONMENT_REF_FIELD_NUMBER: _ClassVar[int]
    RESOURCES_FIELD_NUMBER: _ClassVar[int]
    agent_ref: _io_pb2.ApiResourceReference
    subject: str
    metadata: _containers.ScalarMap[str, str]
    skill_refs: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    harness: _enum_pb2.Harness
    execution_target: _enum_pb2.ExecutionTarget
    vaults: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    include_my_vault: bool
    plugins: _containers.RepeatedCompositeFieldContainer[_io_pb2.ApiResourceReference]
    file_review: bool
    environment_ref: _io_pb2.ApiResourceReference
    resources: _containers.RepeatedCompositeFieldContainer[_resource_pb2.SessionResource]
    def __init__(self, agent_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., subject: _Optional[str] = ..., metadata: _Optional[_Mapping[str, str]] = ..., skill_refs: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ..., harness: _Optional[_Union[_enum_pb2.Harness, str]] = ..., execution_target: _Optional[_Union[_enum_pb2.ExecutionTarget, str]] = ..., vaults: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ..., include_my_vault: bool = ..., plugins: _Optional[_Iterable[_Union[_io_pb2.ApiResourceReference, _Mapping]]] = ..., file_review: bool = ..., environment_ref: _Optional[_Union[_io_pb2.ApiResourceReference, _Mapping]] = ..., resources: _Optional[_Iterable[_Union[_resource_pb2.SessionResource, _Mapping]]] = ...) -> None: ...
