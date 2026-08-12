import datetime

from ai.stigmer.agentic.agentchannel.v1 import delivery_pb2 as _delivery_pb2
from ai.stigmer.agentic.agentchannel.v1 import message_io_pb2 as _message_io_pb2
from ai.stigmer.agentic.agentchannel.v1 import outbound_pb2 as _outbound_pb2
from ai.stigmer.commons.rpc import pagination_pb2 as _pagination_pb2
from buf.validate import validate_pb2 as _validate_pb2
from google.protobuf import timestamp_pb2 as _timestamp_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ConversationControl(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    conversation_control_unspecified: _ClassVar[ConversationControl]
    control_agent: _ClassVar[ConversationControl]
    control_human: _ClassVar[ConversationControl]

class ConversationLane(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    conversation_lane_unspecified: _ClassVar[ConversationLane]
    lane_public: _ClassVar[ConversationLane]
    lane_internal: _ClassVar[ConversationLane]

class ConversationItemAuthor(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    conversation_item_author_unspecified: _ClassVar[ConversationItemAuthor]
    author_customer: _ClassVar[ConversationItemAuthor]
    author_agent: _ClassVar[ConversationItemAuthor]
    author_teammate: _ClassVar[ConversationItemAuthor]
    author_platform: _ClassVar[ConversationItemAuthor]

class ChannelConversationListFilter(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    channel_conversation_list_filter_unspecified: _ClassVar[ChannelConversationListFilter]
    filter_wants_human: _ClassVar[ChannelConversationListFilter]
conversation_control_unspecified: ConversationControl
control_agent: ConversationControl
control_human: ConversationControl
conversation_lane_unspecified: ConversationLane
lane_public: ConversationLane
lane_internal: ConversationLane
conversation_item_author_unspecified: ConversationItemAuthor
author_customer: ConversationItemAuthor
author_agent: ConversationItemAuthor
author_teammate: ConversationItemAuthor
author_platform: ConversationItemAuthor
channel_conversation_list_filter_unspecified: ChannelConversationListFilter
filter_wants_human: ChannelConversationListFilter

class ChannelConversation(_message.Message):
    __slots__ = ("agent_channel_id", "conversation_key", "org", "control", "controlled_by", "control_changed_at", "needs_attention", "attention_reason", "attention_changed_at", "display_name", "last_customer_message_at", "last_activity_at", "awaiting_reply")
    AGENT_CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_KEY_FIELD_NUMBER: _ClassVar[int]
    ORG_FIELD_NUMBER: _ClassVar[int]
    CONTROL_FIELD_NUMBER: _ClassVar[int]
    CONTROLLED_BY_FIELD_NUMBER: _ClassVar[int]
    CONTROL_CHANGED_AT_FIELD_NUMBER: _ClassVar[int]
    NEEDS_ATTENTION_FIELD_NUMBER: _ClassVar[int]
    ATTENTION_REASON_FIELD_NUMBER: _ClassVar[int]
    ATTENTION_CHANGED_AT_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    LAST_CUSTOMER_MESSAGE_AT_FIELD_NUMBER: _ClassVar[int]
    LAST_ACTIVITY_AT_FIELD_NUMBER: _ClassVar[int]
    AWAITING_REPLY_FIELD_NUMBER: _ClassVar[int]
    agent_channel_id: str
    conversation_key: str
    org: str
    control: ConversationControl
    controlled_by: str
    control_changed_at: _timestamp_pb2.Timestamp
    needs_attention: bool
    attention_reason: str
    attention_changed_at: _timestamp_pb2.Timestamp
    display_name: str
    last_customer_message_at: _timestamp_pb2.Timestamp
    last_activity_at: _timestamp_pb2.Timestamp
    awaiting_reply: bool
    def __init__(self, agent_channel_id: _Optional[str] = ..., conversation_key: _Optional[str] = ..., org: _Optional[str] = ..., control: _Optional[_Union[ConversationControl, str]] = ..., controlled_by: _Optional[str] = ..., control_changed_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., needs_attention: bool = ..., attention_reason: _Optional[str] = ..., attention_changed_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., display_name: _Optional[str] = ..., last_customer_message_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., last_activity_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., awaiting_reply: bool = ...) -> None: ...

class ConversationTimelineItem(_message.Message):
    __slots__ = ("item_id", "lane", "author", "authored_by", "text", "provider_message_type", "at", "delivery_status", "receipt_state", "origin", "receipt_detail", "receipt_error_code", "media", "attempt_detail", "attempt_failure_kind")
    ITEM_ID_FIELD_NUMBER: _ClassVar[int]
    LANE_FIELD_NUMBER: _ClassVar[int]
    AUTHOR_FIELD_NUMBER: _ClassVar[int]
    AUTHORED_BY_FIELD_NUMBER: _ClassVar[int]
    TEXT_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_MESSAGE_TYPE_FIELD_NUMBER: _ClassVar[int]
    AT_FIELD_NUMBER: _ClassVar[int]
    DELIVERY_STATUS_FIELD_NUMBER: _ClassVar[int]
    RECEIPT_STATE_FIELD_NUMBER: _ClassVar[int]
    ORIGIN_FIELD_NUMBER: _ClassVar[int]
    RECEIPT_DETAIL_FIELD_NUMBER: _ClassVar[int]
    RECEIPT_ERROR_CODE_FIELD_NUMBER: _ClassVar[int]
    MEDIA_FIELD_NUMBER: _ClassVar[int]
    ATTEMPT_DETAIL_FIELD_NUMBER: _ClassVar[int]
    ATTEMPT_FAILURE_KIND_FIELD_NUMBER: _ClassVar[int]
    item_id: str
    lane: ConversationLane
    author: ConversationItemAuthor
    authored_by: str
    text: str
    provider_message_type: str
    at: _timestamp_pb2.Timestamp
    delivery_status: _delivery_pb2.ChannelDeliveryStatus
    receipt_state: _outbound_pb2.ChannelReceiptState
    origin: _outbound_pb2.ChannelOutboundOrigin
    receipt_detail: str
    receipt_error_code: int
    media: ConversationMediaRef
    attempt_detail: str
    attempt_failure_kind: _delivery_pb2.ChannelAttemptFailureKind
    def __init__(self, item_id: _Optional[str] = ..., lane: _Optional[_Union[ConversationLane, str]] = ..., author: _Optional[_Union[ConversationItemAuthor, str]] = ..., authored_by: _Optional[str] = ..., text: _Optional[str] = ..., provider_message_type: _Optional[str] = ..., at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ..., delivery_status: _Optional[_Union[_delivery_pb2.ChannelDeliveryStatus, str]] = ..., receipt_state: _Optional[_Union[_outbound_pb2.ChannelReceiptState, str]] = ..., origin: _Optional[_Union[_outbound_pb2.ChannelOutboundOrigin, str]] = ..., receipt_detail: _Optional[str] = ..., receipt_error_code: _Optional[int] = ..., media: _Optional[_Union[ConversationMediaRef, _Mapping]] = ..., attempt_detail: _Optional[str] = ..., attempt_failure_kind: _Optional[_Union[_delivery_pb2.ChannelAttemptFailureKind, str]] = ...) -> None: ...

class ConversationMediaRef(_message.Message):
    __slots__ = ("filename", "content_type", "size_bytes")
    FILENAME_FIELD_NUMBER: _ClassVar[int]
    CONTENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    SIZE_BYTES_FIELD_NUMBER: _ClassVar[int]
    filename: str
    content_type: str
    size_bytes: int
    def __init__(self, filename: _Optional[str] = ..., content_type: _Optional[str] = ..., size_bytes: _Optional[int] = ...) -> None: ...

class ListChannelConversationsInput(_message.Message):
    __slots__ = ("org", "agent_channel_id", "page_info", "filter")
    ORG_FIELD_NUMBER: _ClassVar[int]
    AGENT_CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    PAGE_INFO_FIELD_NUMBER: _ClassVar[int]
    FILTER_FIELD_NUMBER: _ClassVar[int]
    org: str
    agent_channel_id: str
    page_info: _pagination_pb2.PageInfo
    filter: ChannelConversationListFilter
    def __init__(self, org: _Optional[str] = ..., agent_channel_id: _Optional[str] = ..., page_info: _Optional[_Union[_pagination_pb2.PageInfo, _Mapping]] = ..., filter: _Optional[_Union[ChannelConversationListFilter, str]] = ...) -> None: ...

class ChannelConversationList(_message.Message):
    __slots__ = ("total_count", "items")
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    total_count: int
    items: _containers.RepeatedCompositeFieldContainer[ChannelConversation]
    def __init__(self, total_count: _Optional[int] = ..., items: _Optional[_Iterable[_Union[ChannelConversation, _Mapping]]] = ...) -> None: ...

class GetChannelConversationInput(_message.Message):
    __slots__ = ("agent_channel_id", "conversation_key")
    AGENT_CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_KEY_FIELD_NUMBER: _ClassVar[int]
    agent_channel_id: str
    conversation_key: str
    def __init__(self, agent_channel_id: _Optional[str] = ..., conversation_key: _Optional[str] = ...) -> None: ...

class GetConversationTimelineInput(_message.Message):
    __slots__ = ("agent_channel_id", "conversation_key", "page_size", "page_token")
    AGENT_CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_KEY_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    agent_channel_id: str
    conversation_key: str
    page_size: int
    page_token: str
    def __init__(self, agent_channel_id: _Optional[str] = ..., conversation_key: _Optional[str] = ..., page_size: _Optional[int] = ..., page_token: _Optional[str] = ...) -> None: ...

class ConversationTimeline(_message.Message):
    __slots__ = ("items", "next_page_token")
    ITEMS_FIELD_NUMBER: _ClassVar[int]
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    items: _containers.RepeatedCompositeFieldContainer[ConversationTimelineItem]
    next_page_token: str
    def __init__(self, items: _Optional[_Iterable[_Union[ConversationTimelineItem, _Mapping]]] = ..., next_page_token: _Optional[str] = ...) -> None: ...

class GetConversationMediaDownloadUrlInput(_message.Message):
    __slots__ = ("agent_channel_id", "conversation_key", "item_id")
    AGENT_CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_KEY_FIELD_NUMBER: _ClassVar[int]
    ITEM_ID_FIELD_NUMBER: _ClassVar[int]
    agent_channel_id: str
    conversation_key: str
    item_id: str
    def __init__(self, agent_channel_id: _Optional[str] = ..., conversation_key: _Optional[str] = ..., item_id: _Optional[str] = ...) -> None: ...

class ConversationMediaDownloadUrl(_message.Message):
    __slots__ = ("url", "expires_at")
    URL_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    url: str
    expires_at: _timestamp_pb2.Timestamp
    def __init__(self, url: _Optional[str] = ..., expires_at: _Optional[_Union[datetime.datetime, _timestamp_pb2.Timestamp, _Mapping]] = ...) -> None: ...

class ConversationControlInput(_message.Message):
    __slots__ = ("agent_channel_id", "conversation_key")
    AGENT_CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_KEY_FIELD_NUMBER: _ClassVar[int]
    agent_channel_id: str
    conversation_key: str
    def __init__(self, agent_channel_id: _Optional[str] = ..., conversation_key: _Optional[str] = ...) -> None: ...

class ReplyToConversationInput(_message.Message):
    __slots__ = ("agent_channel_id", "conversation_key", "payload")
    AGENT_CHANNEL_ID_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_KEY_FIELD_NUMBER: _ClassVar[int]
    PAYLOAD_FIELD_NUMBER: _ClassVar[int]
    agent_channel_id: str
    conversation_key: str
    payload: _message_io_pb2.ChannelOutboundPayload
    def __init__(self, agent_channel_id: _Optional[str] = ..., conversation_key: _Optional[str] = ..., payload: _Optional[_Union[_message_io_pb2.ChannelOutboundPayload, _Mapping]] = ...) -> None: ...

class EscalateConversationInput(_message.Message):
    __slots__ = ("reason",)
    REASON_FIELD_NUMBER: _ClassVar[int]
    reason: str
    def __init__(self, reason: _Optional[str] = ...) -> None: ...
