package ai.stigmer.agentic.datastore.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * DatastoreRecordCommandController handles record writes for datastores.
 * &#64;internal
 * Same two-layer, in-handler authorization as
 * DatastoreRecordQueryController (see its service comment; the RPCs are
 * slug-addressed and credential-class dispatched, hence
 * is_skip_authorization). Writes additionally evaluate declared
 * constraints inside the write transaction — BEGIN IMMEDIATE in OSS
 * SQLite, FOR SHARE row locks or SERIALIZABLE in cloud Postgres — so no
 * write commits against a stale exists check and uniques are always
 * substrate-enforced. Violations return the constraint's declared
 * agent-relayable message with ErrorInfo (reason CONSTRAINT_VIOLATION +
 * constraint name): unique → ALREADY_EXISTS, check/exists →
 * FAILED_PRECONDITION. Record tools never delete structures — dropping
 * collections or datastores is the resource layer's guarded delete.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class DatastoreRecordCommandControllerGrpc {

  private DatastoreRecordCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.datastore.v1.DatastoreRecordCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.InsertRecordRequest,
      ai.stigmer.agentic.datastore.v1.RecordEnvelope> getInsertRecordMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "insertRecord",
      requestType = ai.stigmer.agentic.datastore.v1.InsertRecordRequest.class,
      responseType = ai.stigmer.agentic.datastore.v1.RecordEnvelope.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.InsertRecordRequest,
      ai.stigmer.agentic.datastore.v1.RecordEnvelope> getInsertRecordMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.InsertRecordRequest, ai.stigmer.agentic.datastore.v1.RecordEnvelope> getInsertRecordMethod;
    if ((getInsertRecordMethod = DatastoreRecordCommandControllerGrpc.getInsertRecordMethod) == null) {
      synchronized (DatastoreRecordCommandControllerGrpc.class) {
        if ((getInsertRecordMethod = DatastoreRecordCommandControllerGrpc.getInsertRecordMethod) == null) {
          DatastoreRecordCommandControllerGrpc.getInsertRecordMethod = getInsertRecordMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.datastore.v1.InsertRecordRequest, ai.stigmer.agentic.datastore.v1.RecordEnvelope>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "insertRecord"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.InsertRecordRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.RecordEnvelope.getDefaultInstance()))
              .setSchemaDescriptor(new DatastoreRecordCommandControllerMethodDescriptorSupplier("insertRecord"))
              .build();
        }
      }
    }
    return getInsertRecordMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.UpdateRecordRequest,
      ai.stigmer.agentic.datastore.v1.RecordEnvelope> getUpdateRecordMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateRecord",
      requestType = ai.stigmer.agentic.datastore.v1.UpdateRecordRequest.class,
      responseType = ai.stigmer.agentic.datastore.v1.RecordEnvelope.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.UpdateRecordRequest,
      ai.stigmer.agentic.datastore.v1.RecordEnvelope> getUpdateRecordMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.UpdateRecordRequest, ai.stigmer.agentic.datastore.v1.RecordEnvelope> getUpdateRecordMethod;
    if ((getUpdateRecordMethod = DatastoreRecordCommandControllerGrpc.getUpdateRecordMethod) == null) {
      synchronized (DatastoreRecordCommandControllerGrpc.class) {
        if ((getUpdateRecordMethod = DatastoreRecordCommandControllerGrpc.getUpdateRecordMethod) == null) {
          DatastoreRecordCommandControllerGrpc.getUpdateRecordMethod = getUpdateRecordMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.datastore.v1.UpdateRecordRequest, ai.stigmer.agentic.datastore.v1.RecordEnvelope>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateRecord"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.UpdateRecordRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.RecordEnvelope.getDefaultInstance()))
              .setSchemaDescriptor(new DatastoreRecordCommandControllerMethodDescriptorSupplier("updateRecord"))
              .build();
        }
      }
    }
    return getUpdateRecordMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.DeleteRecordRequest,
      ai.stigmer.agentic.datastore.v1.RecordEnvelope> getDeleteRecordMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "deleteRecord",
      requestType = ai.stigmer.agentic.datastore.v1.DeleteRecordRequest.class,
      responseType = ai.stigmer.agentic.datastore.v1.RecordEnvelope.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.DeleteRecordRequest,
      ai.stigmer.agentic.datastore.v1.RecordEnvelope> getDeleteRecordMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.datastore.v1.DeleteRecordRequest, ai.stigmer.agentic.datastore.v1.RecordEnvelope> getDeleteRecordMethod;
    if ((getDeleteRecordMethod = DatastoreRecordCommandControllerGrpc.getDeleteRecordMethod) == null) {
      synchronized (DatastoreRecordCommandControllerGrpc.class) {
        if ((getDeleteRecordMethod = DatastoreRecordCommandControllerGrpc.getDeleteRecordMethod) == null) {
          DatastoreRecordCommandControllerGrpc.getDeleteRecordMethod = getDeleteRecordMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.datastore.v1.DeleteRecordRequest, ai.stigmer.agentic.datastore.v1.RecordEnvelope>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "deleteRecord"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.DeleteRecordRequest.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.datastore.v1.RecordEnvelope.getDefaultInstance()))
              .setSchemaDescriptor(new DatastoreRecordCommandControllerMethodDescriptorSupplier("deleteRecord"))
              .build();
        }
      }
    }
    return getDeleteRecordMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static DatastoreRecordCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<DatastoreRecordCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<DatastoreRecordCommandControllerStub>() {
        @java.lang.Override
        public DatastoreRecordCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new DatastoreRecordCommandControllerStub(channel, callOptions);
        }
      };
    return DatastoreRecordCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static DatastoreRecordCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<DatastoreRecordCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<DatastoreRecordCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public DatastoreRecordCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new DatastoreRecordCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return DatastoreRecordCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static DatastoreRecordCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<DatastoreRecordCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<DatastoreRecordCommandControllerBlockingStub>() {
        @java.lang.Override
        public DatastoreRecordCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new DatastoreRecordCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return DatastoreRecordCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static DatastoreRecordCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<DatastoreRecordCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<DatastoreRecordCommandControllerFutureStub>() {
        @java.lang.Override
        public DatastoreRecordCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new DatastoreRecordCommandControllerFutureStub(channel, callOptions);
        }
      };
    return DatastoreRecordCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * DatastoreRecordCommandController handles record writes for datastores.
   * &#64;internal
   * Same two-layer, in-handler authorization as
   * DatastoreRecordQueryController (see its service comment; the RPCs are
   * slug-addressed and credential-class dispatched, hence
   * is_skip_authorization). Writes additionally evaluate declared
   * constraints inside the write transaction — BEGIN IMMEDIATE in OSS
   * SQLite, FOR SHARE row locks or SERIALIZABLE in cloud Postgres — so no
   * write commits against a stale exists check and uniques are always
   * substrate-enforced. Violations return the constraint's declared
   * agent-relayable message with ErrorInfo (reason CONSTRAINT_VIOLATION +
   * constraint name): unique → ALREADY_EXISTS, check/exists →
   * FAILED_PRECONDITION. Record tools never delete structures — dropping
   * collections or datastores is the resource layer's guarded delete.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Insert a record into a collection.
     * Requires the insert verb on the collection. System fields are
     * server-stamped; supplying them is rejected. Returns the full record
     * envelope.
     * &#64;internal
     * The only non-idempotent record operation; declared uniques are the
     * duplicate guard (a retried insert violating a unique returns
     * ALREADY_EXISTS, never a duplicate). Insert idempotency keys are a
     * recorded growth path.
     * </pre>
     */
    default void insertRecord(ai.stigmer.agentic.datastore.v1.InsertRecordRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.RecordEnvelope> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getInsertRecordMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update a record by id with a partial merge.
     * Requires the update verb on the collection (own scope limits it to
     * records the caller created). Only supplied fields change; an
     * explicit null clears a field; constraints evaluate on the merged
     * result. Returns the full record envelope.
     * </pre>
     */
    default void updateRecord(ai.stigmer.agentic.datastore.v1.UpdateRecordRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.RecordEnvelope> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateRecordMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a record by id.
     * Requires the delete verb on the collection (own scope limits it to
     * records the caller created). Returns the deleted record's envelope.
     * </pre>
     */
    default void deleteRecord(ai.stigmer.agentic.datastore.v1.DeleteRecordRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.RecordEnvelope> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteRecordMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service DatastoreRecordCommandController.
   * <pre>
   * DatastoreRecordCommandController handles record writes for datastores.
   * &#64;internal
   * Same two-layer, in-handler authorization as
   * DatastoreRecordQueryController (see its service comment; the RPCs are
   * slug-addressed and credential-class dispatched, hence
   * is_skip_authorization). Writes additionally evaluate declared
   * constraints inside the write transaction — BEGIN IMMEDIATE in OSS
   * SQLite, FOR SHARE row locks or SERIALIZABLE in cloud Postgres — so no
   * write commits against a stale exists check and uniques are always
   * substrate-enforced. Violations return the constraint's declared
   * agent-relayable message with ErrorInfo (reason CONSTRAINT_VIOLATION +
   * constraint name): unique → ALREADY_EXISTS, check/exists →
   * FAILED_PRECONDITION. Record tools never delete structures — dropping
   * collections or datastores is the resource layer's guarded delete.
   * </pre>
   */
  public static abstract class DatastoreRecordCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return DatastoreRecordCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service DatastoreRecordCommandController.
   * <pre>
   * DatastoreRecordCommandController handles record writes for datastores.
   * &#64;internal
   * Same two-layer, in-handler authorization as
   * DatastoreRecordQueryController (see its service comment; the RPCs are
   * slug-addressed and credential-class dispatched, hence
   * is_skip_authorization). Writes additionally evaluate declared
   * constraints inside the write transaction — BEGIN IMMEDIATE in OSS
   * SQLite, FOR SHARE row locks or SERIALIZABLE in cloud Postgres — so no
   * write commits against a stale exists check and uniques are always
   * substrate-enforced. Violations return the constraint's declared
   * agent-relayable message with ErrorInfo (reason CONSTRAINT_VIOLATION +
   * constraint name): unique → ALREADY_EXISTS, check/exists →
   * FAILED_PRECONDITION. Record tools never delete structures — dropping
   * collections or datastores is the resource layer's guarded delete.
   * </pre>
   */
  public static final class DatastoreRecordCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<DatastoreRecordCommandControllerStub> {
    private DatastoreRecordCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected DatastoreRecordCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new DatastoreRecordCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Insert a record into a collection.
     * Requires the insert verb on the collection. System fields are
     * server-stamped; supplying them is rejected. Returns the full record
     * envelope.
     * &#64;internal
     * The only non-idempotent record operation; declared uniques are the
     * duplicate guard (a retried insert violating a unique returns
     * ALREADY_EXISTS, never a duplicate). Insert idempotency keys are a
     * recorded growth path.
     * </pre>
     */
    public void insertRecord(ai.stigmer.agentic.datastore.v1.InsertRecordRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.RecordEnvelope> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getInsertRecordMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update a record by id with a partial merge.
     * Requires the update verb on the collection (own scope limits it to
     * records the caller created). Only supplied fields change; an
     * explicit null clears a field; constraints evaluate on the merged
     * result. Returns the full record envelope.
     * </pre>
     */
    public void updateRecord(ai.stigmer.agentic.datastore.v1.UpdateRecordRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.RecordEnvelope> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateRecordMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a record by id.
     * Requires the delete verb on the collection (own scope limits it to
     * records the caller created). Returns the deleted record's envelope.
     * </pre>
     */
    public void deleteRecord(ai.stigmer.agentic.datastore.v1.DeleteRecordRequest request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.RecordEnvelope> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteRecordMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service DatastoreRecordCommandController.
   * <pre>
   * DatastoreRecordCommandController handles record writes for datastores.
   * &#64;internal
   * Same two-layer, in-handler authorization as
   * DatastoreRecordQueryController (see its service comment; the RPCs are
   * slug-addressed and credential-class dispatched, hence
   * is_skip_authorization). Writes additionally evaluate declared
   * constraints inside the write transaction — BEGIN IMMEDIATE in OSS
   * SQLite, FOR SHARE row locks or SERIALIZABLE in cloud Postgres — so no
   * write commits against a stale exists check and uniques are always
   * substrate-enforced. Violations return the constraint's declared
   * agent-relayable message with ErrorInfo (reason CONSTRAINT_VIOLATION +
   * constraint name): unique → ALREADY_EXISTS, check/exists →
   * FAILED_PRECONDITION. Record tools never delete structures — dropping
   * collections or datastores is the resource layer's guarded delete.
   * </pre>
   */
  public static final class DatastoreRecordCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<DatastoreRecordCommandControllerBlockingV2Stub> {
    private DatastoreRecordCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected DatastoreRecordCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new DatastoreRecordCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Insert a record into a collection.
     * Requires the insert verb on the collection. System fields are
     * server-stamped; supplying them is rejected. Returns the full record
     * envelope.
     * &#64;internal
     * The only non-idempotent record operation; declared uniques are the
     * duplicate guard (a retried insert violating a unique returns
     * ALREADY_EXISTS, never a duplicate). Insert idempotency keys are a
     * recorded growth path.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.RecordEnvelope insertRecord(ai.stigmer.agentic.datastore.v1.InsertRecordRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getInsertRecordMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a record by id with a partial merge.
     * Requires the update verb on the collection (own scope limits it to
     * records the caller created). Only supplied fields change; an
     * explicit null clears a field; constraints evaluate on the merged
     * result. Returns the full record envelope.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.RecordEnvelope updateRecord(ai.stigmer.agentic.datastore.v1.UpdateRecordRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateRecordMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a record by id.
     * Requires the delete verb on the collection (own scope limits it to
     * records the caller created). Returns the deleted record's envelope.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.RecordEnvelope deleteRecord(ai.stigmer.agentic.datastore.v1.DeleteRecordRequest request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteRecordMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service DatastoreRecordCommandController.
   * <pre>
   * DatastoreRecordCommandController handles record writes for datastores.
   * &#64;internal
   * Same two-layer, in-handler authorization as
   * DatastoreRecordQueryController (see its service comment; the RPCs are
   * slug-addressed and credential-class dispatched, hence
   * is_skip_authorization). Writes additionally evaluate declared
   * constraints inside the write transaction — BEGIN IMMEDIATE in OSS
   * SQLite, FOR SHARE row locks or SERIALIZABLE in cloud Postgres — so no
   * write commits against a stale exists check and uniques are always
   * substrate-enforced. Violations return the constraint's declared
   * agent-relayable message with ErrorInfo (reason CONSTRAINT_VIOLATION +
   * constraint name): unique → ALREADY_EXISTS, check/exists →
   * FAILED_PRECONDITION. Record tools never delete structures — dropping
   * collections or datastores is the resource layer's guarded delete.
   * </pre>
   */
  public static final class DatastoreRecordCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<DatastoreRecordCommandControllerBlockingStub> {
    private DatastoreRecordCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected DatastoreRecordCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new DatastoreRecordCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Insert a record into a collection.
     * Requires the insert verb on the collection. System fields are
     * server-stamped; supplying them is rejected. Returns the full record
     * envelope.
     * &#64;internal
     * The only non-idempotent record operation; declared uniques are the
     * duplicate guard (a retried insert violating a unique returns
     * ALREADY_EXISTS, never a duplicate). Insert idempotency keys are a
     * recorded growth path.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.RecordEnvelope insertRecord(ai.stigmer.agentic.datastore.v1.InsertRecordRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getInsertRecordMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a record by id with a partial merge.
     * Requires the update verb on the collection (own scope limits it to
     * records the caller created). Only supplied fields change; an
     * explicit null clears a field; constraints evaluate on the merged
     * result. Returns the full record envelope.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.RecordEnvelope updateRecord(ai.stigmer.agentic.datastore.v1.UpdateRecordRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateRecordMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a record by id.
     * Requires the delete verb on the collection (own scope limits it to
     * records the caller created). Returns the deleted record's envelope.
     * </pre>
     */
    public ai.stigmer.agentic.datastore.v1.RecordEnvelope deleteRecord(ai.stigmer.agentic.datastore.v1.DeleteRecordRequest request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteRecordMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service DatastoreRecordCommandController.
   * <pre>
   * DatastoreRecordCommandController handles record writes for datastores.
   * &#64;internal
   * Same two-layer, in-handler authorization as
   * DatastoreRecordQueryController (see its service comment; the RPCs are
   * slug-addressed and credential-class dispatched, hence
   * is_skip_authorization). Writes additionally evaluate declared
   * constraints inside the write transaction — BEGIN IMMEDIATE in OSS
   * SQLite, FOR SHARE row locks or SERIALIZABLE in cloud Postgres — so no
   * write commits against a stale exists check and uniques are always
   * substrate-enforced. Violations return the constraint's declared
   * agent-relayable message with ErrorInfo (reason CONSTRAINT_VIOLATION +
   * constraint name): unique → ALREADY_EXISTS, check/exists →
   * FAILED_PRECONDITION. Record tools never delete structures — dropping
   * collections or datastores is the resource layer's guarded delete.
   * </pre>
   */
  public static final class DatastoreRecordCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<DatastoreRecordCommandControllerFutureStub> {
    private DatastoreRecordCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected DatastoreRecordCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new DatastoreRecordCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Insert a record into a collection.
     * Requires the insert verb on the collection. System fields are
     * server-stamped; supplying them is rejected. Returns the full record
     * envelope.
     * &#64;internal
     * The only non-idempotent record operation; declared uniques are the
     * duplicate guard (a retried insert violating a unique returns
     * ALREADY_EXISTS, never a duplicate). Insert idempotency keys are a
     * recorded growth path.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.datastore.v1.RecordEnvelope> insertRecord(
        ai.stigmer.agentic.datastore.v1.InsertRecordRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getInsertRecordMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update a record by id with a partial merge.
     * Requires the update verb on the collection (own scope limits it to
     * records the caller created). Only supplied fields change; an
     * explicit null clears a field; constraints evaluate on the merged
     * result. Returns the full record envelope.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.datastore.v1.RecordEnvelope> updateRecord(
        ai.stigmer.agentic.datastore.v1.UpdateRecordRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateRecordMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a record by id.
     * Requires the delete verb on the collection (own scope limits it to
     * records the caller created). Returns the deleted record's envelope.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.datastore.v1.RecordEnvelope> deleteRecord(
        ai.stigmer.agentic.datastore.v1.DeleteRecordRequest request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteRecordMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_INSERT_RECORD = 0;
  private static final int METHODID_UPDATE_RECORD = 1;
  private static final int METHODID_DELETE_RECORD = 2;

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
        case METHODID_INSERT_RECORD:
          serviceImpl.insertRecord((ai.stigmer.agentic.datastore.v1.InsertRecordRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.RecordEnvelope>) responseObserver);
          break;
        case METHODID_UPDATE_RECORD:
          serviceImpl.updateRecord((ai.stigmer.agentic.datastore.v1.UpdateRecordRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.RecordEnvelope>) responseObserver);
          break;
        case METHODID_DELETE_RECORD:
          serviceImpl.deleteRecord((ai.stigmer.agentic.datastore.v1.DeleteRecordRequest) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.datastore.v1.RecordEnvelope>) responseObserver);
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
          getInsertRecordMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.datastore.v1.InsertRecordRequest,
              ai.stigmer.agentic.datastore.v1.RecordEnvelope>(
                service, METHODID_INSERT_RECORD)))
        .addMethod(
          getUpdateRecordMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.datastore.v1.UpdateRecordRequest,
              ai.stigmer.agentic.datastore.v1.RecordEnvelope>(
                service, METHODID_UPDATE_RECORD)))
        .addMethod(
          getDeleteRecordMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.datastore.v1.DeleteRecordRequest,
              ai.stigmer.agentic.datastore.v1.RecordEnvelope>(
                service, METHODID_DELETE_RECORD)))
        .build();
  }

  private static abstract class DatastoreRecordCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    DatastoreRecordCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.datastore.v1.RecordCommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("DatastoreRecordCommandController");
    }
  }

  private static final class DatastoreRecordCommandControllerFileDescriptorSupplier
      extends DatastoreRecordCommandControllerBaseDescriptorSupplier {
    DatastoreRecordCommandControllerFileDescriptorSupplier() {}
  }

  private static final class DatastoreRecordCommandControllerMethodDescriptorSupplier
      extends DatastoreRecordCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    DatastoreRecordCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (DatastoreRecordCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new DatastoreRecordCommandControllerFileDescriptorSupplier())
              .addMethod(getInsertRecordMethod())
              .addMethod(getUpdateRecordMethod())
              .addMethod(getDeleteRecordMethod())
              .build();
        }
      }
    }
    return result;
  }
}
