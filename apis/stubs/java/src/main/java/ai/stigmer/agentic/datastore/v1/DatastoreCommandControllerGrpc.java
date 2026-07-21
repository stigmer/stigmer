package ai.stigmer.agentic.datastore.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * DatastoreCommandController handles write operations for datastores.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class DatastoreCommandControllerGrpc {

  private DatastoreCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.datastore.v1.DatastoreCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.Datastore,
      ai.stigmer.agentic.datastore.v1.Datastore> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.agentic.datastore.v1.Datastore.class,
      responseType = ai.stigmer.agentic.datastore.v1.Datastore.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.Datastore,
      ai.stigmer.agentic.datastore.v1.Datastore> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.Datastore, ai.stigmer.agentic.datastore.v1.Datastore> getApplyMethod;
    if ((getApplyMethod = DatastoreCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (DatastoreCommandControllerGrpc.class) {
        if ((getApplyMethod = DatastoreCommandControllerGrpc.getApplyMethod) == null) {
          DatastoreCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.datastore.v1.Datastore, ai.stigmer.agentic.datastore.v1.Datastore>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.Datastore.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.Datastore.getDefaultInstance()))
              .setSchemaDescriptor(new DatastoreCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.Datastore,
      ai.stigmer.agentic.datastore.v1.Datastore> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.datastore.v1.Datastore.class,
      responseType = ai.stigmer.agentic.datastore.v1.Datastore.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.Datastore,
      ai.stigmer.agentic.datastore.v1.Datastore> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.Datastore, ai.stigmer.agentic.datastore.v1.Datastore> getCreateMethod;
    if ((getCreateMethod = DatastoreCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (DatastoreCommandControllerGrpc.class) {
        if ((getCreateMethod = DatastoreCommandControllerGrpc.getCreateMethod) == null) {
          DatastoreCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.datastore.v1.Datastore, ai.stigmer.agentic.datastore.v1.Datastore>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.Datastore.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.Datastore.getDefaultInstance()))
              .setSchemaDescriptor(new DatastoreCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.Datastore,
      ai.stigmer.agentic.datastore.v1.Datastore> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.datastore.v1.Datastore.class,
      responseType = ai.stigmer.agentic.datastore.v1.Datastore.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.Datastore,
      ai.stigmer.agentic.datastore.v1.Datastore> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.Datastore, ai.stigmer.agentic.datastore.v1.Datastore> getUpdateMethod;
    if ((getUpdateMethod = DatastoreCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (DatastoreCommandControllerGrpc.class) {
        if ((getUpdateMethod = DatastoreCommandControllerGrpc.getUpdateMethod) == null) {
          DatastoreCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.datastore.v1.Datastore, ai.stigmer.agentic.datastore.v1.Datastore>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.Datastore.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.Datastore.getDefaultInstance()))
              .setSchemaDescriptor(new DatastoreCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.datastore.v1.Datastore> getUpdateVisibilityMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateVisibility",
      requestType = ai.stigmer.commons.apiresource.UpdateVisibilityInput.class,
      responseType = ai.stigmer.agentic.datastore.v1.Datastore.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.datastore.v1.Datastore> getUpdateVisibilityMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.datastore.v1.Datastore> getUpdateVisibilityMethod;
    if ((getUpdateVisibilityMethod = DatastoreCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
      synchronized (DatastoreCommandControllerGrpc.class) {
        if ((getUpdateVisibilityMethod = DatastoreCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
          DatastoreCommandControllerGrpc.getUpdateVisibilityMethod = getUpdateVisibilityMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.datastore.v1.Datastore>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateVisibility"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.UpdateVisibilityInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.Datastore.getDefaultInstance()))
              .setSchemaDescriptor(new DatastoreCommandControllerMethodDescriptorSupplier("updateVisibility"))
              .build();
        }
      }
    }
    return getUpdateVisibilityMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.agentic.datastore.v1.Datastore> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.commons.apiresource.ApiResourceDeleteInput.class,
      responseType = ai.stigmer.agentic.datastore.v1.Datastore.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
      ai.stigmer.agentic.datastore.v1.Datastore> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.agentic.datastore.v1.Datastore> getDeleteMethod;
    if ((getDeleteMethod = DatastoreCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (DatastoreCommandControllerGrpc.class) {
        if ((getDeleteMethod = DatastoreCommandControllerGrpc.getDeleteMethod) == null) {
          DatastoreCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceDeleteInput, ai.stigmer.agentic.datastore.v1.Datastore>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceDeleteInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.Datastore.getDefaultInstance()))
              .setSchemaDescriptor(new DatastoreCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static DatastoreCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<DatastoreCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<DatastoreCommandControllerStub>() {
        @java.lang.Override
        public DatastoreCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new DatastoreCommandControllerStub(channel, callOptions);
        }
      };
    return DatastoreCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static DatastoreCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<DatastoreCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<DatastoreCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public DatastoreCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new DatastoreCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return DatastoreCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static DatastoreCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<DatastoreCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<DatastoreCommandControllerBlockingStub>() {
        @java.lang.Override
        public DatastoreCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new DatastoreCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return DatastoreCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static DatastoreCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<DatastoreCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<DatastoreCommandControllerFutureStub>() {
        @java.lang.Override
        public DatastoreCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new DatastoreCommandControllerFutureStub(channel, callOptions);
        }
      };
    return DatastoreCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * DatastoreCommandController handles write operations for datastores.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update a datastore.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the datastore is going to be created or updated, which is
     * resolved as part of the request execution. Schema sync runs as a
     * synchronous, gating step after persist (additive-plus change
     * matrix); removing a non-empty collection requires the
     * datastore.stigmer.ai/acknowledge-collection-removal annotation
     * naming it, otherwise the request fails with FAILED_PRECONDITION.
     * </pre>
     */
    default void apply(ai.stigmer.agentic.datastore.v1.Datastore request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.Datastore> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a datastore.
     * &#64;internal
     * Authorization: caller must have can_create_datastore permission in
     * the organization. Max datastores per org is enforced as a domain
     * validation constant in this pipeline.
     * </pre>
     */
    default void create(ai.stigmer.agentic.datastore.v1.Datastore request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.Datastore> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing datastore.
     * &#64;internal
     * Authorization: requires can_edit permission on the datastore
     * resource. Updates are full spec replaces; the gating schema-sync
     * step diffs against the loaded existing spec and applies the
     * additive-plus change matrix (DD-004): no transition silently
     * destroys or nulls record data.
     * </pre>
     */
    default void update(ai.stigmer.agentic.datastore.v1.Datastore request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.Datastore> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an existing datastore.
     * Only modifies metadata.visibility. Datastores support two levels:
     * private (the default) and org. Setting org shares the datastore
     * with the owning organization for human administration; it does not
     * change record-layer access, which is governed solely by the
     * datastore's authorization block and agent datastore_usages.
     * &#64;internal
     * Authorization: requires can_edit permission on the datastore
     * resource. public/platform levels are rejected via the kind's
     * VisibilityConfig (supports_org only) — business records must never
     * be resolvable across the org boundary.
     * </pre>
     */
    default void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.Datastore> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateVisibilityMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a datastore and every record it holds.
     * Deleting a non-empty datastore requires force: without it the
     * request fails with FAILED_PRECONDITION reporting how many records
     * across how many collections would be destroyed. A datastore
     * referenced by any agent's datastore_usages cannot be deleted until
     * the references are removed.
     * &#64;internal
     * Authorization: requires can_edit permission on the datastore
     * resource. The two guards (record-count acknowledgment via force;
     * agent-reference block, never forceable) run in the delete pipeline
     * of both editions. Record tools never delete structures — this RPC
     * is the only path that destroys collections.
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.Datastore> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service DatastoreCommandController.
   * <pre>
   * DatastoreCommandController handles write operations for datastores.
   * </pre>
   */
  public static abstract class DatastoreCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return DatastoreCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service DatastoreCommandController.
   * <pre>
   * DatastoreCommandController handles write operations for datastores.
   * </pre>
   */
  public static final class DatastoreCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<DatastoreCommandControllerStub> {
    private DatastoreCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected DatastoreCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new DatastoreCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a datastore.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the datastore is going to be created or updated, which is
     * resolved as part of the request execution. Schema sync runs as a
     * synchronous, gating step after persist (additive-plus change
     * matrix); removing a non-empty collection requires the
     * datastore.stigmer.ai/acknowledge-collection-removal annotation
     * naming it, otherwise the request fails with FAILED_PRECONDITION.
     * </pre>
     */
    public void apply(ai.stigmer.agentic.datastore.v1.Datastore request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.Datastore> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a datastore.
     * &#64;internal
     * Authorization: caller must have can_create_datastore permission in
     * the organization. Max datastores per org is enforced as a domain
     * validation constant in this pipeline.
     * </pre>
     */
    public void create(ai.stigmer.agentic.datastore.v1.Datastore request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.Datastore> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing datastore.
     * &#64;internal
     * Authorization: requires can_edit permission on the datastore
     * resource. Updates are full spec replaces; the gating schema-sync
     * step diffs against the loaded existing spec and applies the
     * additive-plus change matrix (DD-004): no transition silently
     * destroys or nulls record data.
     * </pre>
     */
    public void update(ai.stigmer.agentic.datastore.v1.Datastore request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.Datastore> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an existing datastore.
     * Only modifies metadata.visibility. Datastores support two levels:
     * private (the default) and org. Setting org shares the datastore
     * with the owning organization for human administration; it does not
     * change record-layer access, which is governed solely by the
     * datastore's authorization block and agent datastore_usages.
     * &#64;internal
     * Authorization: requires can_edit permission on the datastore
     * resource. public/platform levels are rejected via the kind's
     * VisibilityConfig (supports_org only) — business records must never
     * be resolvable across the org boundary.
     * </pre>
     */
    public void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.Datastore> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a datastore and every record it holds.
     * Deleting a non-empty datastore requires force: without it the
     * request fails with FAILED_PRECONDITION reporting how many records
     * across how many collections would be destroyed. A datastore
     * referenced by any agent's datastore_usages cannot be deleted until
     * the references are removed.
     * &#64;internal
     * Authorization: requires can_edit permission on the datastore
     * resource. The two guards (record-count acknowledgment via force;
     * agent-reference block, never forceable) run in the delete pipeline
     * of both editions. Record tools never delete structures — this RPC
     * is the only path that destroys collections.
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.Datastore> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service DatastoreCommandController.
   * <pre>
   * DatastoreCommandController handles write operations for datastores.
   * </pre>
   */
  public static final class DatastoreCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<DatastoreCommandControllerBlockingV2Stub> {
    private DatastoreCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected DatastoreCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new DatastoreCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a datastore.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the datastore is going to be created or updated, which is
     * resolved as part of the request execution. Schema sync runs as a
     * synchronous, gating step after persist (additive-plus change
     * matrix); removing a non-empty collection requires the
     * datastore.stigmer.ai/acknowledge-collection-removal annotation
     * naming it, otherwise the request fails with FAILED_PRECONDITION.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.Datastore apply(ai.stigmer.agentic.datastore.v1.Datastore request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a datastore.
     * &#64;internal
     * Authorization: caller must have can_create_datastore permission in
     * the organization. Max datastores per org is enforced as a domain
     * validation constant in this pipeline.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.Datastore create(ai.stigmer.agentic.datastore.v1.Datastore request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing datastore.
     * &#64;internal
     * Authorization: requires can_edit permission on the datastore
     * resource. Updates are full spec replaces; the gating schema-sync
     * step diffs against the loaded existing spec and applies the
     * additive-plus change matrix (DD-004): no transition silently
     * destroys or nulls record data.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.Datastore update(ai.stigmer.agentic.datastore.v1.Datastore request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing datastore.
     * Only modifies metadata.visibility. Datastores support two levels:
     * private (the default) and org. Setting org shares the datastore
     * with the owning organization for human administration; it does not
     * change record-layer access, which is governed solely by the
     * datastore's authorization block and agent datastore_usages.
     * &#64;internal
     * Authorization: requires can_edit permission on the datastore
     * resource. public/platform levels are rejected via the kind's
     * VisibilityConfig (supports_org only) — business records must never
     * be resolvable across the org boundary.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.Datastore updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a datastore and every record it holds.
     * Deleting a non-empty datastore requires force: without it the
     * request fails with FAILED_PRECONDITION reporting how many records
     * across how many collections would be destroyed. A datastore
     * referenced by any agent's datastore_usages cannot be deleted until
     * the references are removed.
     * &#64;internal
     * Authorization: requires can_edit permission on the datastore
     * resource. The two guards (record-count acknowledgment via force;
     * agent-reference block, never forceable) run in the delete pipeline
     * of both editions. Record tools never delete structures — this RPC
     * is the only path that destroys collections.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.Datastore delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service DatastoreCommandController.
   * <pre>
   * DatastoreCommandController handles write operations for datastores.
   * </pre>
   */
  public static final class DatastoreCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<DatastoreCommandControllerBlockingStub> {
    private DatastoreCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected DatastoreCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new DatastoreCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a datastore.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the datastore is going to be created or updated, which is
     * resolved as part of the request execution. Schema sync runs as a
     * synchronous, gating step after persist (additive-plus change
     * matrix); removing a non-empty collection requires the
     * datastore.stigmer.ai/acknowledge-collection-removal annotation
     * naming it, otherwise the request fails with FAILED_PRECONDITION.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.Datastore apply(ai.stigmer.agentic.datastore.v1.Datastore request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a datastore.
     * &#64;internal
     * Authorization: caller must have can_create_datastore permission in
     * the organization. Max datastores per org is enforced as a domain
     * validation constant in this pipeline.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.Datastore create(ai.stigmer.agentic.datastore.v1.Datastore request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing datastore.
     * &#64;internal
     * Authorization: requires can_edit permission on the datastore
     * resource. Updates are full spec replaces; the gating schema-sync
     * step diffs against the loaded existing spec and applies the
     * additive-plus change matrix (DD-004): no transition silently
     * destroys or nulls record data.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.Datastore update(ai.stigmer.agentic.datastore.v1.Datastore request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing datastore.
     * Only modifies metadata.visibility. Datastores support two levels:
     * private (the default) and org. Setting org shares the datastore
     * with the owning organization for human administration; it does not
     * change record-layer access, which is governed solely by the
     * datastore's authorization block and agent datastore_usages.
     * &#64;internal
     * Authorization: requires can_edit permission on the datastore
     * resource. public/platform levels are rejected via the kind's
     * VisibilityConfig (supports_org only) — business records must never
     * be resolvable across the org boundary.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.Datastore updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a datastore and every record it holds.
     * Deleting a non-empty datastore requires force: without it the
     * request fails with FAILED_PRECONDITION reporting how many records
     * across how many collections would be destroyed. A datastore
     * referenced by any agent's datastore_usages cannot be deleted until
     * the references are removed.
     * &#64;internal
     * Authorization: requires can_edit permission on the datastore
     * resource. The two guards (record-count acknowledgment via force;
     * agent-reference block, never forceable) run in the delete pipeline
     * of both editions. Record tools never delete structures — this RPC
     * is the only path that destroys collections.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.Datastore delete(ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service DatastoreCommandController.
   * <pre>
   * DatastoreCommandController handles write operations for datastores.
   * </pre>
   */
  public static final class DatastoreCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<DatastoreCommandControllerFutureStub> {
    private DatastoreCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected DatastoreCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new DatastoreCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a datastore.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the datastore is going to be created or updated, which is
     * resolved as part of the request execution. Schema sync runs as a
     * synchronous, gating step after persist (additive-plus change
     * matrix); removing a non-empty collection requires the
     * datastore.stigmer.ai/acknowledge-collection-removal annotation
     * naming it, otherwise the request fails with FAILED_PRECONDITION.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.datastore.v1.Datastore> apply(
        ai.stigmer.agentic.datastore.v1.Datastore request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a datastore.
     * &#64;internal
     * Authorization: caller must have can_create_datastore permission in
     * the organization. Max datastores per org is enforced as a domain
     * validation constant in this pipeline.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.datastore.v1.Datastore> create(
        ai.stigmer.agentic.datastore.v1.Datastore request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing datastore.
     * &#64;internal
     * Authorization: requires can_edit permission on the datastore
     * resource. Updates are full spec replaces; the gating schema-sync
     * step diffs against the loaded existing spec and applies the
     * additive-plus change matrix (DD-004): no transition silently
     * destroys or nulls record data.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.datastore.v1.Datastore> update(
        ai.stigmer.agentic.datastore.v1.Datastore request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing datastore.
     * Only modifies metadata.visibility. Datastores support two levels:
     * private (the default) and org. Setting org shares the datastore
     * with the owning organization for human administration; it does not
     * change record-layer access, which is governed solely by the
     * datastore's authorization block and agent datastore_usages.
     * &#64;internal
     * Authorization: requires can_edit permission on the datastore
     * resource. public/platform levels are rejected via the kind's
     * VisibilityConfig (supports_org only) — business records must never
     * be resolvable across the org boundary.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.datastore.v1.Datastore> updateVisibility(
        ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a datastore and every record it holds.
     * Deleting a non-empty datastore requires force: without it the
     * request fails with FAILED_PRECONDITION reporting how many records
     * across how many collections would be destroyed. A datastore
     * referenced by any agent's datastore_usages cannot be deleted until
     * the references are removed.
     * &#64;internal
     * Authorization: requires can_edit permission on the datastore
     * resource. The two guards (record-count acknowledgment via force;
     * agent-reference block, never forceable) run in the delete pipeline
     * of both editions. Record tools never delete structures — this RPC
     * is the only path that destroys collections.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.datastore.v1.Datastore> delete(
        ai.stigmer.commons.apiresource.ApiResourceDeleteInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_UPDATE_VISIBILITY = 3;
  private static final int METHODID_DELETE = 4;

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
        case METHODID_APPLY:
          serviceImpl.apply((ai.stigmer.agentic.datastore.v1.Datastore) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.Datastore>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.datastore.v1.Datastore) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.Datastore>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.datastore.v1.Datastore) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.Datastore>) responseObserver);
          break;
        case METHODID_UPDATE_VISIBILITY:
          serviceImpl.updateVisibility((ai.stigmer.commons.apiresource.UpdateVisibilityInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.Datastore>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.commons.apiresource.ApiResourceDeleteInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.Datastore>) responseObserver);
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
          getApplyMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.datastore.v1.Datastore,
              ai.stigmer.agentic.datastore.v1.Datastore>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.datastore.v1.Datastore,
              ai.stigmer.agentic.datastore.v1.Datastore>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.datastore.v1.Datastore,
              ai.stigmer.agentic.datastore.v1.Datastore>(
                service, METHODID_UPDATE)))
        .addMethod(
          getUpdateVisibilityMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.UpdateVisibilityInput,
              ai.stigmer.agentic.datastore.v1.Datastore>(
                service, METHODID_UPDATE_VISIBILITY)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceDeleteInput,
              ai.stigmer.agentic.datastore.v1.Datastore>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class DatastoreCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    DatastoreCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.datastore.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("DatastoreCommandController");
    }
  }

  private static final class DatastoreCommandControllerFileDescriptorSupplier
      extends DatastoreCommandControllerBaseDescriptorSupplier {
    DatastoreCommandControllerFileDescriptorSupplier() {}
  }

  private static final class DatastoreCommandControllerMethodDescriptorSupplier
      extends DatastoreCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    DatastoreCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (DatastoreCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new DatastoreCommandControllerFileDescriptorSupplier())
              .addMethod(getApplyMethod())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getUpdateVisibilityMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
