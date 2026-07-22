package ai.stigmer.agentic.datastore.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * DatastoreRecordQueryController handles record reads and schema
 * discovery for datastores.
 * &#64;internal
 * Record RPCs are slug-addressed and carry is_skip_authorization: the
 * declarative interceptor cannot resolve a slug to an FGA object id,
 * and the reach check dispatches on credential class (DD-006), which a
 * static method option cannot express. Every handler enforces the
 * two-layer model in-order, fail-closed:
 *   Layer 1 (reach): session-bound runner credentials resolve token →
 *   session → agent, require the agent's datastore_usages to name the
 *   slug, and require the datastore's org to match; direct platform
 *   principals require can_use_records on the resolved datastore (FGA
 *   in cloud, local trust in OSS).
 *   Layer 2 (grants): resolved subject → binding → role →
 *   per-collection grant, verb + own scope, in datastore domain logic
 *   in both editions.
 * No identity fields appear in any request — subject resolution is
 * credential and session state only. Domain errors carry
 * google.rpc.ErrorInfo (reason + constraint) and agent-relayable
 * messages, byte-identical across editions.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class DatastoreRecordQueryControllerGrpc {

  private DatastoreRecordQueryControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.datastore.v1.DatastoreRecordQueryController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.FindRecordsRequest,
      ai.stigmer.agentic.datastore.v1.RecordList> getFindRecordsMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "findRecords",
      requestType = ai.stigmer.agentic.datastore.v1.FindRecordsRequest.class,
      responseType = ai.stigmer.agentic.datastore.v1.RecordList.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.FindRecordsRequest,
      ai.stigmer.agentic.datastore.v1.RecordList> getFindRecordsMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.FindRecordsRequest, ai.stigmer.agentic.datastore.v1.RecordList> getFindRecordsMethod;
    if ((getFindRecordsMethod = DatastoreRecordQueryControllerGrpc.getFindRecordsMethod) == null) {
      synchronized (DatastoreRecordQueryControllerGrpc.class) {
        if ((getFindRecordsMethod = DatastoreRecordQueryControllerGrpc.getFindRecordsMethod) == null) {
          DatastoreRecordQueryControllerGrpc.getFindRecordsMethod = getFindRecordsMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.datastore.v1.FindRecordsRequest, ai.stigmer.agentic.datastore.v1.RecordList>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "findRecords"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.FindRecordsRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.RecordList.getDefaultInstance()))
              .setSchemaDescriptor(new DatastoreRecordQueryControllerMethodDescriptorSupplier("findRecords"))
              .build();
        }
      }
    }
    return getFindRecordsMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.DescribeDatastoreRequest,
      ai.stigmer.agentic.datastore.v1.DatastoreDescription> getDescribeDatastoreMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "describeDatastore",
      requestType = ai.stigmer.agentic.datastore.v1.DescribeDatastoreRequest.class,
      responseType = ai.stigmer.agentic.datastore.v1.DatastoreDescription.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.DescribeDatastoreRequest,
      ai.stigmer.agentic.datastore.v1.DatastoreDescription> getDescribeDatastoreMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.DescribeDatastoreRequest, ai.stigmer.agentic.datastore.v1.DatastoreDescription> getDescribeDatastoreMethod;
    if ((getDescribeDatastoreMethod = DatastoreRecordQueryControllerGrpc.getDescribeDatastoreMethod) == null) {
      synchronized (DatastoreRecordQueryControllerGrpc.class) {
        if ((getDescribeDatastoreMethod = DatastoreRecordQueryControllerGrpc.getDescribeDatastoreMethod) == null) {
          DatastoreRecordQueryControllerGrpc.getDescribeDatastoreMethod = getDescribeDatastoreMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.datastore.v1.DescribeDatastoreRequest, ai.stigmer.agentic.datastore.v1.DatastoreDescription>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "describeDatastore"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.DescribeDatastoreRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.DatastoreDescription.getDefaultInstance()))
              .setSchemaDescriptor(new DatastoreRecordQueryControllerMethodDescriptorSupplier("describeDatastore"))
              .build();
        }
      }
    }
    return getDescribeDatastoreMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static DatastoreRecordQueryControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<DatastoreRecordQueryControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<DatastoreRecordQueryControllerStub>() {
        @java.lang.Override
        public DatastoreRecordQueryControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new DatastoreRecordQueryControllerStub(channel, callOptions);
        }
      };
    return DatastoreRecordQueryControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static DatastoreRecordQueryControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<DatastoreRecordQueryControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<DatastoreRecordQueryControllerBlockingV2Stub>() {
        @java.lang.Override
        public DatastoreRecordQueryControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new DatastoreRecordQueryControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return DatastoreRecordQueryControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static DatastoreRecordQueryControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<DatastoreRecordQueryControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<DatastoreRecordQueryControllerBlockingStub>() {
        @java.lang.Override
        public DatastoreRecordQueryControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new DatastoreRecordQueryControllerBlockingStub(channel, callOptions);
        }
      };
    return DatastoreRecordQueryControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static DatastoreRecordQueryControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<DatastoreRecordQueryControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<DatastoreRecordQueryControllerFutureStub>() {
        @java.lang.Override
        public DatastoreRecordQueryControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new DatastoreRecordQueryControllerFutureStub(channel, callOptions);
        }
      };
    return DatastoreRecordQueryControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * DatastoreRecordQueryController handles record reads and schema
   * discovery for datastores.
   * &#64;internal
   * Record RPCs are slug-addressed and carry is_skip_authorization: the
   * declarative interceptor cannot resolve a slug to an FGA object id,
   * and the reach check dispatches on credential class (DD-006), which a
   * static method option cannot express. Every handler enforces the
   * two-layer model in-order, fail-closed:
   *   Layer 1 (reach): session-bound runner credentials resolve token →
   *   session → agent, require the agent's datastore_usages to name the
   *   slug, and require the datastore's org to match; direct platform
   *   principals require can_use_records on the resolved datastore (FGA
   *   in cloud, local trust in OSS).
   *   Layer 2 (grants): resolved subject → binding → role →
   *   per-collection grant, verb + own scope, in datastore domain logic
   *   in both editions.
   * No identity fields appear in any request — subject resolution is
   * credential and session state only. Domain errors carry
   * google.rpc.ErrorInfo (reason + constraint) and agent-relayable
   * messages, byte-identical across editions.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Find records in a collection with a typed filter.
     * Requires the read verb on the collection. Results are paginated
     * (default 25, max 100) and deterministically ordered.
     * &#64;internal
     * An own-scoped read grant composes the scope into the query as an
     * inexpressible conjunction — callers can neither relax nor observe
     * it.
     * </pre>
     */
    default void findRecords(ai.stigmer.agentic.datastore.v1.FindRecordsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.RecordList> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getFindRecordsMethod(), responseObserver);
    }

    /**
     * <pre>
     * Describe a datastore's collections, fields, constraints, and the
     * caller's effective verbs per collection.
     * Requires reach only (no per-collection verb): a caller with no
     * grants sees the schema with empty access lists.
     * &#64;internal
     * The effective-verb resolution runs the same Layer 2 chain as record
     * operations, at describe time. Operator state (bindings, seeds, sync
     * report) is deliberately excluded from the projection.
     * </pre>
     */
    default void describeDatastore(ai.stigmer.agentic.datastore.v1.DescribeDatastoreRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.DatastoreDescription> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDescribeDatastoreMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service DatastoreRecordQueryController.
   * <pre>
   * DatastoreRecordQueryController handles record reads and schema
   * discovery for datastores.
   * &#64;internal
   * Record RPCs are slug-addressed and carry is_skip_authorization: the
   * declarative interceptor cannot resolve a slug to an FGA object id,
   * and the reach check dispatches on credential class (DD-006), which a
   * static method option cannot express. Every handler enforces the
   * two-layer model in-order, fail-closed:
   *   Layer 1 (reach): session-bound runner credentials resolve token →
   *   session → agent, require the agent's datastore_usages to name the
   *   slug, and require the datastore's org to match; direct platform
   *   principals require can_use_records on the resolved datastore (FGA
   *   in cloud, local trust in OSS).
   *   Layer 2 (grants): resolved subject → binding → role →
   *   per-collection grant, verb + own scope, in datastore domain logic
   *   in both editions.
   * No identity fields appear in any request — subject resolution is
   * credential and session state only. Domain errors carry
   * google.rpc.ErrorInfo (reason + constraint) and agent-relayable
   * messages, byte-identical across editions.
   * </pre>
   */
  public static abstract class DatastoreRecordQueryControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return DatastoreRecordQueryControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service DatastoreRecordQueryController.
   * <pre>
   * DatastoreRecordQueryController handles record reads and schema
   * discovery for datastores.
   * &#64;internal
   * Record RPCs are slug-addressed and carry is_skip_authorization: the
   * declarative interceptor cannot resolve a slug to an FGA object id,
   * and the reach check dispatches on credential class (DD-006), which a
   * static method option cannot express. Every handler enforces the
   * two-layer model in-order, fail-closed:
   *   Layer 1 (reach): session-bound runner credentials resolve token →
   *   session → agent, require the agent's datastore_usages to name the
   *   slug, and require the datastore's org to match; direct platform
   *   principals require can_use_records on the resolved datastore (FGA
   *   in cloud, local trust in OSS).
   *   Layer 2 (grants): resolved subject → binding → role →
   *   per-collection grant, verb + own scope, in datastore domain logic
   *   in both editions.
   * No identity fields appear in any request — subject resolution is
   * credential and session state only. Domain errors carry
   * google.rpc.ErrorInfo (reason + constraint) and agent-relayable
   * messages, byte-identical across editions.
   * </pre>
   */
  public static final class DatastoreRecordQueryControllerStub
      extends io.grpc.stub.AbstractAsyncStub<DatastoreRecordQueryControllerStub> {
    private DatastoreRecordQueryControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected DatastoreRecordQueryControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new DatastoreRecordQueryControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Find records in a collection with a typed filter.
     * Requires the read verb on the collection. Results are paginated
     * (default 25, max 100) and deterministically ordered.
     * &#64;internal
     * An own-scoped read grant composes the scope into the query as an
     * inexpressible conjunction — callers can neither relax nor observe
     * it.
     * </pre>
     */
    public void findRecords(ai.stigmer.agentic.datastore.v1.FindRecordsRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.RecordList> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getFindRecordsMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Describe a datastore's collections, fields, constraints, and the
     * caller's effective verbs per collection.
     * Requires reach only (no per-collection verb): a caller with no
     * grants sees the schema with empty access lists.
     * &#64;internal
     * The effective-verb resolution runs the same Layer 2 chain as record
     * operations, at describe time. Operator state (bindings, seeds, sync
     * report) is deliberately excluded from the projection.
     * </pre>
     */
    public void describeDatastore(ai.stigmer.agentic.datastore.v1.DescribeDatastoreRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.DatastoreDescription> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDescribeDatastoreMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service DatastoreRecordQueryController.
   * <pre>
   * DatastoreRecordQueryController handles record reads and schema
   * discovery for datastores.
   * &#64;internal
   * Record RPCs are slug-addressed and carry is_skip_authorization: the
   * declarative interceptor cannot resolve a slug to an FGA object id,
   * and the reach check dispatches on credential class (DD-006), which a
   * static method option cannot express. Every handler enforces the
   * two-layer model in-order, fail-closed:
   *   Layer 1 (reach): session-bound runner credentials resolve token →
   *   session → agent, require the agent's datastore_usages to name the
   *   slug, and require the datastore's org to match; direct platform
   *   principals require can_use_records on the resolved datastore (FGA
   *   in cloud, local trust in OSS).
   *   Layer 2 (grants): resolved subject → binding → role →
   *   per-collection grant, verb + own scope, in datastore domain logic
   *   in both editions.
   * No identity fields appear in any request — subject resolution is
   * credential and session state only. Domain errors carry
   * google.rpc.ErrorInfo (reason + constraint) and agent-relayable
   * messages, byte-identical across editions.
   * </pre>
   */
  public static final class DatastoreRecordQueryControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<DatastoreRecordQueryControllerBlockingV2Stub> {
    private DatastoreRecordQueryControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected DatastoreRecordQueryControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new DatastoreRecordQueryControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Find records in a collection with a typed filter.
     * Requires the read verb on the collection. Results are paginated
     * (default 25, max 100) and deterministically ordered.
     * &#64;internal
     * An own-scoped read grant composes the scope into the query as an
     * inexpressible conjunction — callers can neither relax nor observe
     * it.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.RecordList findRecords(ai.stigmer.agentic.datastore.v1.FindRecordsRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getFindRecordsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Describe a datastore's collections, fields, constraints, and the
     * caller's effective verbs per collection.
     * Requires reach only (no per-collection verb): a caller with no
     * grants sees the schema with empty access lists.
     * &#64;internal
     * The effective-verb resolution runs the same Layer 2 chain as record
     * operations, at describe time. Operator state (bindings, seeds, sync
     * report) is deliberately excluded from the projection.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.DatastoreDescription describeDatastore(ai.stigmer.agentic.datastore.v1.DescribeDatastoreRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDescribeDatastoreMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service DatastoreRecordQueryController.
   * <pre>
   * DatastoreRecordQueryController handles record reads and schema
   * discovery for datastores.
   * &#64;internal
   * Record RPCs are slug-addressed and carry is_skip_authorization: the
   * declarative interceptor cannot resolve a slug to an FGA object id,
   * and the reach check dispatches on credential class (DD-006), which a
   * static method option cannot express. Every handler enforces the
   * two-layer model in-order, fail-closed:
   *   Layer 1 (reach): session-bound runner credentials resolve token →
   *   session → agent, require the agent's datastore_usages to name the
   *   slug, and require the datastore's org to match; direct platform
   *   principals require can_use_records on the resolved datastore (FGA
   *   in cloud, local trust in OSS).
   *   Layer 2 (grants): resolved subject → binding → role →
   *   per-collection grant, verb + own scope, in datastore domain logic
   *   in both editions.
   * No identity fields appear in any request — subject resolution is
   * credential and session state only. Domain errors carry
   * google.rpc.ErrorInfo (reason + constraint) and agent-relayable
   * messages, byte-identical across editions.
   * </pre>
   */
  public static final class DatastoreRecordQueryControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<DatastoreRecordQueryControllerBlockingStub> {
    private DatastoreRecordQueryControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected DatastoreRecordQueryControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new DatastoreRecordQueryControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Find records in a collection with a typed filter.
     * Requires the read verb on the collection. Results are paginated
     * (default 25, max 100) and deterministically ordered.
     * &#64;internal
     * An own-scoped read grant composes the scope into the query as an
     * inexpressible conjunction — callers can neither relax nor observe
     * it.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.RecordList findRecords(ai.stigmer.agentic.datastore.v1.FindRecordsRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getFindRecordsMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Describe a datastore's collections, fields, constraints, and the
     * caller's effective verbs per collection.
     * Requires reach only (no per-collection verb): a caller with no
     * grants sees the schema with empty access lists.
     * &#64;internal
     * The effective-verb resolution runs the same Layer 2 chain as record
     * operations, at describe time. Operator state (bindings, seeds, sync
     * report) is deliberately excluded from the projection.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.DatastoreDescription describeDatastore(ai.stigmer.agentic.datastore.v1.DescribeDatastoreRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDescribeDatastoreMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service DatastoreRecordQueryController.
   * <pre>
   * DatastoreRecordQueryController handles record reads and schema
   * discovery for datastores.
   * &#64;internal
   * Record RPCs are slug-addressed and carry is_skip_authorization: the
   * declarative interceptor cannot resolve a slug to an FGA object id,
   * and the reach check dispatches on credential class (DD-006), which a
   * static method option cannot express. Every handler enforces the
   * two-layer model in-order, fail-closed:
   *   Layer 1 (reach): session-bound runner credentials resolve token →
   *   session → agent, require the agent's datastore_usages to name the
   *   slug, and require the datastore's org to match; direct platform
   *   principals require can_use_records on the resolved datastore (FGA
   *   in cloud, local trust in OSS).
   *   Layer 2 (grants): resolved subject → binding → role →
   *   per-collection grant, verb + own scope, in datastore domain logic
   *   in both editions.
   * No identity fields appear in any request — subject resolution is
   * credential and session state only. Domain errors carry
   * google.rpc.ErrorInfo (reason + constraint) and agent-relayable
   * messages, byte-identical across editions.
   * </pre>
   */
  public static final class DatastoreRecordQueryControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<DatastoreRecordQueryControllerFutureStub> {
    private DatastoreRecordQueryControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected DatastoreRecordQueryControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new DatastoreRecordQueryControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Find records in a collection with a typed filter.
     * Requires the read verb on the collection. Results are paginated
     * (default 25, max 100) and deterministically ordered.
     * &#64;internal
     * An own-scoped read grant composes the scope into the query as an
     * inexpressible conjunction — callers can neither relax nor observe
     * it.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.datastore.v1.RecordList> findRecords(
        ai.stigmer.agentic.datastore.v1.FindRecordsRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getFindRecordsMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Describe a datastore's collections, fields, constraints, and the
     * caller's effective verbs per collection.
     * Requires reach only (no per-collection verb): a caller with no
     * grants sees the schema with empty access lists.
     * &#64;internal
     * The effective-verb resolution runs the same Layer 2 chain as record
     * operations, at describe time. Operator state (bindings, seeds, sync
     * report) is deliberately excluded from the projection.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.datastore.v1.DatastoreDescription> describeDatastore(
        ai.stigmer.agentic.datastore.v1.DescribeDatastoreRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDescribeDatastoreMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_FIND_RECORDS = 0;
  private static final int METHODID_DESCRIBE_DATASTORE = 1;

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
        case METHODID_FIND_RECORDS:
          serviceImpl.findRecords((ai.stigmer.agentic.datastore.v1.FindRecordsRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.RecordList>) responseObserver);
          break;
        case METHODID_DESCRIBE_DATASTORE:
          serviceImpl.describeDatastore((ai.stigmer.agentic.datastore.v1.DescribeDatastoreRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.DatastoreDescription>) responseObserver);
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
          getFindRecordsMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.datastore.v1.FindRecordsRequest,
              ai.stigmer.agentic.datastore.v1.RecordList>(
                service, METHODID_FIND_RECORDS)))
        .addMethod(
          getDescribeDatastoreMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.datastore.v1.DescribeDatastoreRequest,
              ai.stigmer.agentic.datastore.v1.DatastoreDescription>(
                service, METHODID_DESCRIBE_DATASTORE)))
        .build();
  }

  private static abstract class DatastoreRecordQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    DatastoreRecordQueryControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.datastore.v1.RecordQueryProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("DatastoreRecordQueryController");
    }
  }

  private static final class DatastoreRecordQueryControllerFileDescriptorSupplier
      extends DatastoreRecordQueryControllerBaseDescriptorSupplier {
    DatastoreRecordQueryControllerFileDescriptorSupplier() {}
  }

  private static final class DatastoreRecordQueryControllerMethodDescriptorSupplier
      extends DatastoreRecordQueryControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    DatastoreRecordQueryControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (DatastoreRecordQueryControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new DatastoreRecordQueryControllerFileDescriptorSupplier())
              .addMethod(getFindRecordsMethod())
              .addMethod(getDescribeDatastoreMethod())
              .build();
        }
      }
    }
    return result;
  }
}
