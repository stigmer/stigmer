package ai.stigmer.agentic.agentchannel.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ChannelMessageQueryController serves runtime reads that support
 * business-initiated messaging on agent channels.
 * &#64;internal
 * proactive-messaging DD-003 D6: the query sibling of
 * ChannelMessageCommandController — runtime messaging traffic (the send
 * and its supporting reads) stays off the resource CRUD surface, the
 * datastore-domain split applied consistently.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ChannelMessageQueryControllerGrpc {

  private ChannelMessageQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.agentchannel.v1.ChannelMessageQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ListChannelTemplatesInput,
      ai.stigmer.agentic.agentchannel.v1.ChannelTemplates> getListTemplatesMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "listTemplates",
      requestType = ai.stigmer.agentic.agentchannel.v1.ListChannelTemplatesInput.class,
      responseType = ai.stigmer.agentic.agentchannel.v1.ChannelTemplates.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ListChannelTemplatesInput,
      ai.stigmer.agentic.agentchannel.v1.ChannelTemplates> getListTemplatesMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.agentchannel.v1.ListChannelTemplatesInput, ai.stigmer.agentic.agentchannel.v1.ChannelTemplates> getListTemplatesMethod;
    if ((getListTemplatesMethod = ChannelMessageQueryControllerGrpc.getListTemplatesMethod) == null) {
      synchronized (ChannelMessageQueryControllerGrpc.class) {
        if ((getListTemplatesMethod = ChannelMessageQueryControllerGrpc.getListTemplatesMethod) == null) {
          ChannelMessageQueryControllerGrpc.getListTemplatesMethod = getListTemplatesMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.agentchannel.v1.ListChannelTemplatesInput, ai.stigmer.agentic.agentchannel.v1.ChannelTemplates>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "listTemplates"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.ListChannelTemplatesInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.agentchannel.v1.ChannelTemplates.getDefaultInstance()))
              .setSchemaDescriptor(new ChannelMessageQueryControllerMethodDescriptorSupplier("listTemplates"))
              .build();
        }
      }
    }
    return getListTemplatesMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ChannelMessageQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelMessageQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelMessageQueryControllerStub>() {
        @java.lang.Override
        public ChannelMessageQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelMessageQueryControllerStub(channel, callOptions);
        }
      };
    return ChannelMessageQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ChannelMessageQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelMessageQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelMessageQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public ChannelMessageQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelMessageQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ChannelMessageQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ChannelMessageQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelMessageQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelMessageQueryControllerBlockingStub>() {
        @java.lang.Override
        public ChannelMessageQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelMessageQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return ChannelMessageQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ChannelMessageQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ChannelMessageQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ChannelMessageQueryControllerFutureStub>() {
        @java.lang.Override
        public ChannelMessageQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ChannelMessageQueryControllerFutureStub(channel, callOptions);
        }
      };
    return ChannelMessageQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ChannelMessageQueryController serves runtime reads that support
   * business-initiated messaging on agent channels.
   * &#64;internal
   * proactive-messaging DD-003 D6: the query sibling of
   * ChannelMessageCommandController — runtime messaging traffic (the send
   * and its supporting reads) stays off the resource CRUD surface, the
   * datastore-domain split applied consistently.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * List the message templates available on an agent channel.
     * Read live from the channel provider's registry (WhatsApp: the
     * WABA's templates), lightly cached. The provider is the source of
     * truth; entries carry its vocabulary verbatim.
     * &#64;internal
     * DD-003 D6. Same in-handler token-class reach as sendMessage (DD-002
     * D2/D4): sandbox tokens resolve through the serving channel, direct
     * principals through channel visibility; fail closed. The WABA id is
     * derived from the channel's phone_number_id on demand and cached —
     * never stored (DD-003 D3). A token missing the management scope
     * degrades this read only, never sends (DD-003 D7, Meta error 200 →
     * FAILED_PRECONDITION pointing at token regeneration). Cloud-first
     * runtime: the OSS edition returns FAILED_PRECONDITION (decision 001
     * D-g posture).
     * </pre>
     */
    default void listTemplates(ai.stigmer.agentic.agentchannel.v1.ListChannelTemplatesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelTemplates> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListTemplatesMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ChannelMessageQueryController.
   * <pre>
   * ChannelMessageQueryController serves runtime reads that support
   * business-initiated messaging on agent channels.
   * &#64;internal
   * proactive-messaging DD-003 D6: the query sibling of
   * ChannelMessageCommandController — runtime messaging traffic (the send
   * and its supporting reads) stays off the resource CRUD surface, the
   * datastore-domain split applied consistently.
   * </pre>
   */
  public static abstract class ChannelMessageQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ChannelMessageQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ChannelMessageQueryController.
   * <pre>
   * ChannelMessageQueryController serves runtime reads that support
   * business-initiated messaging on agent channels.
   * &#64;internal
   * proactive-messaging DD-003 D6: the query sibling of
   * ChannelMessageCommandController — runtime messaging traffic (the send
   * and its supporting reads) stays off the resource CRUD surface, the
   * datastore-domain split applied consistently.
   * </pre>
   */
  public static final class ChannelMessageQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ChannelMessageQueryControllerStub> {
    private ChannelMessageQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelMessageQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelMessageQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * List the message templates available on an agent channel.
     * Read live from the channel provider's registry (WhatsApp: the
     * WABA's templates), lightly cached. The provider is the source of
     * truth; entries carry its vocabulary verbatim.
     * &#64;internal
     * DD-003 D6. Same in-handler token-class reach as sendMessage (DD-002
     * D2/D4): sandbox tokens resolve through the serving channel, direct
     * principals through channel visibility; fail closed. The WABA id is
     * derived from the channel's phone_number_id on demand and cached —
     * never stored (DD-003 D3). A token missing the management scope
     * degrades this read only, never sends (DD-003 D7, Meta error 200 →
     * FAILED_PRECONDITION pointing at token regeneration). Cloud-first
     * runtime: the OSS edition returns FAILED_PRECONDITION (decision 001
     * D-g posture).
     * </pre>
     */
    public void listTemplates(ai.stigmer.agentic.agentchannel.v1.ListChannelTemplatesInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelTemplates> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListTemplatesMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ChannelMessageQueryController.
   * <pre>
   * ChannelMessageQueryController serves runtime reads that support
   * business-initiated messaging on agent channels.
   * &#64;internal
   * proactive-messaging DD-003 D6: the query sibling of
   * ChannelMessageCommandController — runtime messaging traffic (the send
   * and its supporting reads) stays off the resource CRUD surface, the
   * datastore-domain split applied consistently.
   * </pre>
   */
  public static final class ChannelMessageQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ChannelMessageQueryControllerBlockingV2Stub> {
    private ChannelMessageQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelMessageQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelMessageQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * List the message templates available on an agent channel.
     * Read live from the channel provider's registry (WhatsApp: the
     * WABA's templates), lightly cached. The provider is the source of
     * truth; entries carry its vocabulary verbatim.
     * &#64;internal
     * DD-003 D6. Same in-handler token-class reach as sendMessage (DD-002
     * D2/D4): sandbox tokens resolve through the serving channel, direct
     * principals through channel visibility; fail closed. The WABA id is
     * derived from the channel's phone_number_id on demand and cached —
     * never stored (DD-003 D3). A token missing the management scope
     * degrades this read only, never sends (DD-003 D7, Meta error 200 →
     * FAILED_PRECONDITION pointing at token regeneration). Cloud-first
     * runtime: the OSS edition returns FAILED_PRECONDITION (decision 001
     * D-g posture).
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ChannelTemplates listTemplates(ai.stigmer.agentic.agentchannel.v1.ListChannelTemplatesInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListTemplatesMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ChannelMessageQueryController.
   * <pre>
   * ChannelMessageQueryController serves runtime reads that support
   * business-initiated messaging on agent channels.
   * &#64;internal
   * proactive-messaging DD-003 D6: the query sibling of
   * ChannelMessageCommandController — runtime messaging traffic (the send
   * and its supporting reads) stays off the resource CRUD surface, the
   * datastore-domain split applied consistently.
   * </pre>
   */
  public static final class ChannelMessageQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ChannelMessageQueryControllerBlockingStub> {
    private ChannelMessageQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelMessageQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelMessageQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * List the message templates available on an agent channel.
     * Read live from the channel provider's registry (WhatsApp: the
     * WABA's templates), lightly cached. The provider is the source of
     * truth; entries carry its vocabulary verbatim.
     * &#64;internal
     * DD-003 D6. Same in-handler token-class reach as sendMessage (DD-002
     * D2/D4): sandbox tokens resolve through the serving channel, direct
     * principals through channel visibility; fail closed. The WABA id is
     * derived from the channel's phone_number_id on demand and cached —
     * never stored (DD-003 D3). A token missing the management scope
     * degrades this read only, never sends (DD-003 D7, Meta error 200 →
     * FAILED_PRECONDITION pointing at token regeneration). Cloud-first
     * runtime: the OSS edition returns FAILED_PRECONDITION (decision 001
     * D-g posture).
     * </pre>
     */
    public ai.stigmer.agentic.agentchannel.v1.ChannelTemplates listTemplates(ai.stigmer.agentic.agentchannel.v1.ListChannelTemplatesInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListTemplatesMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ChannelMessageQueryController.
   * <pre>
   * ChannelMessageQueryController serves runtime reads that support
   * business-initiated messaging on agent channels.
   * &#64;internal
   * proactive-messaging DD-003 D6: the query sibling of
   * ChannelMessageCommandController — runtime messaging traffic (the send
   * and its supporting reads) stays off the resource CRUD surface, the
   * datastore-domain split applied consistently.
   * </pre>
   */
  public static final class ChannelMessageQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ChannelMessageQueryControllerFutureStub> {
    private ChannelMessageQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ChannelMessageQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ChannelMessageQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * List the message templates available on an agent channel.
     * Read live from the channel provider's registry (WhatsApp: the
     * WABA's templates), lightly cached. The provider is the source of
     * truth; entries carry its vocabulary verbatim.
     * &#64;internal
     * DD-003 D6. Same in-handler token-class reach as sendMessage (DD-002
     * D2/D4): sandbox tokens resolve through the serving channel, direct
     * principals through channel visibility; fail closed. The WABA id is
     * derived from the channel's phone_number_id on demand and cached —
     * never stored (DD-003 D3). A token missing the management scope
     * degrades this read only, never sends (DD-003 D7, Meta error 200 →
     * FAILED_PRECONDITION pointing at token regeneration). Cloud-first
     * runtime: the OSS edition returns FAILED_PRECONDITION (decision 001
     * D-g posture).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.agentchannel.v1.ChannelTemplates> listTemplates(
        ai.stigmer.agentic.agentchannel.v1.ListChannelTemplatesInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListTemplatesMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_LIST_TEMPLATES = 0;

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
        case METHODID_LIST_TEMPLATES:
          serviceImpl.listTemplates((ai.stigmer.agentic.agentchannel.v1.ListChannelTemplatesInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.agentchannel.v1.ChannelTemplates>) responseObserver);
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
          getListTemplatesMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.agentchannel.v1.ListChannelTemplatesInput,
              ai.stigmer.agentic.agentchannel.v1.ChannelTemplates>(
                service, METHODID_LIST_TEMPLATES)))
        .build();
  }

  private static abstract class ChannelMessageQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ChannelMessageQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.agentchannel.v1.MessageQueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ChannelMessageQueryController");
    }
  }

  private static final class ChannelMessageQueryControllerFileDescriptorSupplier
      extends ChannelMessageQueryControllerBaseDescriptorSupplier {
    ChannelMessageQueryControllerFileDescriptorSupplier() {}
  }

  private static final class ChannelMessageQueryControllerMethodDescriptorSupplier
      extends ChannelMessageQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ChannelMessageQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ChannelMessageQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ChannelMessageQueryControllerFileDescriptorSupplier())
              .addMethod(getListTemplatesMethod())
              .build();
        }
      }
    }
    return result;
  }
}
