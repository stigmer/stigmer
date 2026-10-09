from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class EvaluatorSpec(_message.Message):
    __slots__ = ("agent_id", "enabled", "sample_rate", "monthly_limit_usd", "model_name")
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    ENABLED_FIELD_NUMBER: _ClassVar[int]
    SAMPLE_RATE_FIELD_NUMBER: _ClassVar[int]
    MONTHLY_LIMIT_USD_FIELD_NUMBER: _ClassVar[int]
    MODEL_NAME_FIELD_NUMBER: _ClassVar[int]
    agent_id: str
    enabled: bool
    sample_rate: float
    monthly_limit_usd: float
    model_name: str
    def __init__(self, agent_id: _Optional[str] = ..., enabled: bool = ..., sample_rate: _Optional[float] = ..., monthly_limit_usd: _Optional[float] = ..., model_name: _Optional[str] = ...) -> None: ...
