package ai.stigmer.agentic.agentchannel.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ChannelConversationQueryController serves the console's conversation
 * reads: the org-wide conversation list and each conversation's
 * customer-visible timeline.
 * &#64;internal
 * channel-conversations DD-003/DD-004: the query sibling of
 * ChannelConversationCommandController, on the runtime surface beside the
 * message_* triple (resource CRUD and runtime traffic never mix).
 * Supersedes SessionQueryController.listByChannel as the console's
 * conversation read (DD-004 D-g); listByChannel remains the session-level
 * forensics read underneath a conversation. Cloud-first runtime: the OSS
 * edition answers queries with empty results (the listMessagingChannels
 * discovery-read posture) — "none" is the honest answer, not an error.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ChannelConversationQueryControllerGrpc {

  private ChannelConversationQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agentchannel.v1.ChannelConversationQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput,
      ai.stigmer.agentic.agentchannel.v1.ChannelConversationList> getListConversationsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listConversations",
      requestType = ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.ChannelConversationList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput,
      ai.stigmer.agentic.agentchannel.v1.ChannelConversationList> getListConversationsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput, ai.stigmer.agentic.agentchannel.v1.ChannelConversationList> getListConversationsMethod;
    if ((getListConversationsMethod = ChannelConversationQueryControllerGrpc.getListConversationsMethod) == null) {
      synchronized (ChannelConversationQueryControllerGrpc.class) {
        if ((getListConversationsMethod = ChannelConversationQueryControllerGrpc.getListConversationsMethod) == null) {
          ChannelConversationQueryControllerGrpc.getListConversationsMethod = getListConversationsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput, ai.stigmer.agentic.agentchannel.v1.ChannelConversationList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listConversations"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.ChannelConversationList.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelConversationQueryControllerMethodDescriptorSupplier("listConversations"))
              .build();
        }
      }
    }
    return getListConversationsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.GetChannelConversationInput,
      ai.stigmer.agentic.agentchannel.v1.ChannelConversation> getGetConversationMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getConversation",
      requestType = ai.stigmer.agentic.agentchannel.v1.GetChannelConversationInput.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.ChannelConversation.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.GetChannelConversationInput,
      ai.stigmer.agentic.agentchannel.v1.ChannelConversation> getGetConversationMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.GetChannelConversationInput, ai.stigmer.agentic.agentchannel.v1.ChannelConversation> getGetConversationMethod;
    if ((getGetConversationMethod = ChannelConversationQueryControllerGrpc.getGetConversationMethod) == null) {
      synchronized (ChannelConversationQueryControllerGrpc.class) {
        if ((getGetConversationMethod = ChannelConversationQueryControllerGrpc.getGetConversationMethod) == null) {
          ChannelConversationQueryControllerGrpc.getGetConversationMethod = getGetConversationMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.GetChannelConversationInput, ai.stigmer.agentic.agentchannel.v1.ChannelConversation>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getConversation"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.GetChannelConversationInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.ChannelConversation.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelConversationQueryControllerMethodDescriptorSupplier("getConversation"))
              .build();
        }
      }
    }
    return getGetConversationMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.GetConversationTimelineInput,
      ai.stigmer.agentic.agentchannel.v1.ConversationTimeline> getGetTimelineMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getTimeline",
      requestType = ai.stigmer.agentic.agentchannel.v1.GetConversationTimelineInput.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.ConversationTimeline.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.GetConversationTimelineInput,
      ai.stigmer.agentic.agentchannel.v1.ConversationTimeline> getGetTimelineMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.GetConversationTimelineInput, ai.stigmer.agentic.agentchannel.v1.ConversationTimeline> getGetTimelineMethod;
    if ((getGetTimelineMethod = ChannelConversationQueryControllerGrpc.getGetTimelineMethod) == null) {
      synchronized (ChannelConversationQueryControllerGrpc.class) {
        if ((getGetTimelineMethod = ChannelConversationQueryControllerGrpc.getGetTimelineMethod) == null) {
          ChannelConversationQueryControllerGrpc.getGetTimelineMethod = getGetTimelineMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.GetConversationTimelineInput, ai.stigmer.agentic.agentchannel.v1.ConversationTimeline>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getTimeline"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.GetConversationTimelineInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.ConversationTimeline.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelConversationQueryControllerMethodDescriptorSupplier("getTimeline"))
              .build();
        }
      }
    }
    return getGetTimelineMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.GetConversationMediaDownloadUrlInput,
      ai.stigmer.agentic.agentchannel.v1.ConversationMediaDownloadUrl> getGetMediaDownloadUrlMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getMediaDownloadUrl",
      requestType = ai.stigmer.agentic.agentchannel.v1.GetConversationMediaDownloadUrlInput.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.ConversationMediaDownloadUrl.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.GetConversationMediaDownloadUrlInput,
      ai.stigmer.agentic.agentchannel.v1.ConversationMediaDownloadUrl> getGetMediaDownloadUrlMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.GetConversationMediaDownloadUrlInput, ai.stigmer.agentic.agentchannel.v1.ConversationMediaDownloadUrl> getGetMediaDownloadUrlMethod;
    if ((getGetMediaDownloadUrlMethod = ChannelConversationQueryControllerGrpc.getGetMediaDownloadUrlMethod) == null) {
      synchronized (ChannelConversationQueryControllerGrpc.class) {
        if ((getGetMediaDownloadUrlMethod = ChannelConversationQueryControllerGrpc.getGetMediaDownloadUrlMethod) == null) {
          ChannelConversationQueryControllerGrpc.getGetMediaDownloadUrlMethod = getGetMediaDownloadUrlMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.GetConversationMediaDownloadUrlInput, ai.stigmer.agentic.agentchannel.v1.ConversationMediaDownloadUrl>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getMediaDownloadUrl"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.GetConversationMediaDownloadUrlInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.ConversationMediaDownloadUrl.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelConversationQueryControllerMethodDescriptorSupplier("getMediaDownloadUrl"))
              .build();
        }
      }
    }
    return getGetMediaDownloadUrlMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ChannelConversationQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelConversationQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelConversationQueryControllerStub>() {
        @java.lang.Override
        public ChannelConversationQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelConversationQueryControllerStub(channel, callOptions);
        }
      };
    return ChannelConversationQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ChannelConversationQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelConversationQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelConversationQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public ChannelConversationQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelConversationQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ChannelConversationQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ChannelConversationQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelConversationQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelConversationQueryControllerBlockingStub>() {
        @java.lang.Override
        public ChannelConversationQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelConversationQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return ChannelConversationQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ChannelConversationQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelConversationQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelConversationQueryControllerFutureStub>() {
        @java.lang.Override
        public ChannelConversationQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelConversationQueryControllerFutureStub(channel, callOptions);
        }
      };
    return ChannelConversationQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ChannelConversationQueryController serves the console's conversation
   * reads: the org-wide conversation list and each conversation's
   * customer-visible timeline.
   * &#64;internal
   * channel-conversations DD-003/DD-004: the query sibling of
   * ChannelConversationCommandController, on the runtime surface beside the
   * message_* triple (resource CRUD and runtime traffic never mix).
   * Supersedes SessionQueryController.listByChannel as the console's
   * conversation read (DD-004 D-g); listByChannel remains the session-level
   * forensics read underneath a conversation. Cloud-first runtime: the OSS
   * edition answers queries with empty results (the listMessagingChannels
   * discovery-read posture) — "none" is the honest answer, not an error.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * List an organization's channel conversations, newest activity first.
     * Returns conversations across all of the org's channels the caller can
     * view, optionally filtered to one channel. Entries carry participation
     * state and the customer's display name.
     * &#64;internal
     * Org-wide read: no single object to authorize, so authorization is
     * in-handler — an FGA ListObjects over agent_channel#can_view scopes
     * the scan (the listByChannel two-stage precedent; DD-010 D-b). A
     * caller who can view no channel receives an empty list, never an
     * error. OSS answers empty (cloud-only runtime).
     * </pre>
     */
    default void listConversations(ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversationList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListConversationsMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get one conversation's identity and participation state.
     * The single-row read behind a conversation detail view: who holds
     * control, whether the conversation needs attention and why, the
     * customer's display name, and the activity clocks. Answers NOT_FOUND
     * until the customer's first message creates the conversation.
     * &#64;internal
     * channel-conversations T04: the get sibling of listConversations, so
     * a deep-linked console view or an embedded conversation surface never
     * reconstructs one row by scanning list pages — and the open
     * conversation can poll its own participation state instead of riding
     * the list's slower refresh. Authorization is declarative on the
     * channel, exactly getTimeline's shape (DD-003 D-a: conversations
     * carry no per-conversation FGA tuples — the channel is the trust
     * boundary). NOT_FOUND deliberately covers the timeline-without-row
     * case (a proactive cold-send the customer never answered): getTimeline
     * may serve items while this read refuses, the same "the customer
     * wrote first" asymmetry reply's existing-conversation precondition
     * enforces (T03 Sitting 2's A8) — consoles render that as "controls
     * unlock when the customer writes", not as an error. OSS answers
     * NOT_FOUND unconditionally: this edition never materializes
     * conversations (cloud-only runtime), and a single-row get cannot
     * answer "empty" the way the sibling discovery reads do.
     * </pre>
     */
    default void getConversation(ai.stigmer.agentic.agentchannel.v1.GetChannelConversationInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversation> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetConversationMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get one conversation's timeline, newest first, cursor-paged.
     * The timeline contains customer-visible items only: inbound customer
     * messages (including non-text kinds the platform cannot render),
     * delivered agent replies, and operator or platform sends. Execution
     * internals never appear.
     * &#64;internal
     * channel-conversations DD-004: stitched on read from the webhook
     * event store, the delivery store (via the same last-AI-message
     * extraction the delivery posted — never execution transcripts), and
     * the outbound ledger; internal-lane events join as the fourth source
     * in T03. Authorization is declarative on the channel: conversations
     * carry no per-conversation FGA tuples (DD-003 D-a) — the channel is
     * the trust boundary.
     * </pre>
     */
    default void getTimeline(ai.stigmer.agentic.agentchannel.v1.GetConversationTimelineInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ConversationTimeline> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetTimelineMethod(), responseObserver);
    }

    /**
     * <pre>
     * Mint a short-lived download URL for one inbound timeline item's
     * media file (an image or document the customer sent).
     * Answers NOT_FOUND when the item does not exist in this conversation
     * or carries no ingested media (a text item, or media the platform
     * declined to ingest).
     * &#64;internal
     * whatsapp-media DD-001 D4: addressed by (channel, conversation,
     * item_id) so the server resolves the storage key from its own row —
     * the wire never carries blob capabilities, and authorization is
     * declarative on the channel exactly like getTimeline (the channel is
     * the trust boundary, DD-003 D-a). Deliberately stricter than the
     * attachments-blob posture (authentication-only, ULID-as-capability)
     * that the runner's download path rides: this is the human-facing
     * read surface and law-firm client documents travel this pipeline.
     * OSS answers NOT_FOUND unconditionally (cloud-only runtime, the
     * getConversation posture).
     * </pre>
     */
    default void getMediaDownloadUrl(ai.stigmer.agentic.agentchannel.v1.GetConversationMediaDownloadUrlInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ConversationMediaDownloadUrl> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMediaDownloadUrlMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ChannelConversationQueryController.
   * <pre>
   * ChannelConversationQueryController serves the console's conversation
   * reads: the org-wide conversation list and each conversation's
   * customer-visible timeline.
   * &#64;internal
   * channel-conversations DD-003/DD-004: the query sibling of
   * ChannelConversationCommandController, on the runtime surface beside the
   * message_* triple (resource CRUD and runtime traffic never mix).
   * Supersedes SessionQueryController.listByChannel as the console's
   * conversation read (DD-004 D-g); listByChannel remains the session-level
   * forensics read underneath a conversation. Cloud-first runtime: the OSS
   * edition answers queries with empty results (the listMessagingChannels
   * discovery-read posture) — "none" is the honest answer, not an error.
   * </pre>
   */
  public static abstract class ChannelConversationQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ChannelConversationQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ChannelConversationQueryController.
   * <pre>
   * ChannelConversationQueryController serves the console's conversation
   * reads: the org-wide conversation list and each conversation's
   * customer-visible timeline.
   * &#64;internal
   * channel-conversations DD-003/DD-004: the query sibling of
   * ChannelConversationCommandController, on the runtime surface beside the
   * message_* triple (resource CRUD and runtime traffic never mix).
   * Supersedes SessionQueryController.listByChannel as the console's
   * conversation read (DD-004 D-g); listByChannel remains the session-level
   * forensics read underneath a conversation. Cloud-first runtime: the OSS
   * edition answers queries with empty results (the listMessagingChannels
   * discovery-read posture) — "none" is the honest answer, not an error.
   * </pre>
   */
  public static final class ChannelConversationQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ChannelConversationQueryControllerStub> {
    private ChannelConversationQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelConversationQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelConversationQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * List an organization's channel conversations, newest activity first.
     * Returns conversations across all of the org's channels the caller can
     * view, optionally filtered to one channel. Entries carry participation
     * state and the customer's display name.
     * &#64;internal
     * Org-wide read: no single object to authorize, so authorization is
     * in-handler — an FGA ListObjects over agent_channel#can_view scopes
     * the scan (the listByChannel two-stage precedent; DD-010 D-b). A
     * caller who can view no channel receives an empty list, never an
     * error. OSS answers empty (cloud-only runtime).
     * </pre>
     */
    public void listConversations(ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversationList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListConversationsMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get one conversation's identity and participation state.
     * The single-row read behind a conversation detail view: who holds
     * control, whether the conversation needs attention and why, the
     * customer's display name, and the activity clocks. Answers NOT_FOUND
     * until the customer's first message creates the conversation.
     * &#64;internal
     * channel-conversations T04: the get sibling of listConversations, so
     * a deep-linked console view or an embedded conversation surface never
     * reconstructs one row by scanning list pages — and the open
     * conversation can poll its own participation state instead of riding
     * the list's slower refresh. Authorization is declarative on the
     * channel, exactly getTimeline's shape (DD-003 D-a: conversations
     * carry no per-conversation FGA tuples — the channel is the trust
     * boundary). NOT_FOUND deliberately covers the timeline-without-row
     * case (a proactive cold-send the customer never answered): getTimeline
     * may serve items while this read refuses, the same "the customer
     * wrote first" asymmetry reply's existing-conversation precondition
     * enforces (T03 Sitting 2's A8) — consoles render that as "controls
     * unlock when the customer writes", not as an error. OSS answers
     * NOT_FOUND unconditionally: this edition never materializes
     * conversations (cloud-only runtime), and a single-row get cannot
     * answer "empty" the way the sibling discovery reads do.
     * </pre>
     */
    public void getConversation(ai.stigmer.agentic.agentchannel.v1.GetChannelConversationInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversation> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetConversationMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get one conversation's timeline, newest first, cursor-paged.
     * The timeline contains customer-visible items only: inbound customer
     * messages (including non-text kinds the platform cannot render),
     * delivered agent replies, and operator or platform sends. Execution
     * internals never appear.
     * &#64;internal
     * channel-conversations DD-004: stitched on read from the webhook
     * event store, the delivery store (via the same last-AI-message
     * extraction the delivery posted — never execution transcripts), and
     * the outbound ledger; internal-lane events join as the fourth source
     * in T03. Authorization is declarative on the channel: conversations
     * carry no per-conversation FGA tuples (DD-003 D-a) — the channel is
     * the trust boundary.
     * </pre>
     */
    public void getTimeline(ai.stigmer.agentic.agentchannel.v1.GetConversationTimelineInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ConversationTimeline> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetTimelineMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Mint a short-lived download URL for one inbound timeline item's
     * media file (an image or document the customer sent).
     * Answers NOT_FOUND when the item does not exist in this conversation
     * or carries no ingested media (a text item, or media the platform
     * declined to ingest).
     * &#64;internal
     * whatsapp-media DD-001 D4: addressed by (channel, conversation,
     * item_id) so the server resolves the storage key from its own row —
     * the wire never carries blob capabilities, and authorization is
     * declarative on the channel exactly like getTimeline (the channel is
     * the trust boundary, DD-003 D-a). Deliberately stricter than the
     * attachments-blob posture (authentication-only, ULID-as-capability)
     * that the runner's download path rides: this is the human-facing
     * read surface and law-firm client documents travel this pipeline.
     * OSS answers NOT_FOUND unconditionally (cloud-only runtime, the
     * getConversation posture).
     * </pre>
     */
    public void getMediaDownloadUrl(ai.stigmer.agentic.agentchannel.v1.GetConversationMediaDownloadUrlInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ConversationMediaDownloadUrl> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMediaDownloadUrlMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ChannelConversationQueryController.
   * <pre>
   * ChannelConversationQueryController serves the console's conversation
   * reads: the org-wide conversation list and each conversation's
   * customer-visible timeline.
   * &#64;internal
   * channel-conversations DD-003/DD-004: the query sibling of
   * ChannelConversationCommandController, on the runtime surface beside the
   * message_* triple (resource CRUD and runtime traffic never mix).
   * Supersedes SessionQueryController.listByChannel as the console's
   * conversation read (DD-004 D-g); listByChannel remains the session-level
   * forensics read underneath a conversation. Cloud-first runtime: the OSS
   * edition answers queries with empty results (the listMessagingChannels
   * discovery-read posture) — "none" is the honest answer, not an error.
   * </pre>
   */
  public static final class ChannelConversationQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ChannelConversationQueryControllerBlockingV2Stub> {
    private ChannelConversationQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelConversationQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelConversationQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * List an organization's channel conversations, newest activity first.
     * Returns conversations across all of the org's channels the caller can
     * view, optionally filtered to one channel. Entries carry participation
     * state and the customer's display name.
     * &#64;internal
     * Org-wide read: no single object to authorize, so authorization is
     * in-handler — an FGA ListObjects over agent_channel#can_view scopes
     * the scan (the listByChannel two-stage precedent; DD-010 D-b). A
     * caller who can view no channel receives an empty list, never an
     * error. OSS answers empty (cloud-only runtime).
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ChannelConversationList listConversations(ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListConversationsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get one conversation's identity and participation state.
     * The single-row read behind a conversation detail view: who holds
     * control, whether the conversation needs attention and why, the
     * customer's display name, and the activity clocks. Answers NOT_FOUND
     * until the customer's first message creates the conversation.
     * &#64;internal
     * channel-conversations T04: the get sibling of listConversations, so
     * a deep-linked console view or an embedded conversation surface never
     * reconstructs one row by scanning list pages — and the open
     * conversation can poll its own participation state instead of riding
     * the list's slower refresh. Authorization is declarative on the
     * channel, exactly getTimeline's shape (DD-003 D-a: conversations
     * carry no per-conversation FGA tuples — the channel is the trust
     * boundary). NOT_FOUND deliberately covers the timeline-without-row
     * case (a proactive cold-send the customer never answered): getTimeline
     * may serve items while this read refuses, the same "the customer
     * wrote first" asymmetry reply's existing-conversation precondition
     * enforces (T03 Sitting 2's A8) — consoles render that as "controls
     * unlock when the customer writes", not as an error. OSS answers
     * NOT_FOUND unconditionally: this edition never materializes
     * conversations (cloud-only runtime), and a single-row get cannot
     * answer "empty" the way the sibling discovery reads do.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ChannelConversation getConversation(ai.stigmer.agentic.agentchannel.v1.GetChannelConversationInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetConversationMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get one conversation's timeline, newest first, cursor-paged.
     * The timeline contains customer-visible items only: inbound customer
     * messages (including non-text kinds the platform cannot render),
     * delivered agent replies, and operator or platform sends. Execution
     * internals never appear.
     * &#64;internal
     * channel-conversations DD-004: stitched on read from the webhook
     * event store, the delivery store (via the same last-AI-message
     * extraction the delivery posted — never execution transcripts), and
     * the outbound ledger; internal-lane events join as the fourth source
     * in T03. Authorization is declarative on the channel: conversations
     * carry no per-conversation FGA tuples (DD-003 D-a) — the channel is
     * the trust boundary.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ConversationTimeline getTimeline(ai.stigmer.agentic.agentchannel.v1.GetConversationTimelineInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetTimelineMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Mint a short-lived download URL for one inbound timeline item's
     * media file (an image or document the customer sent).
     * Answers NOT_FOUND when the item does not exist in this conversation
     * or carries no ingested media (a text item, or media the platform
     * declined to ingest).
     * &#64;internal
     * whatsapp-media DD-001 D4: addressed by (channel, conversation,
     * item_id) so the server resolves the storage key from its own row —
     * the wire never carries blob capabilities, and authorization is
     * declarative on the channel exactly like getTimeline (the channel is
     * the trust boundary, DD-003 D-a). Deliberately stricter than the
     * attachments-blob posture (authentication-only, ULID-as-capability)
     * that the runner's download path rides: this is the human-facing
     * read surface and law-firm client documents travel this pipeline.
     * OSS answers NOT_FOUND unconditionally (cloud-only runtime, the
     * getConversation posture).
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ConversationMediaDownloadUrl getMediaDownloadUrl(ai.stigmer.agentic.agentchannel.v1.GetConversationMediaDownloadUrlInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMediaDownloadUrlMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ChannelConversationQueryController.
   * <pre>
   * ChannelConversationQueryController serves the console's conversation
   * reads: the org-wide conversation list and each conversation's
   * customer-visible timeline.
   * &#64;internal
   * channel-conversations DD-003/DD-004: the query sibling of
   * ChannelConversationCommandController, on the runtime surface beside the
   * message_* triple (resource CRUD and runtime traffic never mix).
   * Supersedes SessionQueryController.listByChannel as the console's
   * conversation read (DD-004 D-g); listByChannel remains the session-level
   * forensics read underneath a conversation. Cloud-first runtime: the OSS
   * edition answers queries with empty results (the listMessagingChannels
   * discovery-read posture) — "none" is the honest answer, not an error.
   * </pre>
   */
  public static final class ChannelConversationQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ChannelConversationQueryControllerBlockingStub> {
    private ChannelConversationQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelConversationQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelConversationQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * List an organization's channel conversations, newest activity first.
     * Returns conversations across all of the org's channels the caller can
     * view, optionally filtered to one channel. Entries carry participation
     * state and the customer's display name.
     * &#64;internal
     * Org-wide read: no single object to authorize, so authorization is
     * in-handler — an FGA ListObjects over agent_channel#can_view scopes
     * the scan (the listByChannel two-stage precedent; DD-010 D-b). A
     * caller who can view no channel receives an empty list, never an
     * error. OSS answers empty (cloud-only runtime).
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ChannelConversationList listConversations(ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListConversationsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get one conversation's identity and participation state.
     * The single-row read behind a conversation detail view: who holds
     * control, whether the conversation needs attention and why, the
     * customer's display name, and the activity clocks. Answers NOT_FOUND
     * until the customer's first message creates the conversation.
     * &#64;internal
     * channel-conversations T04: the get sibling of listConversations, so
     * a deep-linked console view or an embedded conversation surface never
     * reconstructs one row by scanning list pages — and the open
     * conversation can poll its own participation state instead of riding
     * the list's slower refresh. Authorization is declarative on the
     * channel, exactly getTimeline's shape (DD-003 D-a: conversations
     * carry no per-conversation FGA tuples — the channel is the trust
     * boundary). NOT_FOUND deliberately covers the timeline-without-row
     * case (a proactive cold-send the customer never answered): getTimeline
     * may serve items while this read refuses, the same "the customer
     * wrote first" asymmetry reply's existing-conversation precondition
     * enforces (T03 Sitting 2's A8) — consoles render that as "controls
     * unlock when the customer writes", not as an error. OSS answers
     * NOT_FOUND unconditionally: this edition never materializes
     * conversations (cloud-only runtime), and a single-row get cannot
     * answer "empty" the way the sibling discovery reads do.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ChannelConversation getConversation(ai.stigmer.agentic.agentchannel.v1.GetChannelConversationInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetConversationMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get one conversation's timeline, newest first, cursor-paged.
     * The timeline contains customer-visible items only: inbound customer
     * messages (including non-text kinds the platform cannot render),
     * delivered agent replies, and operator or platform sends. Execution
     * internals never appear.
     * &#64;internal
     * channel-conversations DD-004: stitched on read from the webhook
     * event store, the delivery store (via the same last-AI-message
     * extraction the delivery posted — never execution transcripts), and
     * the outbound ledger; internal-lane events join as the fourth source
     * in T03. Authorization is declarative on the channel: conversations
     * carry no per-conversation FGA tuples (DD-003 D-a) — the channel is
     * the trust boundary.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ConversationTimeline getTimeline(ai.stigmer.agentic.agentchannel.v1.GetConversationTimelineInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetTimelineMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Mint a short-lived download URL for one inbound timeline item's
     * media file (an image or document the customer sent).
     * Answers NOT_FOUND when the item does not exist in this conversation
     * or carries no ingested media (a text item, or media the platform
     * declined to ingest).
     * &#64;internal
     * whatsapp-media DD-001 D4: addressed by (channel, conversation,
     * item_id) so the server resolves the storage key from its own row —
     * the wire never carries blob capabilities, and authorization is
     * declarative on the channel exactly like getTimeline (the channel is
     * the trust boundary, DD-003 D-a). Deliberately stricter than the
     * attachments-blob posture (authentication-only, ULID-as-capability)
     * that the runner's download path rides: this is the human-facing
     * read surface and law-firm client documents travel this pipeline.
     * OSS answers NOT_FOUND unconditionally (cloud-only runtime, the
     * getConversation posture).
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ConversationMediaDownloadUrl getMediaDownloadUrl(ai.stigmer.agentic.agentchannel.v1.GetConversationMediaDownloadUrlInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMediaDownloadUrlMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ChannelConversationQueryController.
   * <pre>
   * ChannelConversationQueryController serves the console's conversation
   * reads: the org-wide conversation list and each conversation's
   * customer-visible timeline.
   * &#64;internal
   * channel-conversations DD-003/DD-004: the query sibling of
   * ChannelConversationCommandController, on the runtime surface beside the
   * message_* triple (resource CRUD and runtime traffic never mix).
   * Supersedes SessionQueryController.listByChannel as the console's
   * conversation read (DD-004 D-g); listByChannel remains the session-level
   * forensics read underneath a conversation. Cloud-first runtime: the OSS
   * edition answers queries with empty results (the listMessagingChannels
   * discovery-read posture) — "none" is the honest answer, not an error.
   * </pre>
   */
  public static final class ChannelConversationQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ChannelConversationQueryControllerFutureStub> {
    private ChannelConversationQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelConversationQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelConversationQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * List an organization's channel conversations, newest activity first.
     * Returns conversations across all of the org's channels the caller can
     * view, optionally filtered to one channel. Entries carry participation
     * state and the customer's display name.
     * &#64;internal
     * Org-wide read: no single object to authorize, so authorization is
     * in-handler — an FGA ListObjects over agent_channel#can_view scopes
     * the scan (the listByChannel two-stage precedent; DD-010 D-b). A
     * caller who can view no channel receives an empty list, never an
     * error. OSS answers empty (cloud-only runtime).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.ChannelConversationList> listConversations(
        ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListConversationsMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get one conversation's identity and participation state.
     * The single-row read behind a conversation detail view: who holds
     * control, whether the conversation needs attention and why, the
     * customer's display name, and the activity clocks. Answers NOT_FOUND
     * until the customer's first message creates the conversation.
     * &#64;internal
     * channel-conversations T04: the get sibling of listConversations, so
     * a deep-linked console view or an embedded conversation surface never
     * reconstructs one row by scanning list pages — and the open
     * conversation can poll its own participation state instead of riding
     * the list's slower refresh. Authorization is declarative on the
     * channel, exactly getTimeline's shape (DD-003 D-a: conversations
     * carry no per-conversation FGA tuples — the channel is the trust
     * boundary). NOT_FOUND deliberately covers the timeline-without-row
     * case (a proactive cold-send the customer never answered): getTimeline
     * may serve items while this read refuses, the same "the customer
     * wrote first" asymmetry reply's existing-conversation precondition
     * enforces (T03 Sitting 2's A8) — consoles render that as "controls
     * unlock when the customer writes", not as an error. OSS answers
     * NOT_FOUND unconditionally: this edition never materializes
     * conversations (cloud-only runtime), and a single-row get cannot
     * answer "empty" the way the sibling discovery reads do.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.ChannelConversation> getConversation(
        ai.stigmer.agentic.agentchannel.v1.GetChannelConversationInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetConversationMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get one conversation's timeline, newest first, cursor-paged.
     * The timeline contains customer-visible items only: inbound customer
     * messages (including non-text kinds the platform cannot render),
     * delivered agent replies, and operator or platform sends. Execution
     * internals never appear.
     * &#64;internal
     * channel-conversations DD-004: stitched on read from the webhook
     * event store, the delivery store (via the same last-AI-message
     * extraction the delivery posted — never execution transcripts), and
     * the outbound ledger; internal-lane events join as the fourth source
     * in T03. Authorization is declarative on the channel: conversations
     * carry no per-conversation FGA tuples (DD-003 D-a) — the channel is
     * the trust boundary.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.ConversationTimeline> getTimeline(
        ai.stigmer.agentic.agentchannel.v1.GetConversationTimelineInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetTimelineMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Mint a short-lived download URL for one inbound timeline item's
     * media file (an image or document the customer sent).
     * Answers NOT_FOUND when the item does not exist in this conversation
     * or carries no ingested media (a text item, or media the platform
     * declined to ingest).
     * &#64;internal
     * whatsapp-media DD-001 D4: addressed by (channel, conversation,
     * item_id) so the server resolves the storage key from its own row —
     * the wire never carries blob capabilities, and authorization is
     * declarative on the channel exactly like getTimeline (the channel is
     * the trust boundary, DD-003 D-a). Deliberately stricter than the
     * attachments-blob posture (authentication-only, ULID-as-capability)
     * that the runner's download path rides: this is the human-facing
     * read surface and law-firm client documents travel this pipeline.
     * OSS answers NOT_FOUND unconditionally (cloud-only runtime, the
     * getConversation posture).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.ConversationMediaDownloadUrl> getMediaDownloadUrl(
        ai.stigmer.agentic.agentchannel.v1.GetConversationMediaDownloadUrlInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMediaDownloadUrlMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_LIST_CONVERSATIONS = 0;
  private static final int METHODID_GET_CONVERSATION = 1;
  private static final int METHODID_GET_TIMELINE = 2;
  private static final int METHODID_GET_MEDIA_DOWNLOAD_URL = 3;

  private static final class MethodHandlers<Req, Resp> implements
      io.grpc.stub.ServerCalls.UnaryMethod<Req, Resp>,
      io.grpc.stub.ServerCalls.ServerStreamingMethod<Req, Resp>,
      io.grpc.stub.ServerCalls.ClientStreamingMethod<Req, Resp>,
      io.grpc.stub.ServerCalls.BidiStreamingMethod<Req, Resp> {
    private final AsyncService serviceImpl;
    private final int methodId;

    MethodHandlers(AsyncService serviceImpl, int methodId) {
      this.serviceImpl = serviceImpl;
      this.methodId = methodId;
    }

    @java.lang.Override
    @java.lang.SuppressWarnings("unchecked")
    public void invoke(Req request, io.grpc.stub.StreamObserver<Resp> responseObserver) {
      switch (methodId) {
        case METHODID_LIST_CONVERSATIONS:
          serviceImpl.listConversations((ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversationList>) responseObserver);
          break;
        case METHODID_GET_CONVERSATION:
          serviceImpl.getConversation((ai.stigmer.agentic.agentchannel.v1.GetChannelConversationInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversation>) responseObserver);
          break;
        case METHODID_GET_TIMELINE:
          serviceImpl.getTimeline((ai.stigmer.agentic.agentchannel.v1.GetConversationTimelineInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ConversationTimeline>) responseObserver);
          break;
        case METHODID_GET_MEDIA_DOWNLOAD_URL:
          serviceImpl.getMediaDownloadUrl((ai.stigmer.agentic.agentchannel.v1.GetConversationMediaDownloadUrlInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ConversationMediaDownloadUrl>) responseObserver);
          break;
        default:
          throw new AssertionError();
      }
    }

    @java.lang.Override
    @java.lang.SuppressWarnings("unchecked")
    public io.grpc.stub.StreamObserver<Req> invoke(
        io.grpc.stub.StreamObserver<Resp> responseObserver) {
      switch (methodId) {
        default:
          throw new AssertionError();
      }
    }
  }

  public static final io.grpc.ServerServiceDefinition bindService(AsyncService service) {
    return io.grpc.ServerServiceDefinition.builder(getServiceDescriptor())
        .addMethod(
          getListConversationsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput,
              ai.stigmer.agentic.agentchannel.v1.ChannelConversationList>(
                service, METHODID_LIST_CONVERSATIONS)))
        .addMethod(
          getGetConversationMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.GetChannelConversationInput,
              ai.stigmer.agentic.agentchannel.v1.ChannelConversation>(
                service, METHODID_GET_CONVERSATION)))
        .addMethod(
          getGetTimelineMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.GetConversationTimelineInput,
              ai.stigmer.agentic.agentchannel.v1.ConversationTimeline>(
                service, METHODID_GET_TIMELINE)))
        .addMethod(
          getGetMediaDownloadUrlMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.GetConversationMediaDownloadUrlInput,
              ai.stigmer.agentic.agentchannel.v1.ConversationMediaDownloadUrl>(
                service, METHODID_GET_MEDIA_DOWNLOAD_URL)))
        .build();
  }

  private static abstract class ChannelConversationQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ChannelConversationQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.agentchannel.v1.ConversationQueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ChannelConversationQueryController");
    }
  }

  private static final class ChannelConversationQueryControllerFileDescriptorSupplier
      extends ChannelConversationQueryControllerBaseDescriptorSupplier {
    ChannelConversationQueryControllerFileDescriptorSupplier() {}
  }

  private static final class ChannelConversationQueryControllerMethodDescriptorSupplier
      extends ChannelConversationQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ChannelConversationQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
      this.methodName = methodName;
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.MethodDescriptor getMethodDescriptor() {
      return getServiceDescriptor().findMethodByName(methodName);
    }
  }

  private static volatile io.grpc.ServiceDescriptor serviceDescriptor;

  public static io.grpc.ServiceDescriptor getServiceDescriptor() {
    io.grpc.ServiceDescriptor result = serviceDescriptor;
    if (result == null) {
      synchronized (ChannelConversationQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ChannelConversationQueryControllerFileDescriptorSupplier())
              .addMethod(getListConversationsMethod())
              .addMethod(getGetConversationMethod())
              .addMethod(getGetTimelineMethod())
              .addMethod(getGetMediaDownloadUrlMethod())
              .build();
        }
      }
    }
    return result;
  }
}
