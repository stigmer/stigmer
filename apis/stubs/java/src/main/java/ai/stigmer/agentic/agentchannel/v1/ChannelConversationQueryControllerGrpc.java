package ai.stigmer.agentic.agentchannel.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ChannelConversationQueryController serves the console's conversation
 * reads: the org-wide conversation list and each conversation's
 * customer-visible timeline.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ChannelConversationQueryControllerGrpc {

  private ChannelConversationQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agentchannel.v1.ChannelConversationQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput,
      ai.stigmer.agentic.agentchannel.v1.ChannelConversationList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.ChannelConversationList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput,
      ai.stigmer.agentic.agentchannel.v1.ChannelConversationList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput, ai.stigmer.agentic.agentchannel.v1.ChannelConversationList> getListMethod;
    if ((getListMethod = ChannelConversationQueryControllerGrpc.getListMethod) == null) {
      synchronized (ChannelConversationQueryControllerGrpc.class) {
        if ((getListMethod = ChannelConversationQueryControllerGrpc.getListMethod) == null) {
          ChannelConversationQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput, ai.stigmer.agentic.agentchannel.v1.ChannelConversationList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.ChannelConversationList.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelConversationQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.CountChannelConversationsInput,
      ai.stigmer.agentic.agentchannel.v1.ChannelConversationCount> getCountConversationsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "countConversations",
      requestType = ai.stigmer.agentic.agentchannel.v1.CountChannelConversationsInput.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.ChannelConversationCount.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.CountChannelConversationsInput,
      ai.stigmer.agentic.agentchannel.v1.ChannelConversationCount> getCountConversationsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.CountChannelConversationsInput, ai.stigmer.agentic.agentchannel.v1.ChannelConversationCount> getCountConversationsMethod;
    if ((getCountConversationsMethod = ChannelConversationQueryControllerGrpc.getCountConversationsMethod) == null) {
      synchronized (ChannelConversationQueryControllerGrpc.class) {
        if ((getCountConversationsMethod = ChannelConversationQueryControllerGrpc.getCountConversationsMethod) == null) {
          ChannelConversationQueryControllerGrpc.getCountConversationsMethod = getCountConversationsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.CountChannelConversationsInput, ai.stigmer.agentic.agentchannel.v1.ChannelConversationCount>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "countConversations"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.CountChannelConversationsInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.ChannelConversationCount.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelConversationQueryControllerMethodDescriptorSupplier("countConversations"))
              .build();
        }
      }
    }
    return getCountConversationsMethod;
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

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ListConversationTimelineInput,
      ai.stigmer.agentic.agentchannel.v1.ConversationTimeline> getListTimelineMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listTimeline",
      requestType = ai.stigmer.agentic.agentchannel.v1.ListConversationTimelineInput.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.ConversationTimeline.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ListConversationTimelineInput,
      ai.stigmer.agentic.agentchannel.v1.ConversationTimeline> getListTimelineMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ListConversationTimelineInput, ai.stigmer.agentic.agentchannel.v1.ConversationTimeline> getListTimelineMethod;
    if ((getListTimelineMethod = ChannelConversationQueryControllerGrpc.getListTimelineMethod) == null) {
      synchronized (ChannelConversationQueryControllerGrpc.class) {
        if ((getListTimelineMethod = ChannelConversationQueryControllerGrpc.getListTimelineMethod) == null) {
          ChannelConversationQueryControllerGrpc.getListTimelineMethod = getListTimelineMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.ListConversationTimelineInput, ai.stigmer.agentic.agentchannel.v1.ConversationTimeline>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listTimeline"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.ListConversationTimelineInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.ConversationTimeline.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelConversationQueryControllerMethodDescriptorSupplier("listTimeline"))
              .build();
        }
      }
    }
    return getListTimelineMethod;
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
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * List an organization's channel conversations, newest activity first.
     * Returns conversations across all of the org's channels the caller can
     * view, optionally filtered to one channel. Entries carry participation
     * state and the customer's display name.
     * </pre>
     */
    default void list(ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversationList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }

    /**
     * <pre>
     * Count an organization's channel conversations that match a filter.
     * The number behind a badge such as the inbox's "needs you": the same
     * predicate list applies, over the same channels, so the count and the
     * list it opens never disagree.
     * </pre>
     */
    default void countConversations(ai.stigmer.agentic.agentchannel.v1.CountChannelConversationsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversationCount> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCountConversationsMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get one conversation's identity and participation state.
     * The single-row read behind a conversation detail view: who holds
     * control, whether the conversation needs attention and why, the
     * customer's display name, and the activity clocks. Answers NOT_FOUND
     * until the customer's first message creates the conversation.
     * </pre>
     */
    default void getConversation(ai.stigmer.agentic.agentchannel.v1.GetChannelConversationInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversation> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetConversationMethod(), responseObserver);
    }

    /**
     * <pre>
     * List one conversation's timeline, newest first, one page at a time.
     * The timeline contains customer-visible items only: inbound customer
     * messages (including non-text kinds the platform cannot render),
     * delivered agent replies, and operator or platform sends. Run
     * internals never appear.
     * </pre>
     */
    default void listTimeline(ai.stigmer.agentic.agentchannel.v1.ListConversationTimelineInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ConversationTimeline> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListTimelineMethod(), responseObserver);
    }

    /**
     * <pre>
     * Mint a short-lived download URL for one inbound timeline item's
     * media file (an image or document the customer sent).
     * Answers NOT_FOUND when the item does not exist in this conversation
     * or carries no ingested media (a text item, or media the platform
     * declined to ingest).
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
     * </pre>
     */
    public void list(ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversationList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Count an organization's channel conversations that match a filter.
     * The number behind a badge such as the inbox's "needs you": the same
     * predicate list applies, over the same channels, so the count and the
     * list it opens never disagree.
     * </pre>
     */
    public void countConversations(ai.stigmer.agentic.agentchannel.v1.CountChannelConversationsInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversationCount> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCountConversationsMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get one conversation's identity and participation state.
     * The single-row read behind a conversation detail view: who holds
     * control, whether the conversation needs attention and why, the
     * customer's display name, and the activity clocks. Answers NOT_FOUND
     * until the customer's first message creates the conversation.
     * </pre>
     */
    public void getConversation(ai.stigmer.agentic.agentchannel.v1.GetChannelConversationInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversation> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetConversationMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List one conversation's timeline, newest first, one page at a time.
     * The timeline contains customer-visible items only: inbound customer
     * messages (including non-text kinds the platform cannot render),
     * delivered agent replies, and operator or platform sends. Run
     * internals never appear.
     * </pre>
     */
    public void listTimeline(ai.stigmer.agentic.agentchannel.v1.ListConversationTimelineInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ConversationTimeline> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListTimelineMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Mint a short-lived download URL for one inbound timeline item's
     * media file (an image or document the customer sent).
     * Answers NOT_FOUND when the item does not exist in this conversation
     * or carries no ingested media (a text item, or media the platform
     * declined to ingest).
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
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ChannelConversationList list(ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Count an organization's channel conversations that match a filter.
     * The number behind a badge such as the inbox's "needs you": the same
     * predicate list applies, over the same channels, so the count and the
     * list it opens never disagree.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ChannelConversationCount countConversations(ai.stigmer.agentic.agentchannel.v1.CountChannelConversationsInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCountConversationsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get one conversation's identity and participation state.
     * The single-row read behind a conversation detail view: who holds
     * control, whether the conversation needs attention and why, the
     * customer's display name, and the activity clocks. Answers NOT_FOUND
     * until the customer's first message creates the conversation.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ChannelConversation getConversation(ai.stigmer.agentic.agentchannel.v1.GetChannelConversationInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetConversationMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List one conversation's timeline, newest first, one page at a time.
     * The timeline contains customer-visible items only: inbound customer
     * messages (including non-text kinds the platform cannot render),
     * delivered agent replies, and operator or platform sends. Run
     * internals never appear.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ConversationTimeline listTimeline(ai.stigmer.agentic.agentchannel.v1.ListConversationTimelineInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListTimelineMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Mint a short-lived download URL for one inbound timeline item's
     * media file (an image or document the customer sent).
     * Answers NOT_FOUND when the item does not exist in this conversation
     * or carries no ingested media (a text item, or media the platform
     * declined to ingest).
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
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ChannelConversationList list(ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Count an organization's channel conversations that match a filter.
     * The number behind a badge such as the inbox's "needs you": the same
     * predicate list applies, over the same channels, so the count and the
     * list it opens never disagree.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ChannelConversationCount countConversations(ai.stigmer.agentic.agentchannel.v1.CountChannelConversationsInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCountConversationsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get one conversation's identity and participation state.
     * The single-row read behind a conversation detail view: who holds
     * control, whether the conversation needs attention and why, the
     * customer's display name, and the activity clocks. Answers NOT_FOUND
     * until the customer's first message creates the conversation.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ChannelConversation getConversation(ai.stigmer.agentic.agentchannel.v1.GetChannelConversationInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetConversationMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List one conversation's timeline, newest first, one page at a time.
     * The timeline contains customer-visible items only: inbound customer
     * messages (including non-text kinds the platform cannot render),
     * delivered agent replies, and operator or platform sends. Run
     * internals never appear.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ConversationTimeline listTimeline(ai.stigmer.agentic.agentchannel.v1.ListConversationTimelineInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListTimelineMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Mint a short-lived download URL for one inbound timeline item's
     * media file (an image or document the customer sent).
     * Answers NOT_FOUND when the item does not exist in this conversation
     * or carries no ingested media (a text item, or media the platform
     * declined to ingest).
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
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.ChannelConversationList> list(
        ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Count an organization's channel conversations that match a filter.
     * The number behind a badge such as the inbox's "needs you": the same
     * predicate list applies, over the same channels, so the count and the
     * list it opens never disagree.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.ChannelConversationCount> countConversations(
        ai.stigmer.agentic.agentchannel.v1.CountChannelConversationsInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCountConversationsMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get one conversation's identity and participation state.
     * The single-row read behind a conversation detail view: who holds
     * control, whether the conversation needs attention and why, the
     * customer's display name, and the activity clocks. Answers NOT_FOUND
     * until the customer's first message creates the conversation.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.ChannelConversation> getConversation(
        ai.stigmer.agentic.agentchannel.v1.GetChannelConversationInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetConversationMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List one conversation's timeline, newest first, one page at a time.
     * The timeline contains customer-visible items only: inbound customer
     * messages (including non-text kinds the platform cannot render),
     * delivered agent replies, and operator or platform sends. Run
     * internals never appear.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.ConversationTimeline> listTimeline(
        ai.stigmer.agentic.agentchannel.v1.ListConversationTimelineInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListTimelineMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Mint a short-lived download URL for one inbound timeline item's
     * media file (an image or document the customer sent).
     * Answers NOT_FOUND when the item does not exist in this conversation
     * or carries no ingested media (a text item, or media the platform
     * declined to ingest).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.ConversationMediaDownloadUrl> getMediaDownloadUrl(
        ai.stigmer.agentic.agentchannel.v1.GetConversationMediaDownloadUrlInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMediaDownloadUrlMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_LIST = 0;
  private static final int METHODID_COUNT_CONVERSATIONS = 1;
  private static final int METHODID_GET_CONVERSATION = 2;
  private static final int METHODID_LIST_TIMELINE = 3;
  private static final int METHODID_GET_MEDIA_DOWNLOAD_URL = 4;

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
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversationList>) responseObserver);
          break;
        case METHODID_COUNT_CONVERSATIONS:
          serviceImpl.countConversations((ai.stigmer.agentic.agentchannel.v1.CountChannelConversationsInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversationCount>) responseObserver);
          break;
        case METHODID_GET_CONVERSATION:
          serviceImpl.getConversation((ai.stigmer.agentic.agentchannel.v1.GetChannelConversationInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversation>) responseObserver);
          break;
        case METHODID_LIST_TIMELINE:
          serviceImpl.listTimeline((ai.stigmer.agentic.agentchannel.v1.ListConversationTimelineInput) request,
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
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.ListChannelConversationsInput,
              ai.stigmer.agentic.agentchannel.v1.ChannelConversationList>(
                service, METHODID_LIST)))
        .addMethod(
          getCountConversationsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.CountChannelConversationsInput,
              ai.stigmer.agentic.agentchannel.v1.ChannelConversationCount>(
                service, METHODID_COUNT_CONVERSATIONS)))
        .addMethod(
          getGetConversationMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.GetChannelConversationInput,
              ai.stigmer.agentic.agentchannel.v1.ChannelConversation>(
                service, METHODID_GET_CONVERSATION)))
        .addMethod(
          getListTimelineMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.ListConversationTimelineInput,
              ai.stigmer.agentic.agentchannel.v1.ConversationTimeline>(
                service, METHODID_LIST_TIMELINE)))
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
              .addMethod(getListMethod())
              .addMethod(getCountConversationsMethod())
              .addMethod(getGetConversationMethod())
              .addMethod(getListTimelineMethod())
              .addMethod(getGetMediaDownloadUrlMethod())
              .build();
        }
      }
    }
    return result;
  }
}
