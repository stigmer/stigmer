package ai.stigmer.agentic.datastore.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * DatastoreQueryController handles read operations for datastores.
 * &#64;internal
 * These RPCs read the datastore resource (spec + status), not its
 * records. Record reads go through DatastoreRecordQueryController.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class DatastoreQueryControllerGrpc {

  private DatastoreQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.datastore.v1.DatastoreQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.datastore.v1.Datastore> getGetMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "get",
      requestType = ai.stigmer.commons.apiresource.ApiResourceId.class,
      responseType = ai.stigmer.agentic.datastore.v1.Datastore.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.datastore.v1.Datastore> getGetMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.datastore.v1.Datastore> getGetMethod;
    if ((getGetMethod = DatastoreQueryControllerGrpc.getGetMethod) == null) {
      synchronized (DatastoreQueryControllerGrpc.class) {
        if ((getGetMethod = DatastoreQueryControllerGrpc.getGetMethod) == null) {
          DatastoreQueryControllerGrpc.getGetMethod = getGetMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.datastore.v1.Datastore>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "get"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.Datastore.getDefaultInstance()))
              .setSchemaDescriptor(new DatastoreQueryControllerMethodDescriptorSupplier("get"))
              .build();
        }
      }
    }
    return getGetMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.datastore.v1.Datastore> getGetByReferenceMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "getByReference",
      requestType = ai.stigmer.commons.apiresource.ApiResourceReference.class,
      responseType = ai.stigmer.agentic.datastore.v1.Datastore.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference,
      ai.stigmer.agentic.datastore.v1.Datastore> getGetByReferenceMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.datastore.v1.Datastore> getGetByReferenceMethod;
    if ((getGetByReferenceMethod = DatastoreQueryControllerGrpc.getGetByReferenceMethod) == null) {
      synchronized (DatastoreQueryControllerGrpc.class) {
        if ((getGetByReferenceMethod = DatastoreQueryControllerGrpc.getGetByReferenceMethod) == null) {
          DatastoreQueryControllerGrpc.getGetByReferenceMethod = getGetByReferenceMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceReference, ai.stigmer.agentic.datastore.v1.Datastore>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "getByReference"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceReference.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.Datastore.getDefaultInstance()))
              .setSchemaDescriptor(new DatastoreQueryControllerMethodDescriptorSupplier("getByReference"))
              .build();
        }
      }
    }
    return getGetByReferenceMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.ListDatastoresRequest,
      ai.stigmer.agentic.datastore.v1.DatastoreList> getListMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "list",
      requestType = ai.stigmer.agentic.datastore.v1.ListDatastoresRequest.class,
      responseType = ai.stigmer.agentic.datastore.v1.DatastoreList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.ListDatastoresRequest,
      ai.stigmer.agentic.datastore.v1.DatastoreList> getListMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.ListDatastoresRequest, ai.stigmer.agentic.datastore.v1.DatastoreList> getListMethod;
    if ((getListMethod = DatastoreQueryControllerGrpc.getListMethod) == null) {
      synchronized (DatastoreQueryControllerGrpc.class) {
        if ((getListMethod = DatastoreQueryControllerGrpc.getListMethod) == null) {
          DatastoreQueryControllerGrpc.getListMethod = getListMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.datastore.v1.ListDatastoresRequest, ai.stigmer.agentic.datastore.v1.DatastoreList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "list"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.ListDatastoresRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.DatastoreList.getDefaultInstance()))
              .setSchemaDescriptor(new DatastoreQueryControllerMethodDescriptorSupplier("list"))
              .build();
        }
      }
    }
    return getListMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static DatastoreQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<DatastoreQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<DatastoreQueryControllerStub>() {
        @java.lang.Override
        public DatastoreQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new DatastoreQueryControllerStub(channel, callOptions);
        }
      };
    return DatastoreQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static DatastoreQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<DatastoreQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<DatastoreQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public DatastoreQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new DatastoreQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return DatastoreQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static DatastoreQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<DatastoreQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<DatastoreQueryControllerBlockingStub>() {
        @java.lang.Override
        public DatastoreQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new DatastoreQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return DatastoreQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static DatastoreQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<DatastoreQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<DatastoreQueryControllerFutureStub>() {
        @java.lang.Override
        public DatastoreQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new DatastoreQueryControllerFutureStub(channel, callOptions);
        }
      };
    return DatastoreQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * DatastoreQueryController handles read operations for datastores.
   * &#64;internal
   * These RPCs read the datastore resource (spec + status), not its
   * records. Record reads go through DatastoreRecordQueryController.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Get a datastore by ID.
     * &#64;internal
     * Authorization: requires can_view permission on the datastore resource.
     * </pre>
     */
    default void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.Datastore> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetMethod(), responseObserver);
    }

    /**
     * <pre>
     * Get a datastore by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/clinic-records" to the full Datastore resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    default void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.Datastore> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getGetByReferenceMethod(), responseObserver);
    }

    /**
     * <pre>
     * List datastores with optional label filtering.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    default void list(ai.stigmer.agentic.datastore.v1.ListDatastoresRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.DatastoreList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getListMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service DatastoreQueryController.
   * <pre>
   * DatastoreQueryController handles read operations for datastores.
   * &#64;internal
   * These RPCs read the datastore resource (spec + status), not its
   * records. Record reads go through DatastoreRecordQueryController.
   * </pre>
   */
  public static abstract class DatastoreQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return DatastoreQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service DatastoreQueryController.
   * <pre>
   * DatastoreQueryController handles read operations for datastores.
   * &#64;internal
   * These RPCs read the datastore resource (spec + status), not its
   * records. Record reads go through DatastoreRecordQueryController.
   * </pre>
   */
  public static final class DatastoreQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<DatastoreQueryControllerStub> {
    private DatastoreQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected DatastoreQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new DatastoreQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a datastore by ID.
     * &#64;internal
     * Authorization: requires can_view permission on the datastore resource.
     * </pre>
     */
    public void get(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.Datastore> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Get a datastore by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/clinic-records" to the full Datastore resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public void getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.Datastore> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * List datastores with optional label filtering.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public void list(ai.stigmer.agentic.datastore.v1.ListDatastoresRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.DatastoreList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service DatastoreQueryController.
   * <pre>
   * DatastoreQueryController handles read operations for datastores.
   * &#64;internal
   * These RPCs read the datastore resource (spec + status), not its
   * records. Record reads go through DatastoreRecordQueryController.
   * </pre>
   */
  public static final class DatastoreQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<DatastoreQueryControllerBlockingV2Stub> {
    private DatastoreQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected DatastoreQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new DatastoreQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a datastore by ID.
     * &#64;internal
     * Authorization: requires can_view permission on the datastore resource.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.Datastore get(ai.stigmer.commons.apiresource.ApiResourceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a datastore by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/clinic-records" to the full Datastore resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.Datastore getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List datastores with optional label filtering.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.DatastoreList list(ai.stigmer.agentic.datastore.v1.ListDatastoresRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service DatastoreQueryController.
   * <pre>
   * DatastoreQueryController handles read operations for datastores.
   * &#64;internal
   * These RPCs read the datastore resource (spec + status), not its
   * records. Record reads go through DatastoreRecordQueryController.
   * </pre>
   */
  public static final class DatastoreQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<DatastoreQueryControllerBlockingStub> {
    private DatastoreQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected DatastoreQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new DatastoreQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a datastore by ID.
     * &#64;internal
     * Authorization: requires can_view permission on the datastore resource.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.Datastore get(ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Get a datastore by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/clinic-records" to the full Datastore resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.Datastore getByReference(ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getGetByReferenceMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * List datastores with optional label filtering.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.DatastoreList list(ai.stigmer.agentic.datastore.v1.ListDatastoresRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getListMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service DatastoreQueryController.
   * <pre>
   * DatastoreQueryController handles read operations for datastores.
   * &#64;internal
   * These RPCs read the datastore resource (spec + status), not its
   * records. Record reads go through DatastoreRecordQueryController.
   * </pre>
   */
  public static final class DatastoreQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<DatastoreQueryControllerFutureStub> {
    private DatastoreQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected DatastoreQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new DatastoreQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Get a datastore by ID.
     * &#64;internal
     * Authorization: requires can_view permission on the datastore resource.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.datastore.v1.Datastore> get(
        ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Get a datastore by its organization-scoped reference (org/slug).
     * Resolves a human-readable reference like "acme/clinic-records" to the full Datastore resource.
     * &#64;internal
     * Custom authorization in handler — checks both direct resource access
     * and organization-level visibility permissions.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.datastore.v1.Datastore> getByReference(
        ai.stigmer.commons.apiresource.ApiResourceReference request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getGetByReferenceMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * List datastores with optional label filtering.
     * &#64;internal
     * Authorization is handled in-handler via FGA-filtered queries (cloud)
     * or unrestricted store queries (OSS).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.datastore.v1.DatastoreList> list(
        ai.stigmer.agentic.datastore.v1.ListDatastoresRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getListMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_GET = 0;
  private static final int METHODID_GET_BY_REFERENCE = 1;
  private static final int METHODID_LIST = 2;

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
          serviceImpl.get((ai.stigmer.commons.apiresource.ApiResourceId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.Datastore>) responseObserver);
          break;
        case METHODID_GET_BY_REFERENCE:
          serviceImpl.getByReference((ai.stigmer.commons.apiresource.ApiResourceReference) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.Datastore>) responseObserver);
          break;
        case METHODID_LIST:
          serviceImpl.list((ai.stigmer.agentic.datastore.v1.ListDatastoresRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.DatastoreList>) responseObserver);
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
              ai.stigmer.commons.apiresource.ApiResourceId,
              ai.stigmer.agentic.datastore.v1.Datastore>(
                service, METHODID_GET)))
        .addMethod(
          getGetByReferenceMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceReference,
              ai.stigmer.agentic.datastore.v1.Datastore>(
                service, METHODID_GET_BY_REFERENCE)))
        .addMethod(
          getListMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.datastore.v1.ListDatastoresRequest,
              ai.stigmer.agentic.datastore.v1.DatastoreList>(
                service, METHODID_LIST)))
        .build();
  }

  private static abstract class DatastoreQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    DatastoreQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.datastore.v1.QueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("DatastoreQueryController");
    }
  }

  private static final class DatastoreQueryControllerFileDescriptorSupplier
      extends DatastoreQueryControllerBaseDescriptorSupplier {
    DatastoreQueryControllerFileDescriptorSupplier() {}
  }

  private static final class DatastoreQueryControllerMethodDescriptorSupplier
      extends DatastoreQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    DatastoreQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (DatastoreQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new DatastoreQueryControllerFileDescriptorSupplier())
              .addMethod(getGetMethod())
              .addMethod(getGetByReferenceMethod())
              .addMethod(getListMethod())
              .build();
        }
      }
    }
    return result;
  }
}
