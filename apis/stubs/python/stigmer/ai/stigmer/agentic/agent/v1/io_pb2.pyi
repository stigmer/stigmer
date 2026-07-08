from ai.stigmer.agentic.agent.v1 import spec_pb2 as _spec_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AgentId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class UpdateAgentSharingInput(_message.Message):
    __slots__ = ("resource_id", "sharing")
    RESOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    SHARING_FIELD_NUMBER: _ClassVar[int]
    resource_id: str
    sharing: _spec_pb2.AgentSharing
    def __init__(self, resource_id: _Optional[str] = ..., sharing: _Optional[_Union[_spec_pb2.AgentSharing, _Mapping]] = ...) -> None: ...

class SharedAgentProfile(_message.Message):
    __slots__ = ("org", "slug", "name", "description", "icon_url", "default_instance_id")
    ORG_FIELD_NUMBER: _ClassVar[int]
    SLUG_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    ICON_URL_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_INSTANCE_ID_FIELD_NUMBER: _ClassVar[int]
    org: str
    slug: str
    name: str
    description: str
    icon_url: str
    default_instance_id: str
    def __init__(self, org: _Optional[str] = ..., slug: _Optional[str] = ..., name: _Optional[str] = ..., description: _Optional[str] = ..., icon_url: _Optional[str] = ..., default_instance_id: _Optional[str] = ...) -> None: ...

class GetDefaultAgentRequest(_message.Message):
    __slots__ = ("org",)
    ORG_FIELD_NUMBER: _ClassVar[int]
    org: str
    def __init__(self, org: _Optional[str] = ...) -> None: ...
