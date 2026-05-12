from ai.stigmer.agentic.workflow.v1.tasks import common_pb2 as _common_pb2
from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import struct_pb2 as _struct_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class LlmCallTaskConfig(_message.Message):
    __slots__ = ("model", "system_prompt", "prompt", "response_schema", "temperature", "max_tokens", "timeout", "on_invalid", "max_retries", "fallback_task")
    MODEL_FIELD_NUMBER: _ClassVar[int]
    SYSTEM_PROMPT_FIELD_NUMBER: _ClassVar[int]
    PROMPT_FIELD_NUMBER: _ClassVar[int]
    RESPONSE_SCHEMA_FIELD_NUMBER: _ClassVar[int]
    TEMPERATURE_FIELD_NUMBER: _ClassVar[int]
    MAX_TOKENS_FIELD_NUMBER: _ClassVar[int]
    TIMEOUT_FIELD_NUMBER: _ClassVar[int]
    ON_INVALID_FIELD_NUMBER: _ClassVar[int]
    MAX_RETRIES_FIELD_NUMBER: _ClassVar[int]
    FALLBACK_TASK_FIELD_NUMBER: _ClassVar[int]
    model: str
    system_prompt: str
    prompt: str
    response_schema: _struct_pb2.Struct
    temperature: float
    max_tokens: int
    timeout: int
    on_invalid: _common_pb2.OnInvalidOutputPolicy
    max_retries: int
    fallback_task: str
    def __init__(self, model: _Optional[str] = ..., system_prompt: _Optional[str] = ..., prompt: _Optional[str] = ..., response_schema: _Optional[_Union[_struct_pb2.Struct, _Mapping]] = ..., temperature: _Optional[float] = ..., max_tokens: _Optional[int] = ..., timeout: _Optional[int] = ..., on_invalid: _Optional[_Union[_common_pb2.OnInvalidOutputPolicy, str]] = ..., max_retries: _Optional[int] = ..., fallback_task: _Optional[str] = ...) -> None: ...
