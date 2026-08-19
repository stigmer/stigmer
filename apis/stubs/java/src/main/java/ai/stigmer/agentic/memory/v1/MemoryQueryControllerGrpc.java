package ai.stigmer.agentic.memory.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * MemoryQueryController handles read operations for memories.
 * &#64;internal
 * Content visibility is subject-only (DD-004 as ratified): org admins
 * govern the memory_enabled switch but never read members' memories.
 * The one deliberate exception is the recalled_memories snapshot on an
 * execution spec, readable by anyone who can read that execution
 * (DD-006 D6 — snapshot transparency); these RPCs are not that
 * exception. Not search-indexed: memory content stays out of the
 * global search index by design.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class MemoryQueryControllerGrpc {

  private MemoryQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.memory.v1.MemoryQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.memory.v1.MemoryId,
      ai.stigmer.agentic.memory.v1.Memory> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.agentic.memory.v1.MemoryId.class,
      responseType = ai.stigmer.agentic.memory.v1.Memory.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.memory.v1.MemoryId,
      ai.stigmer.agentic.memory.v1.Memory> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.memory.v1.MemoryId, ai.stigmer.agentic.memory.v1.Memory> getGetMethod;
    if ((getGetMethod = MemoryQueryControllerGrpc.getGetMethod) == null) {
      synchronized (MemoryQueryControllerGrpc.class) {
        if ((getGetMethod = MemoryQueryControllerGrpc.getGetMethod) == null) {
          MemoryQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.memory.v1.MemoryId, ai.stigmer.agentic.memory.v1.Memory>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.memory.v1.MemoryId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.memory.v1.Memory.getDefaultInstance()))
              .setSchemaDescriptor(new MemoryQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.memory.v1.ListMemoriesRequest,
      ai.stigmer.agentic.memory.v1.MemoryList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.memory.v1.ListMemoriesRequest.class,
      responseType = ai.stigmer.agentic.memory.v1.MemoryList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.memory.v1.ListMemoriesRequest,
      ai.stigmer.agentic.memory.v1.MemoryList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.memory.v1.ListMemoriesRequest, ai.stigmer.agentic.memory.v1.MemoryList> getListMethod;
    if ((getListMethod = MemoryQueryControllerGrpc.getListMethod) == null) {
      synchronized (MemoryQueryControllerGrpc.class) {
        if ((getListMethod = MemoryQueryControllerGrpc.getListMethod) == null) {
          MemoryQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.memory.v1.ListMemoriesRequest, ai.stigmer.agentic.memory.v1.MemoryList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.memory.v1.ListMemoriesRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.memory.v1.MemoryList.getDefaultInstance()))
              .setSchemaDescriptor(new MemoryQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static MemoryQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<MemoryQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<MemoryQueryControllerStub>() {
        @java.lang.Override
        public MemoryQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new MemoryQueryControllerStub(channel, callOptions);
        }
      };
    return MemoryQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static MemoryQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<MemoryQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<MemoryQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public MemoryQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new MemoryQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return MemoryQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static MemoryQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<MemoryQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<MemoryQueryControllerBlockingStub>() {
        @java.lang.Override
        public MemoryQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new MemoryQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return MemoryQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static MemoryQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<MemoryQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<MemoryQueryControllerFutureStub>() {
        @java.lang.Override
        public MemoryQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new MemoryQueryControllerFutureStub(channel, callOptions);
        }
      };
    return MemoryQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * MemoryQueryController handles read operations for memories.
   * &#64;internal
   * Content visibility is subject-only (DD-004 as ratified): org admins
   * govern the memory_enabled switch but never read members' memories.
   * The one deliberate exception is the recalled_memories snapshot on an
   * execution spec, readable by anyone who can read that execution
   * (DD-006 D6 — snapshot transparency); these RPCs are not that
   * exception. Not search-indexed: memory content stays out of the
   * global search index by design.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a single memory by ID.
     * </pre>
     */
    default void get(ai.stigmer.agentic.memory.v1.MemoryId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.memory.v1.Memory> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * List the caller's memories in an organization.
     * Returns only memories the caller can view — for memories that is
     * always exactly the ones about the caller.
     * &#64;internal
     * Authorization in-handler via FGA-filtered queries (cloud: ListObjects
     * over can_view, which resolves to the subject relation) or
     * unrestricted store queries (OSS single-user). The console memory
     * page lists through this RPC and groups pending proposals first
     * (DD-005 D4) — ordering is a presentation concern, deliberately not
     * an RPC parameter at dozens-of-records scale.
     * </pre>
     */
    default void list(ai.stigmer.agentic.memory.v1.ListMemoriesRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.memory.v1.MemoryList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service MemoryQueryController.
   * <pre>
   * MemoryQueryController handles read operations for memories.
   * &#64;internal
   * Content visibility is subject-only (DD-004 as ratified): org admins
   * govern the memory_enabled switch but never read members' memories.
   * The one deliberate exception is the recalled_memories snapshot on an
   * execution spec, readable by anyone who can read that execution
   * (DD-006 D6 — snapshot transparency); these RPCs are not that
   * exception. Not search-indexed: memory content stays out of the
   * global search index by design.
   * </pre>
   */
  public static abstract class MemoryQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return MemoryQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service MemoryQueryController.
   * <pre>
   * MemoryQueryController handles read operations for memories.
   * &#64;internal
   * Content visibility is subject-only (DD-004 as ratified): org admins
   * govern the memory_enabled switch but never read members' memories.
   * The one deliberate exception is the recalled_memories snapshot on an
   * execution spec, readable by anyone who can read that execution
   * (DD-006 D6 — snapshot transparency); these RPCs are not that
   * exception. Not search-indexed: memory content stays out of the
   * global search index by design.
   * </pre>
   */
  public static final class MemoryQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<MemoryQueryControllerStub> {
    private MemoryQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected MemoryQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new MemoryQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single memory by ID.
     * </pre>
     */
    public void get(ai.stigmer.agentic.memory.v1.MemoryId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.memory.v1.Memory> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List the caller's memories in an organization.
     * Returns only memories the caller can view — for memories that is
     * always exactly the ones about the caller.
     * &#64;internal
     * Authorization in-handler via FGA-filtered queries (cloud: ListObjects
     * over can_view, which resolves to the subject relation) or
     * unrestricted store queries (OSS single-user). The console memory
     * page lists through this RPC and groups pending proposals first
     * (DD-005 D4) — ordering is a presentation concern, deliberately not
     * an RPC parameter at dozens-of-records scale.
     * </pre>
     */
    public void list(ai.stigmer.agentic.memory.v1.ListMemoriesRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.memory.v1.MemoryList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service MemoryQueryController.
   * <pre>
   * MemoryQueryController handles read operations for memories.
   * &#64;internal
   * Content visibility is subject-only (DD-004 as ratified): org admins
   * govern the memory_enabled switch but never read members' memories.
   * The one deliberate exception is the recalled_memories snapshot on an
   * execution spec, readable by anyone who can read that execution
   * (DD-006 D6 — snapshot transparency); these RPCs are not that
   * exception. Not search-indexed: memory content stays out of the
   * global search index by design.
   * </pre>
   */
  public static final class MemoryQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<MemoryQueryControllerBlockingV2Stub> {
    private MemoryQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected MemoryQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new MemoryQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single memory by ID.
     * </pre>
     */
    public ai.stigmer.agentic.memory.v1.Memory get(ai.stigmer.agentic.memory.v1.MemoryId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the caller's memories in an organization.
     * Returns only memories the caller can view — for memories that is
     * always exactly the ones about the caller.
     * &#64;internal
     * Authorization in-handler via FGA-filtered queries (cloud: ListObjects
     * over can_view, which resolves to the subject relation) or
     * unrestricted store queries (OSS single-user). The console memory
     * page lists through this RPC and groups pending proposals first
     * (DD-005 D4) — ordering is a presentation concern, deliberately not
     * an RPC parameter at dozens-of-records scale.
     * </pre>
     */
    public ai.stigmer.agentic.memory.v1.MemoryList list(ai.stigmer.agentic.memory.v1.ListMemoriesRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service MemoryQueryController.
   * <pre>
   * MemoryQueryController handles read operations for memories.
   * &#64;internal
   * Content visibility is subject-only (DD-004 as ratified): org admins
   * govern the memory_enabled switch but never read members' memories.
   * The one deliberate exception is the recalled_memories snapshot on an
   * execution spec, readable by anyone who can read that execution
   * (DD-006 D6 — snapshot transparency); these RPCs are not that
   * exception. Not search-indexed: memory content stays out of the
   * global search index by design.
   * </pre>
   */
  public static final class MemoryQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<MemoryQueryControllerBlockingStub> {
    private MemoryQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected MemoryQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new MemoryQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single memory by ID.
     * </pre>
     */
    public ai.stigmer.agentic.memory.v1.Memory get(ai.stigmer.agentic.memory.v1.MemoryId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List the caller's memories in an organization.
     * Returns only memories the caller can view — for memories that is
     * always exactly the ones about the caller.
     * &#64;internal
     * Authorization in-handler via FGA-filtered queries (cloud: ListObjects
     * over can_view, which resolves to the subject relation) or
     * unrestricted store queries (OSS single-user). The console memory
     * page lists through this RPC and groups pending proposals first
     * (DD-005 D4) — ordering is a presentation concern, deliberately not
     * an RPC parameter at dozens-of-records scale.
     * </pre>
     */
    public ai.stigmer.agentic.memory.v1.MemoryList list(ai.stigmer.agentic.memory.v1.ListMemoriesRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service MemoryQueryController.
   * <pre>
   * MemoryQueryController handles read operations for memories.
   * &#64;internal
   * Content visibility is subject-only (DD-004 as ratified): org admins
   * govern the memory_enabled switch but never read members' memories.
   * The one deliberate exception is the recalled_memories snapshot on an
   * execution spec, readable by anyone who can read that execution
   * (DD-006 D6 — snapshot transparency); these RPCs are not that
   * exception. Not search-indexed: memory content stays out of the
   * global search index by design.
   * </pre>
   */
  public static final class MemoryQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<MemoryQueryControllerFutureStub> {
    private MemoryQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected MemoryQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new MemoryQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a single memory by ID.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.memory.v1.Memory> get(
        ai.stigmer.agentic.memory.v1.MemoryId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List the caller's memories in an organization.
     * Returns only memories the caller can view — for memories that is
     * always exactly the ones about the caller.
     * &#64;internal
     * Authorization in-handler via FGA-filtered queries (cloud: ListObjects
     * over can_view, which resolves to the subject relation) or
     * unrestricted store queries (OSS single-user). The console memory
     * page lists through this RPC and groups pending proposals first
     * (DD-005 D4) — ordering is a presentation concern, deliberately not
     * an RPC parameter at dozens-of-records scale.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.memory.v1.MemoryList> list(
        ai.stigmer.agentic.memory.v1.ListMemoriesRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_LIST = 1;

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
        case METHODID_GET:
          serviceImpl.get((ai.stigmer.agentic.memory.v1.MemoryId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.memory.v1.Memory>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.memory.v1.ListMemoriesRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.memory.v1.MemoryList>) responseObserver);
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
          getGetMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.memory.v1.MemoryId,
              ai.stigmer.agentic.memory.v1.Memory>(
                service, METHODID_GET)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.memory.v1.ListMemoriesRequest,
              ai.stigmer.agentic.memory.v1.MemoryList>(
                service, METHODID_LIST)))
        .build();
  }

  private static abstract class MemoryQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    MemoryQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.memory.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("MemoryQueryController");
    }
  }

  private static final class MemoryQueryControllerFileDescriptorSupplier
      extends MemoryQueryControllerBaseDescriptorSupplier {
    MemoryQueryControllerFileDescriptorSupplier() {}
  }

  private static final class MemoryQueryControllerMethodDescriptorSupplier
      extends MemoryQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    MemoryQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (MemoryQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new MemoryQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getListMethod())
              .build();
        }
      }
    }
    return result;
  }
}
