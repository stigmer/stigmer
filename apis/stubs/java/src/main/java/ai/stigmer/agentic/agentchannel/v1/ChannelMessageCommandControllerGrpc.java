package ai.stigmer.agentic.agentchannel.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ChannelMessageCommandController handles business-initiated outbound
 * messages on agent channels.
 * &#64;internal
 * proactive-messaging DD-002 D2: the runtime messaging surface beside
 * the AgentChannel resource controllers — the
 * DatastoreRecordCommandController-beside-DatastoreCommandController
 * split, so resource CRUD and runtime traffic never mix. Dual-audience
 * by token-class dispatch (the RecordReach shape): the agent's
 * send_channel_message tool calls with a session-scoped sandbox token;
 * direct principals (console, CLI, SDK) call with their own identity.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ChannelMessageCommandControllerGrpc {

  private ChannelMessageCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agentchannel.v1.ChannelMessageCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.SendChannelMessageInput,
      ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput> getSendMessageMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "sendMessage",
      requestType = ai.stigmer.agentic.agentchannel.v1.SendChannelMessageInput.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.SendChannelMessageInput,
      ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput> getSendMessageMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.SendChannelMessageInput, ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput> getSendMessageMethod;
    if ((getSendMessageMethod = ChannelMessageCommandControllerGrpc.getSendMessageMethod) == null) {
      synchronized (ChannelMessageCommandControllerGrpc.class) {
        if ((getSendMessageMethod = ChannelMessageCommandControllerGrpc.getSendMessageMethod) == null) {
          ChannelMessageCommandControllerGrpc.getSendMessageMethod = getSendMessageMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.SendChannelMessageInput, ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "sendMessage"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.SendChannelMessageInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelMessageCommandControllerMethodDescriptorSupplier("sendMessage"))
              .build();
        }
      }
    }
    return getSendMessageMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ChannelMessageCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelMessageCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelMessageCommandControllerStub>() {
        @java.lang.Override
        public ChannelMessageCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelMessageCommandControllerStub(channel, callOptions);
        }
      };
    return ChannelMessageCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ChannelMessageCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelMessageCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelMessageCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public ChannelMessageCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelMessageCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ChannelMessageCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ChannelMessageCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelMessageCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelMessageCommandControllerBlockingStub>() {
        @java.lang.Override
        public ChannelMessageCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelMessageCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return ChannelMessageCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ChannelMessageCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelMessageCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelMessageCommandControllerFutureStub>() {
        @java.lang.Override
        public ChannelMessageCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelMessageCommandControllerFutureStub(channel, callOptions);
        }
      };
    return ChannelMessageCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ChannelMessageCommandController handles business-initiated outbound
   * messages on agent channels.
   * &#64;internal
   * proactive-messaging DD-002 D2: the runtime messaging surface beside
   * the AgentChannel resource controllers — the
   * DatastoreRecordCommandController-beside-DatastoreCommandController
   * split, so resource CRUD and runtime traffic never mix. Dual-audience
   * by token-class dispatch (the RecordReach shape): the agent's
   * send_channel_message tool calls with a session-scoped sandbox token;
   * direct principals (console, CLI, SDK) call with their own identity.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Send a business-initiated message to a recipient on an agent channel.
     * The message is durably recorded and attempted once inline; transient
     * failures are retried in the background. The outcome reports the
     * truth of the inline attempt.
     * &#64;internal
     * Authorization in-handler (DD-002 D2/D6/D9): token-class dispatch,
     * fail closed; agent-anchored chain (never session-sender-anchored —
     * the recipient is an argument). Error contract (DD-002 D4): unknown
     * or foreign token class, no serving channel, proactive messaging not
     * enabled, or channel/org mismatch → PERMISSION_DENIED with no policy
     * detail leaked; malformed input or ambiguous channel/language →
     * INVALID_ARGUMENT with the candidates listed; channel not installed →
     * FAILED_PRECONDITION; rate caps, recipient policy, and provider
     * refusals → outcome=refused; transient provider failures →
     * outcome=queued. Cloud-first runtime: the OSS edition returns
     * FAILED_PRECONDITION (decision 001 D-g posture, the initiateInstall
     * precedent).
     * </pre>
     */
    default void sendMessage(ai.stigmer.agentic.agentchannel.v1.SendChannelMessageInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSendMessageMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ChannelMessageCommandController.
   * <pre>
   * ChannelMessageCommandController handles business-initiated outbound
   * messages on agent channels.
   * &#64;internal
   * proactive-messaging DD-002 D2: the runtime messaging surface beside
   * the AgentChannel resource controllers — the
   * DatastoreRecordCommandController-beside-DatastoreCommandController
   * split, so resource CRUD and runtime traffic never mix. Dual-audience
   * by token-class dispatch (the RecordReach shape): the agent's
   * send_channel_message tool calls with a session-scoped sandbox token;
   * direct principals (console, CLI, SDK) call with their own identity.
   * </pre>
   */
  public static abstract class ChannelMessageCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ChannelMessageCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ChannelMessageCommandController.
   * <pre>
   * ChannelMessageCommandController handles business-initiated outbound
   * messages on agent channels.
   * &#64;internal
   * proactive-messaging DD-002 D2: the runtime messaging surface beside
   * the AgentChannel resource controllers — the
   * DatastoreRecordCommandController-beside-DatastoreCommandController
   * split, so resource CRUD and runtime traffic never mix. Dual-audience
   * by token-class dispatch (the RecordReach shape): the agent's
   * send_channel_message tool calls with a session-scoped sandbox token;
   * direct principals (console, CLI, SDK) call with their own identity.
   * </pre>
   */
  public static final class ChannelMessageCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ChannelMessageCommandControllerStub> {
    private ChannelMessageCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelMessageCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelMessageCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Send a business-initiated message to a recipient on an agent channel.
     * The message is durably recorded and attempted once inline; transient
     * failures are retried in the background. The outcome reports the
     * truth of the inline attempt.
     * &#64;internal
     * Authorization in-handler (DD-002 D2/D6/D9): token-class dispatch,
     * fail closed; agent-anchored chain (never session-sender-anchored —
     * the recipient is an argument). Error contract (DD-002 D4): unknown
     * or foreign token class, no serving channel, proactive messaging not
     * enabled, or channel/org mismatch → PERMISSION_DENIED with no policy
     * detail leaked; malformed input or ambiguous channel/language →
     * INVALID_ARGUMENT with the candidates listed; channel not installed →
     * FAILED_PRECONDITION; rate caps, recipient policy, and provider
     * refusals → outcome=refused; transient provider failures →
     * outcome=queued. Cloud-first runtime: the OSS edition returns
     * FAILED_PRECONDITION (decision 001 D-g posture, the initiateInstall
     * precedent).
     * </pre>
     */
    public void sendMessage(ai.stigmer.agentic.agentchannel.v1.SendChannelMessageInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSendMessageMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ChannelMessageCommandController.
   * <pre>
   * ChannelMessageCommandController handles business-initiated outbound
   * messages on agent channels.
   * &#64;internal
   * proactive-messaging DD-002 D2: the runtime messaging surface beside
   * the AgentChannel resource controllers — the
   * DatastoreRecordCommandController-beside-DatastoreCommandController
   * split, so resource CRUD and runtime traffic never mix. Dual-audience
   * by token-class dispatch (the RecordReach shape): the agent's
   * send_channel_message tool calls with a session-scoped sandbox token;
   * direct principals (console, CLI, SDK) call with their own identity.
   * </pre>
   */
  public static final class ChannelMessageCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ChannelMessageCommandControllerBlockingV2Stub> {
    private ChannelMessageCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelMessageCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelMessageCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Send a business-initiated message to a recipient on an agent channel.
     * The message is durably recorded and attempted once inline; transient
     * failures are retried in the background. The outcome reports the
     * truth of the inline attempt.
     * &#64;internal
     * Authorization in-handler (DD-002 D2/D6/D9): token-class dispatch,
     * fail closed; agent-anchored chain (never session-sender-anchored —
     * the recipient is an argument). Error contract (DD-002 D4): unknown
     * or foreign token class, no serving channel, proactive messaging not
     * enabled, or channel/org mismatch → PERMISSION_DENIED with no policy
     * detail leaked; malformed input or ambiguous channel/language →
     * INVALID_ARGUMENT with the candidates listed; channel not installed →
     * FAILED_PRECONDITION; rate caps, recipient policy, and provider
     * refusals → outcome=refused; transient provider failures →
     * outcome=queued. Cloud-first runtime: the OSS edition returns
     * FAILED_PRECONDITION (decision 001 D-g posture, the initiateInstall
     * precedent).
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput sendMessage(ai.stigmer.agentic.agentchannel.v1.SendChannelMessageInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSendMessageMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ChannelMessageCommandController.
   * <pre>
   * ChannelMessageCommandController handles business-initiated outbound
   * messages on agent channels.
   * &#64;internal
   * proactive-messaging DD-002 D2: the runtime messaging surface beside
   * the AgentChannel resource controllers — the
   * DatastoreRecordCommandController-beside-DatastoreCommandController
   * split, so resource CRUD and runtime traffic never mix. Dual-audience
   * by token-class dispatch (the RecordReach shape): the agent's
   * send_channel_message tool calls with a session-scoped sandbox token;
   * direct principals (console, CLI, SDK) call with their own identity.
   * </pre>
   */
  public static final class ChannelMessageCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ChannelMessageCommandControllerBlockingStub> {
    private ChannelMessageCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelMessageCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelMessageCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Send a business-initiated message to a recipient on an agent channel.
     * The message is durably recorded and attempted once inline; transient
     * failures are retried in the background. The outcome reports the
     * truth of the inline attempt.
     * &#64;internal
     * Authorization in-handler (DD-002 D2/D6/D9): token-class dispatch,
     * fail closed; agent-anchored chain (never session-sender-anchored —
     * the recipient is an argument). Error contract (DD-002 D4): unknown
     * or foreign token class, no serving channel, proactive messaging not
     * enabled, or channel/org mismatch → PERMISSION_DENIED with no policy
     * detail leaked; malformed input or ambiguous channel/language →
     * INVALID_ARGUMENT with the candidates listed; channel not installed →
     * FAILED_PRECONDITION; rate caps, recipient policy, and provider
     * refusals → outcome=refused; transient provider failures →
     * outcome=queued. Cloud-first runtime: the OSS edition returns
     * FAILED_PRECONDITION (decision 001 D-g posture, the initiateInstall
     * precedent).
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput sendMessage(ai.stigmer.agentic.agentchannel.v1.SendChannelMessageInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSendMessageMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ChannelMessageCommandController.
   * <pre>
   * ChannelMessageCommandController handles business-initiated outbound
   * messages on agent channels.
   * &#64;internal
   * proactive-messaging DD-002 D2: the runtime messaging surface beside
   * the AgentChannel resource controllers — the
   * DatastoreRecordCommandController-beside-DatastoreCommandController
   * split, so resource CRUD and runtime traffic never mix. Dual-audience
   * by token-class dispatch (the RecordReach shape): the agent's
   * send_channel_message tool calls with a session-scoped sandbox token;
   * direct principals (console, CLI, SDK) call with their own identity.
   * </pre>
   */
  public static final class ChannelMessageCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ChannelMessageCommandControllerFutureStub> {
    private ChannelMessageCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelMessageCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelMessageCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Send a business-initiated message to a recipient on an agent channel.
     * The message is durably recorded and attempted once inline; transient
     * failures are retried in the background. The outcome reports the
     * truth of the inline attempt.
     * &#64;internal
     * Authorization in-handler (DD-002 D2/D6/D9): token-class dispatch,
     * fail closed; agent-anchored chain (never session-sender-anchored —
     * the recipient is an argument). Error contract (DD-002 D4): unknown
     * or foreign token class, no serving channel, proactive messaging not
     * enabled, or channel/org mismatch → PERMISSION_DENIED with no policy
     * detail leaked; malformed input or ambiguous channel/language →
     * INVALID_ARGUMENT with the candidates listed; channel not installed →
     * FAILED_PRECONDITION; rate caps, recipient policy, and provider
     * refusals → outcome=refused; transient provider failures →
     * outcome=queued. Cloud-first runtime: the OSS edition returns
     * FAILED_PRECONDITION (decision 001 D-g posture, the initiateInstall
     * precedent).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput> sendMessage(
        ai.stigmer.agentic.agentchannel.v1.SendChannelMessageInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSendMessageMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_SEND_MESSAGE = 0;

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
        case METHODID_SEND_MESSAGE:
          serviceImpl.sendMessage((ai.stigmer.agentic.agentchannel.v1.SendChannelMessageInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput>) responseObserver);
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
          getSendMessageMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.SendChannelMessageInput,
              ai.stigmer.agentic.agentchannel.v1.SendChannelMessageOutput>(
                service, METHODID_SEND_MESSAGE)))
        .build();
  }

  private static abstract class ChannelMessageCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ChannelMessageCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.agentchannel.v1.MessageCommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ChannelMessageCommandController");
    }
  }

  private static final class ChannelMessageCommandControllerFileDescriptorSupplier
      extends ChannelMessageCommandControllerBaseDescriptorSupplier {
    ChannelMessageCommandControllerFileDescriptorSupplier() {}
  }

  private static final class ChannelMessageCommandControllerMethodDescriptorSupplier
      extends ChannelMessageCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ChannelMessageCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ChannelMessageCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ChannelMessageCommandControllerFileDescriptorSupplier())
              .addMethod(getSendMessageMethod())
              .build();
        }
      }
    }
    return result;
  }
}
