import datetime

from ai.stigmer.agentic.project.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.commons.apiresource import status_pb2 as _status_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ProjectStatus(_message.Message):
    __slots__ = ("audit", "reconciliation")
    AUDIT_FIELD_NUMBER: _ClassVar[int]
    RECONCILIATION_FIELD_NUMBER: _ClassVar[int]
    audit: _status_pb2.ApiResourceAudit
    reconciliation: ReconciliationSummary
    def __init__(self, audit: _Optional[_Union[_status_pb2.ApiResourceAudit, _Mapping]] = ..., reconciliation: _Optional[_Union[ReconciliationSummary, _Mapping]] = ...) -> None: ...

class ReconciliationSummary(_message.Message):
    __slots__ = ("last_reconciled_at", "result", "manifest_hash", "resource_counts")
    LAST_RECONCILED_AT_FIELD_NUMBER: _ClassVar[int]
    RESULT_FIELD_NUMBER: _ClassVar[int]
    MANIFEST_HASH_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_COUNTS_FIELD_NUMBER: _ClassVar[int]
    last_reconciled_at: _timestamp_pb2.Timestamp
    result: _enum_pb2.ReconciliationResult
    manifest_hash: str
    resource_counts: ResourceCounts
    def __init__(self, last_reconciled_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., result: _Optional[_Union[_enum_pb2.ReconciliationResult, str]] = ..., manifest_hash: _Optional[str] = ..., resource_counts: _Optional[_Union[ResourceCounts, _Mapping]] = ...) -> None: ...

class ResourceCounts(_message.Message):
    __slots__ = ("agents", "workflows", "skills", "mcp_servers")
    AGENTS_FIELD_NUMBER: _ClassVar[int]
    WORKFLOWS_FIELD_NUMBER: _ClassVar[int]
    SKILLS_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVERS_FIELD_NUMBER: _ClassVar[int]
    agents: int
    workflows: int
    skills: int
    mcp_servers: int
    def __init__(self, agents: _Optional[int] = ..., workflows: _Optional[int] = ..., skills: _Optional[int] = ..., mcp_servers: _Optional[int] = ...) -> None: ...
