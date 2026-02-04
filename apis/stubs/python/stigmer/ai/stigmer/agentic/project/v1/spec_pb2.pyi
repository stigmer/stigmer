from ai.stigmer.agentic.agent.v1 import api_pb2 as _api_pb2
from ai.stigmer.agentic.mcpserver.v1 import api_pb2 as _api_pb2_1
from ai.stigmer.agentic.project.v1 import enum_pb2 as _enum_pb2
from ai.stigmer.agentic.skill.v1 import api_pb2 as _api_pb2_1_1
from ai.stigmer.agentic.workflow.v1 import api_pb2 as _api_pb2_1_1_1
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ProjectSpec(_message.Message):
    __slots__ = ("runtime", "entry_point", "description", "agents", "workflows", "mcp_servers", "skills")
    RUNTIME_FIELD_NUMBER: _ClassVar[int]
    ENTRY_POINT_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    AGENTS_FIELD_NUMBER: _ClassVar[int]
    WORKFLOWS_FIELD_NUMBER: _ClassVar[int]
    MCP_SERVERS_FIELD_NUMBER: _ClassVar[int]
    SKILLS_FIELD_NUMBER: _ClassVar[int]
    runtime: _enum_pb2.ProjectRuntime
    entry_point: str
    description: str
    agents: _containers.RepeatedCompositeFieldContainer[_api_pb2.Agent]
    workflows: _containers.RepeatedCompositeFieldContainer[_api_pb2_1_1_1.Workflow]
    mcp_servers: _containers.RepeatedCompositeFieldContainer[_api_pb2_1.McpServer]
    skills: _containers.RepeatedCompositeFieldContainer[_api_pb2_1_1.Skill]
    def __init__(self, runtime: _Optional[_Union[_enum_pb2.ProjectRuntime, str]] = ..., entry_point: _Optional[str] = ..., description: _Optional[str] = ..., agents: _Optional[_Iterable[_Union[_api_pb2.Agent, _Mapping]]] = ..., workflows: _Optional[_Iterable[_Union[_api_pb2_1_1_1.Workflow, _Mapping]]] = ..., mcp_servers: _Optional[_Iterable[_Union[_api_pb2_1.McpServer, _Mapping]]] = ..., skills: _Optional[_Iterable[_Union[_api_pb2_1_1.Skill, _Mapping]]] = ...) -> None: ...
