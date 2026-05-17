from ai.stigmer.agentic.workflow.v1 import enum_pb2 as _enum_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class TaskKindCategory(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TASK_KIND_CATEGORY_UNSPECIFIED: _ClassVar[TaskKindCategory]
    TASK_KIND_CATEGORY_CONTROL_FLOW: _ClassVar[TaskKindCategory]
    TASK_KIND_CATEGORY_INVOCATION: _ClassVar[TaskKindCategory]
    TASK_KIND_CATEGORY_AI: _ClassVar[TaskKindCategory]
    TASK_KIND_CATEGORY_DATA: _ClassVar[TaskKindCategory]
    TASK_KIND_CATEGORY_GOVERNANCE: _ClassVar[TaskKindCategory]
    TASK_KIND_CATEGORY_EVENT: _ClassVar[TaskKindCategory]

class TaskFieldType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    TASK_FIELD_TYPE_UNSPECIFIED: _ClassVar[TaskFieldType]
    TASK_FIELD_TYPE_STRING: _ClassVar[TaskFieldType]
    TASK_FIELD_TYPE_INT32: _ClassVar[TaskFieldType]
    TASK_FIELD_TYPE_FLOAT: _ClassVar[TaskFieldType]
    TASK_FIELD_TYPE_BOOL: _ClassVar[TaskFieldType]
    TASK_FIELD_TYPE_ENUM: _ClassVar[TaskFieldType]
    TASK_FIELD_TYPE_STRUCT: _ClassVar[TaskFieldType]
    TASK_FIELD_TYPE_REPEATED: _ClassVar[TaskFieldType]
    TASK_FIELD_TYPE_MAP: _ClassVar[TaskFieldType]
    TASK_FIELD_TYPE_MESSAGE: _ClassVar[TaskFieldType]
TASK_KIND_CATEGORY_UNSPECIFIED: TaskKindCategory
TASK_KIND_CATEGORY_CONTROL_FLOW: TaskKindCategory
TASK_KIND_CATEGORY_INVOCATION: TaskKindCategory
TASK_KIND_CATEGORY_AI: TaskKindCategory
TASK_KIND_CATEGORY_DATA: TaskKindCategory
TASK_KIND_CATEGORY_GOVERNANCE: TaskKindCategory
TASK_KIND_CATEGORY_EVENT: TaskKindCategory
TASK_FIELD_TYPE_UNSPECIFIED: TaskFieldType
TASK_FIELD_TYPE_STRING: TaskFieldType
TASK_FIELD_TYPE_INT32: TaskFieldType
TASK_FIELD_TYPE_FLOAT: TaskFieldType
TASK_FIELD_TYPE_BOOL: TaskFieldType
TASK_FIELD_TYPE_ENUM: TaskFieldType
TASK_FIELD_TYPE_STRUCT: TaskFieldType
TASK_FIELD_TYPE_REPEATED: TaskFieldType
TASK_FIELD_TYPE_MAP: TaskFieldType
TASK_FIELD_TYPE_MESSAGE: TaskFieldType

class TaskFieldGroup(_message.Message):
    __slots__ = ("id", "display_name", "description")
    ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    id: str
    display_name: str
    description: str
    def __init__(self, id: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ...) -> None: ...

class TaskFieldDescriptor(_message.Message):
    __slots__ = ("name", "display_name", "description", "type", "required", "is_expression", "default_value", "enum_values", "json_schema_fragment", "group_id", "field_number", "element_type", "validation_hints")
    NAME_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    TYPE_FIELD_NUMBER: _ClassVar[int]
    REQUIRED_FIELD_NUMBER: _ClassVar[int]
    IS_EXPRESSION_FIELD_NUMBER: _ClassVar[int]
    DEFAULT_VALUE_FIELD_NUMBER: _ClassVar[int]
    ENUM_VALUES_FIELD_NUMBER: _ClassVar[int]
    JSON_SCHEMA_FRAGMENT_FIELD_NUMBER: _ClassVar[int]
    GROUP_ID_FIELD_NUMBER: _ClassVar[int]
    FIELD_NUMBER_FIELD_NUMBER: _ClassVar[int]
    ELEMENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    VALIDATION_HINTS_FIELD_NUMBER: _ClassVar[int]
    name: str
    display_name: str
    description: str
    type: TaskFieldType
    required: bool
    is_expression: bool
    default_value: str
    enum_values: _containers.RepeatedScalarFieldContainer[str]
    json_schema_fragment: str
    group_id: str
    field_number: int
    element_type: str
    validation_hints: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, name: _Optional[str] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., type: _Optional[_Union[TaskFieldType, str]] = ..., required: bool = ..., is_expression: bool = ..., default_value: _Optional[str] = ..., enum_values: _Optional[_Iterable[str]] = ..., json_schema_fragment: _Optional[str] = ..., group_id: _Optional[str] = ..., field_number: _Optional[int] = ..., element_type: _Optional[str] = ..., validation_hints: _Optional[_Iterable[str]] = ...) -> None: ...

class TaskKindDescriptor(_message.Message):
    __slots__ = ("kind", "display_name", "description", "category", "icon", "config_proto_type", "fields", "field_groups", "config_json_schema", "output_json_schema", "yaml_examples", "documentation_url", "is_ai_native", "requires_external_service")
    KIND_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    DESCRIPTION_FIELD_NUMBER: _ClassVar[int]
    CATEGORY_FIELD_NUMBER: _ClassVar[int]
    ICON_FIELD_NUMBER: _ClassVar[int]
    CONFIG_PROTO_TYPE_FIELD_NUMBER: _ClassVar[int]
    FIELDS_FIELD_NUMBER: _ClassVar[int]
    FIELD_GROUPS_FIELD_NUMBER: _ClassVar[int]
    CONFIG_JSON_SCHEMA_FIELD_NUMBER: _ClassVar[int]
    OUTPUT_JSON_SCHEMA_FIELD_NUMBER: _ClassVar[int]
    YAML_EXAMPLES_FIELD_NUMBER: _ClassVar[int]
    DOCUMENTATION_URL_FIELD_NUMBER: _ClassVar[int]
    IS_AI_NATIVE_FIELD_NUMBER: _ClassVar[int]
    REQUIRES_EXTERNAL_SERVICE_FIELD_NUMBER: _ClassVar[int]
    kind: _enum_pb2.WorkflowTaskKind
    display_name: str
    description: str
    category: TaskKindCategory
    icon: str
    config_proto_type: str
    fields: _containers.RepeatedCompositeFieldContainer[TaskFieldDescriptor]
    field_groups: _containers.RepeatedCompositeFieldContainer[TaskFieldGroup]
    config_json_schema: str
    output_json_schema: str
    yaml_examples: _containers.RepeatedScalarFieldContainer[str]
    documentation_url: str
    is_ai_native: bool
    requires_external_service: bool
    def __init__(self, kind: _Optional[_Union[_enum_pb2.WorkflowTaskKind, str]] = ..., display_name: _Optional[str] = ..., description: _Optional[str] = ..., category: _Optional[_Union[TaskKindCategory, str]] = ..., icon: _Optional[str] = ..., config_proto_type: _Optional[str] = ..., fields: _Optional[_Iterable[_Union[TaskFieldDescriptor, _Mapping]]] = ..., field_groups: _Optional[_Iterable[_Union[TaskFieldGroup, _Mapping]]] = ..., config_json_schema: _Optional[str] = ..., output_json_schema: _Optional[str] = ..., yaml_examples: _Optional[_Iterable[str]] = ..., documentation_url: _Optional[str] = ..., is_ai_native: bool = ..., requires_external_service: bool = ...) -> None: ...

class GetTaskKindRegistryRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class GetTaskKindRegistryResponse(_message.Message):
    __slots__ = ("descriptors",)
    DESCRIPTORS_FIELD_NUMBER: _ClassVar[int]
    descriptors: _containers.RepeatedCompositeFieldContainer[TaskKindDescriptor]
    def __init__(self, descriptors: _Optional[_Iterable[_Union[TaskKindDescriptor, _Mapping]]] = ...) -> None: ...
