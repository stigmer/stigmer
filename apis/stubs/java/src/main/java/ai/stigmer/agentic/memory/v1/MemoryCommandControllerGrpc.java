package ai.stigmer.agentic.memory.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * MemoryCommandController handles write operations for memories.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class MemoryCommandControllerGrpc {

  private MemoryCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.memory.v1.MemoryCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.memory.v1.Memory,
      ai.stigmer.agentic.memory.v1.Memory> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.memory.v1.Memory.class,
      responseType = ai.stigmer.agentic.memory.v1.Memory.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.memory.v1.Memory,
      ai.stigmer.agentic.memory.v1.Memory> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.memory.v1.Memory, ai.stigmer.agentic.memory.v1.Memory> getCreateMethod;
    if ((getCreateMethod = MemoryCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (MemoryCommandControllerGrpc.class) {
        if ((getCreateMethod = MemoryCommandControllerGrpc.getCreateMethod) == null) {
          MemoryCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.memory.v1.Memory, ai.stigmer.agentic.memory.v1.Memory>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.memory.v1.Memory.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.memory.v1.Memory.getDefaultInstance()))
              .setSchemaDescriptor(new MemoryCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.memory.v1.Memory,
      ai.stigmer.agentic.memory.v1.Memory> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.memory.v1.Memory.class,
      responseType = ai.stigmer.agentic.memory.v1.Memory.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.memory.v1.Memory,
      ai.stigmer.agentic.memory.v1.Memory> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.memory.v1.Memory, ai.stigmer.agentic.memory.v1.Memory> getUpdateMethod;
    if ((getUpdateMethod = MemoryCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (MemoryCommandControllerGrpc.class) {
        if ((getUpdateMethod = MemoryCommandControllerGrpc.getUpdateMethod) == null) {
          MemoryCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.memory.v1.Memory, ai.stigmer.agentic.memory.v1.Memory>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.memory.v1.Memory.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.memory.v1.Memory.getDefaultInstance()))
              .setSchemaDescriptor(new MemoryCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.memory.v1.MemoryId,
      ai.stigmer.agentic.memory.v1.Memory> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.memory.v1.MemoryId.class,
      responseType = ai.stigmer.agentic.memory.v1.Memory.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.memory.v1.MemoryId,
      ai.stigmer.agentic.memory.v1.Memory> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.memory.v1.MemoryId, ai.stigmer.agentic.memory.v1.Memory> getDeleteMethod;
    if ((getDeleteMethod = MemoryCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (MemoryCommandControllerGrpc.class) {
        if ((getDeleteMethod = MemoryCommandControllerGrpc.getDeleteMethod) == null) {
          MemoryCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.memory.v1.MemoryId, ai.stigmer.agentic.memory.v1.Memory>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.memory.v1.MemoryId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.memory.v1.Memory.getDefaultInstance()))
              .setSchemaDescriptor(new MemoryCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.memory.v1.MemoryId,
      ai.stigmer.agentic.memory.v1.Memory> getConfirmMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "confirm",
      requestType = ai.stigmer.agentic.memory.v1.MemoryId.class,
      responseType = ai.stigmer.agentic.memory.v1.Memory.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.memory.v1.MemoryId,
      ai.stigmer.agentic.memory.v1.Memory> getConfirmMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.memory.v1.MemoryId, ai.stigmer.agentic.memory.v1.Memory> getConfirmMethod;
    if ((getConfirmMethod = MemoryCommandControllerGrpc.getConfirmMethod) == null) {
      synchronized (MemoryCommandControllerGrpc.class) {
        if ((getConfirmMethod = MemoryCommandControllerGrpc.getConfirmMethod) == null) {
          MemoryCommandControllerGrpc.getConfirmMethod = getConfirmMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.memory.v1.MemoryId, ai.stigmer.agentic.memory.v1.Memory>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "confirm"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.memory.v1.MemoryId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.memory.v1.Memory.getDefaultInstance()))
              .setSchemaDescriptor(new MemoryCommandControllerMethodDescriptorSupplier("confirm"))
              .build();
        }
      }
    }
    return getConfirmMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.memory.v1.MemoryId,
      ai.stigmer.agentic.memory.v1.Memory> getRejectMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "reject",
      requestType = ai.stigmer.agentic.memory.v1.MemoryId.class,
      responseType = ai.stigmer.agentic.memory.v1.Memory.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.memory.v1.MemoryId,
      ai.stigmer.agentic.memory.v1.Memory> getRejectMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.memory.v1.MemoryId, ai.stigmer.agentic.memory.v1.Memory> getRejectMethod;
    if ((getRejectMethod = MemoryCommandControllerGrpc.getRejectMethod) == null) {
      synchronized (MemoryCommandControllerGrpc.class) {
        if ((getRejectMethod = MemoryCommandControllerGrpc.getRejectMethod) == null) {
          MemoryCommandControllerGrpc.getRejectMethod = getRejectMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.memory.v1.MemoryId, ai.stigmer.agentic.memory.v1.Memory>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "reject"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.memory.v1.MemoryId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.memory.v1.Memory.getDefaultInstance()))
              .setSchemaDescriptor(new MemoryCommandControllerMethodDescriptorSupplier("reject"))
              .build();
        }
      }
    }
    return getRejectMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static MemoryCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<MemoryCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<MemoryCommandControllerStub>() {
        @java.lang.Override
        public MemoryCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new MemoryCommandControllerStub(channel, callOptions);
        }
      };
    return MemoryCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static MemoryCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<MemoryCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<MemoryCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public MemoryCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new MemoryCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return MemoryCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static MemoryCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<MemoryCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<MemoryCommandControllerBlockingStub>() {
        @java.lang.Override
        public MemoryCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new MemoryCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return MemoryCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static MemoryCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<MemoryCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<MemoryCommandControllerFutureStub>() {
        @java.lang.Override
        public MemoryCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new MemoryCommandControllerFutureStub(channel, callOptions);
        }
      };
    return MemoryCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * MemoryCommandController handles write operations for memories.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create a memory in the proposed state.
     * The memory starts its consent lifecycle as proposed: it is not
     * recalled into any execution until the person it is about confirms
     * it. The subject and provenance are derived by the server from the
     * calling credential and request context — values supplied on the
     * request are overwritten.
     * </pre>
     */
    default void create(ai.stigmer.agentic.memory.v1.Memory request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.memory.v1.Memory> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update a memory's fact text.
     * Replaces the spec wholesale, but only the content may actually
     * change: the subject and provenance are immutable, and the consent
     * lifecycle in status is never touched by updates — use confirm or
     * reject to decide on a proposal.
     * </pre>
     */
    default void update(ai.stigmer.agentic.memory.v1.Memory request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.memory.v1.Memory> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a memory permanently, in any lifecycle state.
     * Deletion is the retention mechanism: deleting a confirmed memory is
     * how consent is revoked, and the fact stops reaching future
     * executions immediately. Past executions that already recalled it
     * keep their immutable snapshots.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.memory.v1.MemoryId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.memory.v1.Memory> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Confirm a proposed memory, making it recallable.
     * Confirmation is the consent act: from the next eligible execution
     * on, the fact is injected as background context. Confirming an
     * already-confirmed memory succeeds and changes nothing. Confirming a
     * rejected memory is refused — delete it instead and let the agent
     * propose again.
     * </pre>
     */
    default void confirm(ai.stigmer.agentic.memory.v1.MemoryId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.memory.v1.Memory> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getConfirmMethod(), responseObserver);
    }

    /**
     * <pre>
     * Reject a proposed memory, keeping it as an audit record.
     * A rejected memory is never recalled. The record is kept rather than
     * deleted so the decision is auditable; delete it to remove it
     * entirely. Rejecting an already-rejected memory succeeds and changes
     * nothing. Rejecting a confirmed memory is refused — deleting it is
     * how a confirmed fact is revoked.
     * </pre>
     */
    default void reject(ai.stigmer.agentic.memory.v1.MemoryId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.memory.v1.Memory> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRejectMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service MemoryCommandController.
   * <pre>
   * MemoryCommandController handles write operations for memories.
   * </pre>
   */
  public static abstract class MemoryCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return MemoryCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service MemoryCommandController.
   * <pre>
   * MemoryCommandController handles write operations for memories.
   * </pre>
   */
  public static final class MemoryCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<MemoryCommandControllerStub> {
    private MemoryCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected MemoryCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new MemoryCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a memory in the proposed state.
     * The memory starts its consent lifecycle as proposed: it is not
     * recalled into any execution until the person it is about confirms
     * it. The subject and provenance are derived by the server from the
     * calling credential and request context — values supplied on the
     * request are overwritten.
     * </pre>
     */
    public void create(ai.stigmer.agentic.memory.v1.Memory request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.memory.v1.Memory> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update a memory's fact text.
     * Replaces the spec wholesale, but only the content may actually
     * change: the subject and provenance are immutable, and the consent
     * lifecycle in status is never touched by updates — use confirm or
     * reject to decide on a proposal.
     * </pre>
     */
    public void update(ai.stigmer.agentic.memory.v1.Memory request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.memory.v1.Memory> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a memory permanently, in any lifecycle state.
     * Deletion is the retention mechanism: deleting a confirmed memory is
     * how consent is revoked, and the fact stops reaching future
     * executions immediately. Past executions that already recalled it
     * keep their immutable snapshots.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.memory.v1.MemoryId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.memory.v1.Memory> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Confirm a proposed memory, making it recallable.
     * Confirmation is the consent act: from the next eligible execution
     * on, the fact is injected as background context. Confirming an
     * already-confirmed memory succeeds and changes nothing. Confirming a
     * rejected memory is refused — delete it instead and let the agent
     * propose again.
     * </pre>
     */
    public void confirm(ai.stigmer.agentic.memory.v1.MemoryId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.memory.v1.Memory> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getConfirmMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Reject a proposed memory, keeping it as an audit record.
     * A rejected memory is never recalled. The record is kept rather than
     * deleted so the decision is auditable; delete it to remove it
     * entirely. Rejecting an already-rejected memory succeeds and changes
     * nothing. Rejecting a confirmed memory is refused — deleting it is
     * how a confirmed fact is revoked.
     * </pre>
     */
    public void reject(ai.stigmer.agentic.memory.v1.MemoryId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.memory.v1.Memory> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRejectMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service MemoryCommandController.
   * <pre>
   * MemoryCommandController handles write operations for memories.
   * </pre>
   */
  public static final class MemoryCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<MemoryCommandControllerBlockingV2Stub> {
    private MemoryCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected MemoryCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new MemoryCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a memory in the proposed state.
     * The memory starts its consent lifecycle as proposed: it is not
     * recalled into any execution until the person it is about confirms
     * it. The subject and provenance are derived by the server from the
     * calling credential and request context — values supplied on the
     * request are overwritten.
     * </pre>
     */
    public ai.stigmer.agentic.memory.v1.Memory create(ai.stigmer.agentic.memory.v1.Memory request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a memory's fact text.
     * Replaces the spec wholesale, but only the content may actually
     * change: the subject and provenance are immutable, and the consent
     * lifecycle in status is never touched by updates — use confirm or
     * reject to decide on a proposal.
     * </pre>
     */
    public ai.stigmer.agentic.memory.v1.Memory update(ai.stigmer.agentic.memory.v1.Memory request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a memory permanently, in any lifecycle state.
     * Deletion is the retention mechanism: deleting a confirmed memory is
     * how consent is revoked, and the fact stops reaching future
     * executions immediately. Past executions that already recalled it
     * keep their immutable snapshots.
     * </pre>
     */
    public ai.stigmer.agentic.memory.v1.Memory delete(ai.stigmer.agentic.memory.v1.MemoryId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Confirm a proposed memory, making it recallable.
     * Confirmation is the consent act: from the next eligible execution
     * on, the fact is injected as background context. Confirming an
     * already-confirmed memory succeeds and changes nothing. Confirming a
     * rejected memory is refused — delete it instead and let the agent
     * propose again.
     * </pre>
     */
    public ai.stigmer.agentic.memory.v1.Memory confirm(ai.stigmer.agentic.memory.v1.MemoryId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getConfirmMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Reject a proposed memory, keeping it as an audit record.
     * A rejected memory is never recalled. The record is kept rather than
     * deleted so the decision is auditable; delete it to remove it
     * entirely. Rejecting an already-rejected memory succeeds and changes
     * nothing. Rejecting a confirmed memory is refused — deleting it is
     * how a confirmed fact is revoked.
     * </pre>
     */
    public ai.stigmer.agentic.memory.v1.Memory reject(ai.stigmer.agentic.memory.v1.MemoryId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRejectMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service MemoryCommandController.
   * <pre>
   * MemoryCommandController handles write operations for memories.
   * </pre>
   */
  public static final class MemoryCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<MemoryCommandControllerBlockingStub> {
    private MemoryCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected MemoryCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new MemoryCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a memory in the proposed state.
     * The memory starts its consent lifecycle as proposed: it is not
     * recalled into any execution until the person it is about confirms
     * it. The subject and provenance are derived by the server from the
     * calling credential and request context — values supplied on the
     * request are overwritten.
     * </pre>
     */
    public ai.stigmer.agentic.memory.v1.Memory create(ai.stigmer.agentic.memory.v1.Memory request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a memory's fact text.
     * Replaces the spec wholesale, but only the content may actually
     * change: the subject and provenance are immutable, and the consent
     * lifecycle in status is never touched by updates — use confirm or
     * reject to decide on a proposal.
     * </pre>
     */
    public ai.stigmer.agentic.memory.v1.Memory update(ai.stigmer.agentic.memory.v1.Memory request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a memory permanently, in any lifecycle state.
     * Deletion is the retention mechanism: deleting a confirmed memory is
     * how consent is revoked, and the fact stops reaching future
     * executions immediately. Past executions that already recalled it
     * keep their immutable snapshots.
     * </pre>
     */
    public ai.stigmer.agentic.memory.v1.Memory delete(ai.stigmer.agentic.memory.v1.MemoryId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Confirm a proposed memory, making it recallable.
     * Confirmation is the consent act: from the next eligible execution
     * on, the fact is injected as background context. Confirming an
     * already-confirmed memory succeeds and changes nothing. Confirming a
     * rejected memory is refused — delete it instead and let the agent
     * propose again.
     * </pre>
     */
    public ai.stigmer.agentic.memory.v1.Memory confirm(ai.stigmer.agentic.memory.v1.MemoryId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getConfirmMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Reject a proposed memory, keeping it as an audit record.
     * A rejected memory is never recalled. The record is kept rather than
     * deleted so the decision is auditable; delete it to remove it
     * entirely. Rejecting an already-rejected memory succeeds and changes
     * nothing. Rejecting a confirmed memory is refused — deleting it is
     * how a confirmed fact is revoked.
     * </pre>
     */
    public ai.stigmer.agentic.memory.v1.Memory reject(ai.stigmer.agentic.memory.v1.MemoryId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRejectMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service MemoryCommandController.
   * <pre>
   * MemoryCommandController handles write operations for memories.
   * </pre>
   */
  public static final class MemoryCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<MemoryCommandControllerFutureStub> {
    private MemoryCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected MemoryCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new MemoryCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create a memory in the proposed state.
     * The memory starts its consent lifecycle as proposed: it is not
     * recalled into any execution until the person it is about confirms
     * it. The subject and provenance are derived by the server from the
     * calling credential and request context — values supplied on the
     * request are overwritten.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.memory.v1.Memory> create(
        ai.stigmer.agentic.memory.v1.Memory request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update a memory's fact text.
     * Replaces the spec wholesale, but only the content may actually
     * change: the subject and provenance are immutable, and the consent
     * lifecycle in status is never touched by updates — use confirm or
     * reject to decide on a proposal.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.memory.v1.Memory> update(
        ai.stigmer.agentic.memory.v1.Memory request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a memory permanently, in any lifecycle state.
     * Deletion is the retention mechanism: deleting a confirmed memory is
     * how consent is revoked, and the fact stops reaching future
     * executions immediately. Past executions that already recalled it
     * keep their immutable snapshots.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.memory.v1.Memory> delete(
        ai.stigmer.agentic.memory.v1.MemoryId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Confirm a proposed memory, making it recallable.
     * Confirmation is the consent act: from the next eligible execution
     * on, the fact is injected as background context. Confirming an
     * already-confirmed memory succeeds and changes nothing. Confirming a
     * rejected memory is refused — delete it instead and let the agent
     * propose again.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.memory.v1.Memory> confirm(
        ai.stigmer.agentic.memory.v1.MemoryId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getConfirmMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Reject a proposed memory, keeping it as an audit record.
     * A rejected memory is never recalled. The record is kept rather than
     * deleted so the decision is auditable; delete it to remove it
     * entirely. Rejecting an already-rejected memory succeeds and changes
     * nothing. Rejecting a confirmed memory is refused — deleting it is
     * how a confirmed fact is revoked.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.memory.v1.Memory> reject(
        ai.stigmer.agentic.memory.v1.MemoryId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRejectMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;
  private static final int METHODID_UPDATE = 1;
  private static final int METHODID_DELETE = 2;
  private static final int METHODID_CONFIRM = 3;
  private static final int METHODID_REJECT = 4;

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
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.memory.v1.Memory) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.memory.v1.Memory>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.memory.v1.Memory) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.memory.v1.Memory>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.memory.v1.MemoryId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.memory.v1.Memory>) responseObserver);
          break;
        case METHODID_CONFIRM:
          serviceImpl.confirm((ai.stigmer.agentic.memory.v1.MemoryId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.memory.v1.Memory>) responseObserver);
          break;
        case METHODID_REJECT:
          serviceImpl.reject((ai.stigmer.agentic.memory.v1.MemoryId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.memory.v1.Memory>) responseObserver);
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
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.memory.v1.Memory,
              ai.stigmer.agentic.memory.v1.Memory>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.memory.v1.Memory,
              ai.stigmer.agentic.memory.v1.Memory>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.memory.v1.MemoryId,
              ai.stigmer.agentic.memory.v1.Memory>(
                service, METHODID_DELETE)))
        .addMethod(
          getConfirmMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.memory.v1.MemoryId,
              ai.stigmer.agentic.memory.v1.Memory>(
                service, METHODID_CONFIRM)))
        .addMethod(
          getRejectMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.memory.v1.MemoryId,
              ai.stigmer.agentic.memory.v1.Memory>(
                service, METHODID_REJECT)))
        .build();
  }

  private static abstract class MemoryCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    MemoryCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.memory.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("MemoryCommandController");
    }
  }

  private static final class MemoryCommandControllerFileDescriptorSupplier
      extends MemoryCommandControllerBaseDescriptorSupplier {
    MemoryCommandControllerFileDescriptorSupplier() {}
  }

  private static final class MemoryCommandControllerMethodDescriptorSupplier
      extends MemoryCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    MemoryCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (MemoryCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new MemoryCommandControllerFileDescriptorSupplier())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getDeleteMethod())
              .addMethod(getConfirmMethod())
              .addMethod(getRejectMethod())
              .build();
        }
      }
    }
    return result;
  }
}
