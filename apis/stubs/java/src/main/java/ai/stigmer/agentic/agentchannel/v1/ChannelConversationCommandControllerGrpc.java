package ai.stigmer.agentic.agentchannel.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ChannelConversationCommandController operates a conversation's
 * participation state: staff replies, takeover and handback of the control
 * token, attention management, and the agent's escalation ingest.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ChannelConversationCommandControllerGrpc {

  private ChannelConversationCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agentchannel.v1.ChannelConversationCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ReplyToConversationInput,
      ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput> getReplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "reply",
      requestType = ai.stigmer.agentic.agentchannel.v1.ReplyToConversationInput.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ReplyToConversationInput,
      ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput> getReplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ReplyToConversationInput, ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput> getReplyMethod;
    if ((getReplyMethod = ChannelConversationCommandControllerGrpc.getReplyMethod) == null) {
      synchronized (ChannelConversationCommandControllerGrpc.class) {
        if ((getReplyMethod = ChannelConversationCommandControllerGrpc.getReplyMethod) == null) {
          ChannelConversationCommandControllerGrpc.getReplyMethod = getReplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.ReplyToConversationInput, ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "reply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.ReplyToConversationInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelConversationCommandControllerMethodDescriptorSupplier("reply"))
              .build();
        }
      }
    }
    return getReplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ConversationControlInput,
      ai.stigmer.agentic.agentchannel.v1.ChannelConversation> getTakeOverMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "takeOver",
      requestType = ai.stigmer.agentic.agentchannel.v1.ConversationControlInput.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.ChannelConversation.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ConversationControlInput,
      ai.stigmer.agentic.agentchannel.v1.ChannelConversation> getTakeOverMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ConversationControlInput, ai.stigmer.agentic.agentchannel.v1.ChannelConversation> getTakeOverMethod;
    if ((getTakeOverMethod = ChannelConversationCommandControllerGrpc.getTakeOverMethod) == null) {
      synchronized (ChannelConversationCommandControllerGrpc.class) {
        if ((getTakeOverMethod = ChannelConversationCommandControllerGrpc.getTakeOverMethod) == null) {
          ChannelConversationCommandControllerGrpc.getTakeOverMethod = getTakeOverMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.ConversationControlInput, ai.stigmer.agentic.agentchannel.v1.ChannelConversation>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "takeOver"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.ConversationControlInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.ChannelConversation.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelConversationCommandControllerMethodDescriptorSupplier("takeOver"))
              .build();
        }
      }
    }
    return getTakeOverMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ConversationControlInput,
      ai.stigmer.agentic.agentchannel.v1.ChannelConversation> getHandBackMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "handBack",
      requestType = ai.stigmer.agentic.agentchannel.v1.ConversationControlInput.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.ChannelConversation.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ConversationControlInput,
      ai.stigmer.agentic.agentchannel.v1.ChannelConversation> getHandBackMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ConversationControlInput, ai.stigmer.agentic.agentchannel.v1.ChannelConversation> getHandBackMethod;
    if ((getHandBackMethod = ChannelConversationCommandControllerGrpc.getHandBackMethod) == null) {
      synchronized (ChannelConversationCommandControllerGrpc.class) {
        if ((getHandBackMethod = ChannelConversationCommandControllerGrpc.getHandBackMethod) == null) {
          ChannelConversationCommandControllerGrpc.getHandBackMethod = getHandBackMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.ConversationControlInput, ai.stigmer.agentic.agentchannel.v1.ChannelConversation>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "handBack"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.ConversationControlInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.ChannelConversation.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelConversationCommandControllerMethodDescriptorSupplier("handBack"))
              .build();
        }
      }
    }
    return getHandBackMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ConversationControlInput,
      ai.stigmer.agentic.agentchannel.v1.ChannelConversation> getClearAttentionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "clearAttention",
      requestType = ai.stigmer.agentic.agentchannel.v1.ConversationControlInput.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.ChannelConversation.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ConversationControlInput,
      ai.stigmer.agentic.agentchannel.v1.ChannelConversation> getClearAttentionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ConversationControlInput, ai.stigmer.agentic.agentchannel.v1.ChannelConversation> getClearAttentionMethod;
    if ((getClearAttentionMethod = ChannelConversationCommandControllerGrpc.getClearAttentionMethod) == null) {
      synchronized (ChannelConversationCommandControllerGrpc.class) {
        if ((getClearAttentionMethod = ChannelConversationCommandControllerGrpc.getClearAttentionMethod) == null) {
          ChannelConversationCommandControllerGrpc.getClearAttentionMethod = getClearAttentionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.ConversationControlInput, ai.stigmer.agentic.agentchannel.v1.ChannelConversation>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "clearAttention"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.ConversationControlInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.ChannelConversation.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelConversationCommandControllerMethodDescriptorSupplier("clearAttention"))
              .build();
        }
      }
    }
    return getClearAttentionMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.EscalateConversationInput,
      ai.stigmer.agentic.agentchannel.v1.ChannelConversation> getEscalateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "escalate",
      requestType = ai.stigmer.agentic.agentchannel.v1.EscalateConversationInput.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.ChannelConversation.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.EscalateConversationInput,
      ai.stigmer.agentic.agentchannel.v1.ChannelConversation> getEscalateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.EscalateConversationInput, ai.stigmer.agentic.agentchannel.v1.ChannelConversation> getEscalateMethod;
    if ((getEscalateMethod = ChannelConversationCommandControllerGrpc.getEscalateMethod) == null) {
      synchronized (ChannelConversationCommandControllerGrpc.class) {
        if ((getEscalateMethod = ChannelConversationCommandControllerGrpc.getEscalateMethod) == null) {
          ChannelConversationCommandControllerGrpc.getEscalateMethod = getEscalateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.EscalateConversationInput, ai.stigmer.agentic.agentchannel.v1.ChannelConversation>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "escalate"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.EscalateConversationInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.ChannelConversation.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelConversationCommandControllerMethodDescriptorSupplier("escalate"))
              .build();
        }
      }
    }
    return getEscalateMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ChannelConversationCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelConversationCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelConversationCommandControllerStub>() {
        @java.lang.Override
        public ChannelConversationCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelConversationCommandControllerStub(channel, callOptions);
        }
      };
    return ChannelConversationCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ChannelConversationCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelConversationCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelConversationCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public ChannelConversationCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelConversationCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ChannelConversationCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ChannelConversationCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelConversationCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelConversationCommandControllerBlockingStub>() {
        @java.lang.Override
        public ChannelConversationCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelConversationCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return ChannelConversationCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ChannelConversationCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelConversationCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelConversationCommandControllerFutureStub>() {
        @java.lang.Override
        public ChannelConversationCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelConversationCommandControllerFutureStub(channel, callOptions);
        }
      };
    return ChannelConversationCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ChannelConversationCommandController operates a conversation's
   * participation state: staff replies, takeover and handback of the control
   * token, attention management, and the agent's escalation ingest.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Reply to a conversation as the business, through the same number the
     * agent serves.
     * The message is durably recorded and attempted inline; the outcome
     * reports the truth of the attempt. A staff reply on an agent-held
     * conversation is an implicit takeover: the agent goes quiet until
     * handBack. Replying requires an existing conversation — the customer
     * must have written first; an unknown conversation answers NOT_FOUND.
     * </pre>
     */
    default void reply(ai.stigmer.agentic.agentchannel.v1.ReplyToConversationInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getReplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Take over a conversation: the agent goes quiet until handBack.
     * Taking over also clears the needs-attention flag — the human arriving
     * is the answer to an escalation.
     * </pre>
     */
    default void takeOver(ai.stigmer.agentic.agentchannel.v1.ConversationControlInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversation> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getTakeOverMethod(), responseObserver);
    }

    /**
     * <pre>
     * Hand a conversation back to the agent, restoring automatic replies.
     * The agent re-enters with the conversation context it missed while the
     * human held control.
     * </pre>
     */
    default void handBack(ai.stigmer.agentic.agentchannel.v1.ConversationControlInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversation> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getHandBackMethod(), responseObserver);
    }

    /**
     * <pre>
     * Clear a conversation's needs-attention flag without taking it over.
     * The false-alarm dismissal: an escalation that needs no reply is
     * cleared in place, never via a take-over-and-hand-back dance.
     * </pre>
     */
    default void clearAttention(ai.stigmer.agentic.agentchannel.v1.ConversationControlInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversation> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getClearAttentionMethod(), responseObserver);
    }

    /**
     * <pre>
     * Flag this conversation for human attention.
     * Non-blocking: the agent keeps serving while the flag summons humans.
     * Repeated escalation is harmless; the latest reason wins.
     * </pre>
     */
    default void escalate(ai.stigmer.agentic.agentchannel.v1.EscalateConversationInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversation> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getEscalateMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ChannelConversationCommandController.
   * <pre>
   * ChannelConversationCommandController operates a conversation's
   * participation state: staff replies, takeover and handback of the control
   * token, attention management, and the agent's escalation ingest.
   * </pre>
   */
  public static abstract class ChannelConversationCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ChannelConversationCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ChannelConversationCommandController.
   * <pre>
   * ChannelConversationCommandController operates a conversation's
   * participation state: staff replies, takeover and handback of the control
   * token, attention management, and the agent's escalation ingest.
   * </pre>
   */
  public static final class ChannelConversationCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ChannelConversationCommandControllerStub> {
    private ChannelConversationCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelConversationCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelConversationCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Reply to a conversation as the business, through the same number the
     * agent serves.
     * The message is durably recorded and attempted inline; the outcome
     * reports the truth of the attempt. A staff reply on an agent-held
     * conversation is an implicit takeover: the agent goes quiet until
     * handBack. Replying requires an existing conversation — the customer
     * must have written first; an unknown conversation answers NOT_FOUND.
     * </pre>
     */
    public void reply(ai.stigmer.agentic.agentchannel.v1.ReplyToConversationInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getReplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Take over a conversation: the agent goes quiet until handBack.
     * Taking over also clears the needs-attention flag — the human arriving
     * is the answer to an escalation.
     * </pre>
     */
    public void takeOver(ai.stigmer.agentic.agentchannel.v1.ConversationControlInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversation> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getTakeOverMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Hand a conversation back to the agent, restoring automatic replies.
     * The agent re-enters with the conversation context it missed while the
     * human held control.
     * </pre>
     */
    public void handBack(ai.stigmer.agentic.agentchannel.v1.ConversationControlInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversation> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getHandBackMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Clear a conversation's needs-attention flag without taking it over.
     * The false-alarm dismissal: an escalation that needs no reply is
     * cleared in place, never via a take-over-and-hand-back dance.
     * </pre>
     */
    public void clearAttention(ai.stigmer.agentic.agentchannel.v1.ConversationControlInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversation> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getClearAttentionMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Flag this conversation for human attention.
     * Non-blocking: the agent keeps serving while the flag summons humans.
     * Repeated escalation is harmless; the latest reason wins.
     * </pre>
     */
    public void escalate(ai.stigmer.agentic.agentchannel.v1.EscalateConversationInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversation> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getEscalateMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ChannelConversationCommandController.
   * <pre>
   * ChannelConversationCommandController operates a conversation's
   * participation state: staff replies, takeover and handback of the control
   * token, attention management, and the agent's escalation ingest.
   * </pre>
   */
  public static final class ChannelConversationCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ChannelConversationCommandControllerBlockingV2Stub> {
    private ChannelConversationCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelConversationCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelConversationCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Reply to a conversation as the business, through the same number the
     * agent serves.
     * The message is durably recorded and attempted inline; the outcome
     * reports the truth of the attempt. A staff reply on an agent-held
     * conversation is an implicit takeover: the agent goes quiet until
     * handBack. Replying requires an existing conversation — the customer
     * must have written first; an unknown conversation answers NOT_FOUND.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput reply(ai.stigmer.agentic.agentchannel.v1.ReplyToConversationInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getReplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Take over a conversation: the agent goes quiet until handBack.
     * Taking over also clears the needs-attention flag — the human arriving
     * is the answer to an escalation.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ChannelConversation takeOver(ai.stigmer.agentic.agentchannel.v1.ConversationControlInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getTakeOverMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Hand a conversation back to the agent, restoring automatic replies.
     * The agent re-enters with the conversation context it missed while the
     * human held control.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ChannelConversation handBack(ai.stigmer.agentic.agentchannel.v1.ConversationControlInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getHandBackMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Clear a conversation's needs-attention flag without taking it over.
     * The false-alarm dismissal: an escalation that needs no reply is
     * cleared in place, never via a take-over-and-hand-back dance.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ChannelConversation clearAttention(ai.stigmer.agentic.agentchannel.v1.ConversationControlInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getClearAttentionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Flag this conversation for human attention.
     * Non-blocking: the agent keeps serving while the flag summons humans.
     * Repeated escalation is harmless; the latest reason wins.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ChannelConversation escalate(ai.stigmer.agentic.agentchannel.v1.EscalateConversationInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getEscalateMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ChannelConversationCommandController.
   * <pre>
   * ChannelConversationCommandController operates a conversation's
   * participation state: staff replies, takeover and handback of the control
   * token, attention management, and the agent's escalation ingest.
   * </pre>
   */
  public static final class ChannelConversationCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ChannelConversationCommandControllerBlockingStub> {
    private ChannelConversationCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelConversationCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelConversationCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Reply to a conversation as the business, through the same number the
     * agent serves.
     * The message is durably recorded and attempted inline; the outcome
     * reports the truth of the attempt. A staff reply on an agent-held
     * conversation is an implicit takeover: the agent goes quiet until
     * handBack. Replying requires an existing conversation — the customer
     * must have written first; an unknown conversation answers NOT_FOUND.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput reply(ai.stigmer.agentic.agentchannel.v1.ReplyToConversationInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getReplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Take over a conversation: the agent goes quiet until handBack.
     * Taking over also clears the needs-attention flag — the human arriving
     * is the answer to an escalation.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ChannelConversation takeOver(ai.stigmer.agentic.agentchannel.v1.ConversationControlInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getTakeOverMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Hand a conversation back to the agent, restoring automatic replies.
     * The agent re-enters with the conversation context it missed while the
     * human held control.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ChannelConversation handBack(ai.stigmer.agentic.agentchannel.v1.ConversationControlInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getHandBackMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Clear a conversation's needs-attention flag without taking it over.
     * The false-alarm dismissal: an escalation that needs no reply is
     * cleared in place, never via a take-over-and-hand-back dance.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ChannelConversation clearAttention(ai.stigmer.agentic.agentchannel.v1.ConversationControlInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getClearAttentionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Flag this conversation for human attention.
     * Non-blocking: the agent keeps serving while the flag summons humans.
     * Repeated escalation is harmless; the latest reason wins.
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ChannelConversation escalate(ai.stigmer.agentic.agentchannel.v1.EscalateConversationInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getEscalateMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ChannelConversationCommandController.
   * <pre>
   * ChannelConversationCommandController operates a conversation's
   * participation state: staff replies, takeover and handback of the control
   * token, attention management, and the agent's escalation ingest.
   * </pre>
   */
  public static final class ChannelConversationCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ChannelConversationCommandControllerFutureStub> {
    private ChannelConversationCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelConversationCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelConversationCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Reply to a conversation as the business, through the same number the
     * agent serves.
     * The message is durably recorded and attempted inline; the outcome
     * reports the truth of the attempt. A staff reply on an agent-held
     * conversation is an implicit takeover: the agent goes quiet until
     * handBack. Replying requires an existing conversation — the customer
     * must have written first; an unknown conversation answers NOT_FOUND.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput> reply(
        ai.stigmer.agentic.agentchannel.v1.ReplyToConversationInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getReplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Take over a conversation: the agent goes quiet until handBack.
     * Taking over also clears the needs-attention flag — the human arriving
     * is the answer to an escalation.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.ChannelConversation> takeOver(
        ai.stigmer.agentic.agentchannel.v1.ConversationControlInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getTakeOverMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Hand a conversation back to the agent, restoring automatic replies.
     * The agent re-enters with the conversation context it missed while the
     * human held control.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.ChannelConversation> handBack(
        ai.stigmer.agentic.agentchannel.v1.ConversationControlInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getHandBackMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Clear a conversation's needs-attention flag without taking it over.
     * The false-alarm dismissal: an escalation that needs no reply is
     * cleared in place, never via a take-over-and-hand-back dance.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.ChannelConversation> clearAttention(
        ai.stigmer.agentic.agentchannel.v1.ConversationControlInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getClearAttentionMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Flag this conversation for human attention.
     * Non-blocking: the agent keeps serving while the flag summons humans.
     * Repeated escalation is harmless; the latest reason wins.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.ChannelConversation> escalate(
        ai.stigmer.agentic.agentchannel.v1.EscalateConversationInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getEscalateMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_REPLY = 0;
  private static final int METHODID_TAKE_OVER = 1;
  private static final int METHODID_HAND_BACK = 2;
  private static final int METHODID_CLEAR_ATTENTION = 3;
  private static final int METHODID_ESCALATE = 4;

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
        case METHODID_REPLY:
          serviceImpl.reply((ai.stigmer.agentic.agentchannel.v1.ReplyToConversationInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput>) responseObserver);
          break;
        case METHODID_TAKE_OVER:
          serviceImpl.takeOver((ai.stigmer.agentic.agentchannel.v1.ConversationControlInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversation>) responseObserver);
          break;
        case METHODID_HAND_BACK:
          serviceImpl.handBack((ai.stigmer.agentic.agentchannel.v1.ConversationControlInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversation>) responseObserver);
          break;
        case METHODID_CLEAR_ATTENTION:
          serviceImpl.clearAttention((ai.stigmer.agentic.agentchannel.v1.ConversationControlInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversation>) responseObserver);
          break;
        case METHODID_ESCALATE:
          serviceImpl.escalate((ai.stigmer.agentic.agentchannel.v1.EscalateConversationInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelConversation>) responseObserver);
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
          getReplyMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.ReplyToConversationInput,
              ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput>(
                service, METHODID_REPLY)))
        .addMethod(
          getTakeOverMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.ConversationControlInput,
              ai.stigmer.agentic.agentchannel.v1.ChannelConversation>(
                service, METHODID_TAKE_OVER)))
        .addMethod(
          getHandBackMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.ConversationControlInput,
              ai.stigmer.agentic.agentchannel.v1.ChannelConversation>(
                service, METHODID_HAND_BACK)))
        .addMethod(
          getClearAttentionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.ConversationControlInput,
              ai.stigmer.agentic.agentchannel.v1.ChannelConversation>(
                service, METHODID_CLEAR_ATTENTION)))
        .addMethod(
          getEscalateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.EscalateConversationInput,
              ai.stigmer.agentic.agentchannel.v1.ChannelConversation>(
                service, METHODID_ESCALATE)))
        .build();
  }

  private static abstract class ChannelConversationCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ChannelConversationCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.agentchannel.v1.ConversationCommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ChannelConversationCommandController");
    }
  }

  private static final class ChannelConversationCommandControllerFileDescriptorSupplier
      extends ChannelConversationCommandControllerBaseDescriptorSupplier {
    ChannelConversationCommandControllerFileDescriptorSupplier() {}
  }

  private static final class ChannelConversationCommandControllerMethodDescriptorSupplier
      extends ChannelConversationCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ChannelConversationCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ChannelConversationCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ChannelConversationCommandControllerFileDescriptorSupplier())
              .addMethod(getReplyMethod())
              .addMethod(getTakeOverMethod())
              .addMethod(getHandBackMethod())
              .addMethod(getClearAttentionMethod())
              .addMethod(getEscalateMethod())
              .build();
        }
      }
    }
    return result;
  }
}
