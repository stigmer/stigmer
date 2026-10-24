from ai.stigmer.agentic.session.v1 import api_pb2 as _api_pb2
from ai.stigmer.agentic.session.v1 import event_pb2 as _event_pb2
from ai.stigmer.commons.apiresource import field_options_pb2 as _field_options_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import field_mask_pb2 as _field_mask_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SessionId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class AgentId(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class SessionList(_message.Message):
    __slots__ = ("entries", "next_page_token")
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    entries: _containers.RepeatedCompositeFieldContainer[_api_pb2.Session]
    next_page_token: str
    def __init__(self, entries: _Optional[_Iterable[_Union[_api_pb2.Session, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class ListSessionsRequest(_message.Message):
    __slots__ = ("page_size", "page_token", "org", "labels")
    class LabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    page_size: int
    page_token: str
    org: str
    labels: _containers.ScalarMap[str, str]
    def __init__(self, page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., org: _Optional[str] = ..., labels: _Optional[_Mapping[str, str]] = ...) -> None: ...

class ListSessionsByAgentRequest(_message.Message):
    __slots__ = ("agent_id", "page_size", "page_token", "labels")
    class LabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    AGENT_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    agent_id: str
    page_size: int
    page_token: str
    labels: _containers.ScalarMap[str, str]
    def __init__(self, agent_id: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., labels: _Optional[_Mapping[str, str]] = ...) -> None: ...

class ListSessionsByChannelRequest(_message.Message):
    __slots__ = ("channel_id", "page_size", "page_token", "labels")
    class LabelsEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    LABELS_FIELD_NUMBER: _ClassVar[int]
    channel_id: str
    page_size: int
    page_token: str
    labels: _containers.ScalarMap[str, str]
    def __init__(self, channel_id: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., labels: _Optional[_Mapping[str, str]] = ...) -> None: ...

class UpdateSessionSubjectRequest(_message.Message):
    __slots__ = ("id", "subject")
    ID_FIELD_NUMBER: _ClassVar[int]
    SUBJECT_FIELD_NUMBER: _ClassVar[int]
    id: str
    subject: str
    def __init__(self, id: _Optional[str] = ..., subject: _Optional[str] = ...) -> None: ...

class ReviewFileChangesInput(_message.Message):
    __slots__ = ("session_id", "change_set_id", "scope", "file_change_id", "action", "expected_digest", "reason", "acknowledge_unreviewable")
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    CHANGE_SET_ID_FIELD_NUMBER: _ClassVar[int]
    SCOPE_FIELD_NUMBER: _ClassVar[int]
    FILE_CHANGE_ID_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    EXPECTED_DIGEST_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    ACKNOWLEDGE_UNREVIEWABLE_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    change_set_id: str
    scope: str
    file_change_id: str
    action: str
    expected_digest: str
    reason: str
    acknowledge_unreviewable: bool
    def __init__(self, session_id: _Optional[str] = ..., change_set_id: _Optional[str] = ..., scope: _Optional[str] = ..., file_change_id: _Optional[str] = ..., action: _Optional[str] = ..., expected_digest: _Optional[str] = ..., reason: _Optional[str] = ..., acknowledge_unreviewable: bool = ...) -> None: ...

class ReviewFileChangesResponse(_message.Message):
    __slots__ = ("reconcile_run_id",)
    RECONCILE_RUN_ID_FIELD_NUMBER: _ClassVar[int]
    reconcile_run_id: str
    def __init__(self, reconcile_run_id: _Optional[str] = ...) -> None: ...

class ConfirmToolUseInput(_message.Message):
    __slots__ = ("session_id", "tool_use_id", "result", "deny_message")
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_USE_ID_FIELD_NUMBER: _ClassVar[int]
    RESULT_FIELD_NUMBER: _ClassVar[int]
    DENY_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    tool_use_id: str
    result: str
    deny_message: str
    def __init__(self, session_id: _Optional[str] = ..., tool_use_id: _Optional[str] = ..., result: _Optional[str] = ..., deny_message: _Optional[str] = ...) -> None: ...

class GrantPermissionInput(_message.Message):
    __slots__ = ("session_id", "tool_use_id")
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_USE_ID_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    tool_use_id: str
    def __init__(self, session_id: _Optional[str] = ..., tool_use_id: _Optional[str] = ...) -> None: ...

class GrantPermissionResponse(_message.Message):
    __slots__ = ("grant", "confirmations")
    GRANT_FIELD_NUMBER: _ClassVar[int]
    CONFIRMATIONS_FIELD_NUMBER: _ClassVar[int]
    grant: _event_pb2.SessionEvent
    confirmations: _containers.RepeatedCompositeFieldContainer[_event_pb2.SessionEvent]
    def __init__(self, grant: _Optional[_Union[_event_pb2.SessionEvent, _Mapping]] = ..., confirmations: _Optional[_Iterable[_Union[_event_pb2.SessionEvent, _Mapping]]] = ...) -> None: ...

class StopBackgroundCommandInput(_message.Message):
    __slots__ = ("session_id", "tool_use_id")
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    TOOL_USE_ID_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    tool_use_id: str
    def __init__(self, session_id: _Optional[str] = ..., tool_use_id: _Optional[str] = ...) -> None: ...

class InterruptSessionInput(_message.Message):
    __slots__ = ("session_id", "session_thread_id")
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_THREAD_ID_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    session_thread_id: str
    def __init__(self, session_id: _Optional[str] = ..., session_thread_id: _Optional[str] = ...) -> None: ...

class InterruptSessionResponse(_message.Message):
    __slots__ = ("event", "stopped_run_ids")
    EVENT_FIELD_NUMBER: _ClassVar[int]
    STOPPED_RUN_IDS_FIELD_NUMBER: _ClassVar[int]
    event: _event_pb2.SessionEvent
    stopped_run_ids: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, event: _Optional[_Union[_event_pb2.SessionEvent, _Mapping]] = ..., stopped_run_ids: _Optional[_Iterable[str]] = ...) -> None: ...

class ListSessionEventsRequest(_message.Message):
    __slots__ = ("session_id", "page_size", "page_token", "order", "types", "created_at_gt", "created_at_gte", "created_at_lt", "created_at_lte", "run_id")
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    ORDER_FIELD_NUMBER: _ClassVar[int]
    TYPES_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_GT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_GTE_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_LT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_LTE_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    page_size: int
    page_token: str
    order: str
    types: _containers.RepeatedScalarFieldContainer[str]
    created_at_gt: str
    created_at_gte: str
    created_at_lt: str
    created_at_lte: str
    run_id: str
    def __init__(self, session_id: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., order: _Optional[str] = ..., types: _Optional[_Iterable[str]] = ..., created_at_gt: _Optional[str] = ..., created_at_gte: _Optional[str] = ..., created_at_lt: _Optional[str] = ..., created_at_lte: _Optional[str] = ..., run_id: _Optional[str] = ...) -> None: ...

class SessionEventList(_message.Message):
    __slots__ = ("events", "next_page_token")
    EVENTS_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    events: _containers.RepeatedCompositeFieldContainer[_event_pb2.SessionEvent]
    next_page_token: str
    def __init__(self, events: _Optional[_Iterable[_Union[_event_pb2.SessionEvent, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class StreamSessionEventsRequest(_message.Message):
    __slots__ = ("session_id", "event_deltas", "after_seq")
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    EVENT_DELTAS_FIELD_NUMBER: _ClassVar[int]
    AFTER_SEQ_FIELD_NUMBER: _ClassVar[int]
    session_id: str
    event_deltas: _containers.RepeatedScalarFieldContainer[str]
    after_seq: int
    def __init__(self, session_id: _Optional[str] = ..., event_deltas: _Optional[_Iterable[str]] = ..., after_seq: _Optional[int] = ...) -> None: ...

class StreamSessionEventsResponse(_message.Message):
    __slots__ = ("event", "event_start", "event_delta", "stigmer_tool_output_delta", "stigmer_run_liveness")
    EVENT_FIELD_NUMBER: _ClassVar[int]
    EVENT_START_FIELD_NUMBER: _ClassVar[int]
    EVENT_DELTA_FIELD_NUMBER: _ClassVar[int]
    STIGMER_TOOL_OUTPUT_DELTA_FIELD_NUMBER: _ClassVar[int]
    STIGMER_RUN_LIVENESS_FIELD_NUMBER: _ClassVar[int]
    event: _event_pb2.SessionEvent
    event_start: _event_pb2.EventStart
    event_delta: _event_pb2.EventDelta
    stigmer_tool_output_delta: _event_pb2.ToolOutputDelta
    stigmer_run_liveness: _event_pb2.RunLiveness
    def __init__(self, event: _Optional[_Union[_event_pb2.SessionEvent, _Mapping]] = ..., event_start: _Optional[_Union[_event_pb2.EventStart, _Mapping]] = ..., event_delta: _Optional[_Union[_event_pb2.EventDelta, _Mapping]] = ..., stigmer_tool_output_delta: _Optional[_Union[_event_pb2.ToolOutputDelta, _Mapping]] = ..., stigmer_run_liveness: _Optional[_Union[_event_pb2.RunLiveness, _Mapping]] = ...) -> None: ...

class SessionEventPreview(_message.Message):
    __slots__ = ("event_start", "event_delta", "stigmer_tool_output_delta", "stigmer_run_liveness")
    EVENT_START_FIELD_NUMBER: _ClassVar[int]
    EVENT_DELTA_FIELD_NUMBER: _ClassVar[int]
    STIGMER_TOOL_OUTPUT_DELTA_FIELD_NUMBER: _ClassVar[int]
    STIGMER_RUN_LIVENESS_FIELD_NUMBER: _ClassVar[int]
    event_start: _event_pb2.EventStart
    event_delta: _event_pb2.EventDelta
    stigmer_tool_output_delta: _event_pb2.ToolOutputDelta
    stigmer_run_liveness: _event_pb2.RunLiveness
    def __init__(self, event_start: _Optional[_Union[_event_pb2.EventStart, _Mapping]] = ..., event_delta: _Optional[_Union[_event_pb2.EventDelta, _Mapping]] = ..., stigmer_tool_output_delta: _Optional[_Union[_event_pb2.ToolOutputDelta, _Mapping]] = ..., stigmer_run_liveness: _Optional[_Union[_event_pb2.RunLiveness, _Mapping]] = ...) -> None: ...

class AppendSessionEventsInput(_message.Message):
    __slots__ = ("run_id", "events", "previews")
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    EVENTS_FIELD_NUMBER: _ClassVar[int]
    PREVIEWS_FIELD_NUMBER: _ClassVar[int]
    run_id: str
    events: _containers.RepeatedCompositeFieldContainer[_event_pb2.SessionEvent]
    previews: _containers.RepeatedCompositeFieldContainer[SessionEventPreview]
    def __init__(self, run_id: _Optional[str] = ..., events: _Optional[_Iterable[_Union[_event_pb2.SessionEvent, _Mapping]]] = ..., previews: _Optional[_Iterable[_Union[SessionEventPreview, _Mapping]]] = ...) -> None: ...

class AppendSessionEventsResponse(_message.Message):
    __slots__ = ("events",)
    EVENTS_FIELD_NUMBER: _ClassVar[int]
    events: _containers.RepeatedCompositeFieldContainer[_event_pb2.SessionEvent]
    def __init__(self, events: _Optional[_Iterable[_Union[_event_pb2.SessionEvent, _Mapping]]] = ...) -> None: ...

class ClaimSessionInputInput(_message.Message):
    __slots__ = ("run_id",)
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    run_id: str
    def __init__(self, run_id: _Optional[str] = ...) -> None: ...

class ClaimSessionInputResponse(_message.Message):
    __slots__ = ("events",)
    EVENTS_FIELD_NUMBER: _ClassVar[int]
    events: _containers.RepeatedCompositeFieldContainer[_event_pb2.SessionEvent]
    def __init__(self, events: _Optional[_Iterable[_Union[_event_pb2.SessionEvent, _Mapping]]] = ...) -> None: ...

class UpdateSessionInput(_message.Message):
    __slots__ = ("resource", "update_mask")
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    UPDATE_MASK_FIELD_NUMBER: _ClassVar[int]
    resource: _api_pb2.Session
    update_mask: _field_mask_pb2.FieldMask
    def __init__(self, resource: _Optional[_Union[_api_pb2.Session, _Mapping]] = ..., update_mask: _Optional[_Union[_field_mask_pb2.FieldMask, _Mapping]] = ...) -> None: ...

class BindHarnessStateInput(_message.Message):
    __slots__ = ("run_id", "harness_state_id")
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    HARNESS_STATE_ID_FIELD_NUMBER: _ClassVar[int]
    run_id: str
    harness_state_id: str
    def __init__(self, run_id: _Optional[str] = ..., harness_state_id: _Optional[str] = ...) -> None: ...

class BindHarnessStateResponse(_message.Message):
    __slots__ = ("harness_state_id", "harness_state_id_history")
    HARNESS_STATE_ID_FIELD_NUMBER: _ClassVar[int]
    HARNESS_STATE_ID_HISTORY_FIELD_NUMBER: _ClassVar[int]
    harness_state_id: str
    harness_state_id_history: _containers.RepeatedScalarFieldContainer[str]
    def __init__(self, harness_state_id: _Optional[str] = ..., harness_state_id_history: _Optional[_Iterable[str]] = ...) -> None: ...

class StreamAttentionRequest(_message.Message):
    __slots__ = ("org", "after_cursor")
    ORG_FIELD_NUMBER: _ClassVar[int]
    AFTER_CURSOR_FIELD_NUMBER: _ClassVar[int]
    org: str
    after_cursor: str
    def __init__(self, org: _Optional[str] = ..., after_cursor: _Optional[str] = ...) -> None: ...

class Attention(_message.Message):
    __slots__ = ("id", "session_id", "title", "run_id", "reason", "at", "cursor")
    ID_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    TITLE_FIELD_NUMBER: _ClassVar[int]
    RUN_ID_FIELD_NUMBER: _ClassVar[int]
    REASON_FIELD_NUMBER: _ClassVar[int]
    AT_FIELD_NUMBER: _ClassVar[int]
    CURSOR_FIELD_NUMBER: _ClassVar[int]
    id: str
    session_id: str
    title: str
    run_id: str
    reason: str
    at: str
    cursor: str
    def __init__(self, id: _Optional[str] = ..., session_id: _Optional[str] = ..., title: _Optional[str] = ..., run_id: _Optional[str] = ..., reason: _Optional[str] = ..., at: _Optional[str] = ..., cursor: _Optional[str] = ...) -> None: ...
