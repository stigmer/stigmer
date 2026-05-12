package ai.stigmer.agentic.workflow.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * TaskKindRegistryQueryController provides read access to the task kind registry.
 * This service exposes workflow task metadata for SDK/CLI consumers:
 * - UI form generation from field descriptors
 * - YAML editor autocomplete from JSON Schemas
 * - Task palette rendering from categories and icons
 * - Client-side pre-validation from config schemas
 * The registry is a static catalog derived from proto definitions at build time.
 * It does not require authentication — task metadata is public knowledge about
 * the platform's capabilities, not user-specific data.
 * &#64;since T04 (Task Schema Registry)
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class TaskKindRegistryQueryControllerGrpc {

  private TaskKindRegistryQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.workflow.v1.TaskKindRegistryQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryRequest,
      ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryResponse> getGetTaskKindRegistryMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getTaskKindRegistry",
      requestType = ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryRequest.class,
      responseType = ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryResponse.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryRequest,
      ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryResponse> getGetTaskKindRegistryMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryRequest, ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryResponse> getGetTaskKindRegistryMethod;
    if ((getGetTaskKindRegistryMethod = TaskKindRegistryQueryControllerGrpc.getGetTaskKindRegistryMethod) == null) {
      synchronized (TaskKindRegistryQueryControllerGrpc.class) {
        if ((getGetTaskKindRegistryMethod = TaskKindRegistryQueryControllerGrpc.getGetTaskKindRegistryMethod) == null) {
          TaskKindRegistryQueryControllerGrpc.getGetTaskKindRegistryMethod = getGetTaskKindRegistryMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryRequest, ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryResponse>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getTaskKindRegistry"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryResponse.getDefaultInstance()))
              .setSchemaDescriptor(new TaskKindRegistryQueryControllerMethodDescriptorSupplier("getTaskKindRegistry"))
              .build();
        }
      }
    }
    return getGetTaskKindRegistryMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static TaskKindRegistryQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<TaskKindRegistryQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<TaskKindRegistryQueryControllerStub>() {
        @java.lang.Override
        public TaskKindRegistryQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new TaskKindRegistryQueryControllerStub(channel, callOptions);
        }
      };
    return TaskKindRegistryQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static TaskKindRegistryQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<TaskKindRegistryQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<TaskKindRegistryQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public TaskKindRegistryQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new TaskKindRegistryQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return TaskKindRegistryQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static TaskKindRegistryQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<TaskKindRegistryQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<TaskKindRegistryQueryControllerBlockingStub>() {
        @java.lang.Override
        public TaskKindRegistryQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new TaskKindRegistryQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return TaskKindRegistryQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static TaskKindRegistryQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<TaskKindRegistryQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<TaskKindRegistryQueryControllerFutureStub>() {
        @java.lang.Override
        public TaskKindRegistryQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new TaskKindRegistryQueryControllerFutureStub(channel, callOptions);
        }
      };
    return TaskKindRegistryQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * TaskKindRegistryQueryController provides read access to the task kind registry.
   * This service exposes workflow task metadata for SDK/CLI consumers:
   * - UI form generation from field descriptors
   * - YAML editor autocomplete from JSON Schemas
   * - Task palette rendering from categories and icons
   * - Client-side pre-validation from config schemas
   * The registry is a static catalog derived from proto definitions at build time.
   * It does not require authentication — task metadata is public knowledge about
   * the platform's capabilities, not user-specific data.
   * &#64;since T04 (Task Schema Registry)
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Retrieve the complete task kind registry.
     * Returns descriptors for all 19 workflow task kinds with full metadata:
     * field schemas, JSON Schemas, categories, icons, examples, and output shapes.
     * Caching: responses are immutable within a platform version. Clients should
     * cache aggressively (recommended: 1 hour TTL with stale-while-revalidate).
     * </pre>
     */
    default void getTaskKindRegistry(ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryResponse> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetTaskKindRegistryMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service TaskKindRegistryQueryController.
   * <pre>
   * TaskKindRegistryQueryController provides read access to the task kind registry.
   * This service exposes workflow task metadata for SDK/CLI consumers:
   * - UI form generation from field descriptors
   * - YAML editor autocomplete from JSON Schemas
   * - Task palette rendering from categories and icons
   * - Client-side pre-validation from config schemas
   * The registry is a static catalog derived from proto definitions at build time.
   * It does not require authentication — task metadata is public knowledge about
   * the platform's capabilities, not user-specific data.
   * &#64;since T04 (Task Schema Registry)
   * </pre>
   */
  public static abstract class TaskKindRegistryQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return TaskKindRegistryQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service TaskKindRegistryQueryController.
   * <pre>
   * TaskKindRegistryQueryController provides read access to the task kind registry.
   * This service exposes workflow task metadata for SDK/CLI consumers:
   * - UI form generation from field descriptors
   * - YAML editor autocomplete from JSON Schemas
   * - Task palette rendering from categories and icons
   * - Client-side pre-validation from config schemas
   * The registry is a static catalog derived from proto definitions at build time.
   * It does not require authentication — task metadata is public knowledge about
   * the platform's capabilities, not user-specific data.
   * &#64;since T04 (Task Schema Registry)
   * </pre>
   */
  public static final class TaskKindRegistryQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<TaskKindRegistryQueryControllerStub> {
    private TaskKindRegistryQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected TaskKindRegistryQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new TaskKindRegistryQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Retrieve the complete task kind registry.
     * Returns descriptors for all 19 workflow task kinds with full metadata:
     * field schemas, JSON Schemas, categories, icons, examples, and output shapes.
     * Caching: responses are immutable within a platform version. Clients should
     * cache aggressively (recommended: 1 hour TTL with stale-while-revalidate).
     * </pre>
     */
    public void getTaskKindRegistry(ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryResponse> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetTaskKindRegistryMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service TaskKindRegistryQueryController.
   * <pre>
   * TaskKindRegistryQueryController provides read access to the task kind registry.
   * This service exposes workflow task metadata for SDK/CLI consumers:
   * - UI form generation from field descriptors
   * - YAML editor autocomplete from JSON Schemas
   * - Task palette rendering from categories and icons
   * - Client-side pre-validation from config schemas
   * The registry is a static catalog derived from proto definitions at build time.
   * It does not require authentication — task metadata is public knowledge about
   * the platform's capabilities, not user-specific data.
   * &#64;since T04 (Task Schema Registry)
   * </pre>
   */
  public static final class TaskKindRegistryQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<TaskKindRegistryQueryControllerBlockingV2Stub> {
    private TaskKindRegistryQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected TaskKindRegistryQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new TaskKindRegistryQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Retrieve the complete task kind registry.
     * Returns descriptors for all 19 workflow task kinds with full metadata:
     * field schemas, JSON Schemas, categories, icons, examples, and output shapes.
     * Caching: responses are immutable within a platform version. Clients should
     * cache aggressively (recommended: 1 hour TTL with stale-while-revalidate).
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryResponse getTaskKindRegistry(ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetTaskKindRegistryMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service TaskKindRegistryQueryController.
   * <pre>
   * TaskKindRegistryQueryController provides read access to the task kind registry.
   * This service exposes workflow task metadata for SDK/CLI consumers:
   * - UI form generation from field descriptors
   * - YAML editor autocomplete from JSON Schemas
   * - Task palette rendering from categories and icons
   * - Client-side pre-validation from config schemas
   * The registry is a static catalog derived from proto definitions at build time.
   * It does not require authentication — task metadata is public knowledge about
   * the platform's capabilities, not user-specific data.
   * &#64;since T04 (Task Schema Registry)
   * </pre>
   */
  public static final class TaskKindRegistryQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<TaskKindRegistryQueryControllerBlockingStub> {
    private TaskKindRegistryQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected TaskKindRegistryQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new TaskKindRegistryQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Retrieve the complete task kind registry.
     * Returns descriptors for all 19 workflow task kinds with full metadata:
     * field schemas, JSON Schemas, categories, icons, examples, and output shapes.
     * Caching: responses are immutable within a platform version. Clients should
     * cache aggressively (recommended: 1 hour TTL with stale-while-revalidate).
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryResponse getTaskKindRegistry(ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetTaskKindRegistryMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service TaskKindRegistryQueryController.
   * <pre>
   * TaskKindRegistryQueryController provides read access to the task kind registry.
   * This service exposes workflow task metadata for SDK/CLI consumers:
   * - UI form generation from field descriptors
   * - YAML editor autocomplete from JSON Schemas
   * - Task palette rendering from categories and icons
   * - Client-side pre-validation from config schemas
   * The registry is a static catalog derived from proto definitions at build time.
   * It does not require authentication — task metadata is public knowledge about
   * the platform's capabilities, not user-specific data.
   * &#64;since T04 (Task Schema Registry)
   * </pre>
   */
  public static final class TaskKindRegistryQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<TaskKindRegistryQueryControllerFutureStub> {
    private TaskKindRegistryQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected TaskKindRegistryQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new TaskKindRegistryQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Retrieve the complete task kind registry.
     * Returns descriptors for all 19 workflow task kinds with full metadata:
     * field schemas, JSON Schemas, categories, icons, examples, and output shapes.
     * Caching: responses are immutable within a platform version. Clients should
     * cache aggressively (recommended: 1 hour TTL with stale-while-revalidate).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryResponse> getTaskKindRegistry(
        ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetTaskKindRegistryMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET_TASK_KIND_REGISTRY = 0;

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
        case METHODID_GET_TASK_KIND_REGISTRY:
          serviceImpl.getTaskKindRegistry((ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryResponse>) responseObserver);
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
          getGetTaskKindRegistryMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryRequest,
              ai.stigmer.agentic.workflow.v1.GetTaskKindRegistryResponse>(
                service, METHODID_GET_TASK_KIND_REGISTRY)))
        .build();
  }

  private static abstract class TaskKindRegistryQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    TaskKindRegistryQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.workflow.v1.TaskKindRegistryQueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("TaskKindRegistryQueryController");
    }
  }

  private static final class TaskKindRegistryQueryControllerFileDescriptorSupplier
      extends TaskKindRegistryQueryControllerBaseDescriptorSupplier {
    TaskKindRegistryQueryControllerFileDescriptorSupplier() {}
  }

  private static final class TaskKindRegistryQueryControllerMethodDescriptorSupplier
      extends TaskKindRegistryQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    TaskKindRegistryQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (TaskKindRegistryQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new TaskKindRegistryQueryControllerFileDescriptorSupplier())
              .addMethod(getGetTaskKindRegistryMethod())
              .build();
        }
      }
    }
    return result;
  }
}
