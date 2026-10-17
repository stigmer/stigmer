package ai.stigmer.agentic.routine.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * RoutineCommandController handles write operations for routines.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class RoutineCommandControllerGrpc {

  private RoutineCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.routine.v1.RoutineCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.Routine,
      ai.stigmer.agentic.routine.v1.Routine> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.agentic.routine.v1.Routine.class,
      responseType = ai.stigmer.agentic.routine.v1.Routine.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.Routine,
      ai.stigmer.agentic.routine.v1.Routine> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.Routine, ai.stigmer.agentic.routine.v1.Routine> getApplyMethod;
    if ((getApplyMethod = RoutineCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (RoutineCommandControllerGrpc.class) {
        if ((getApplyMethod = RoutineCommandControllerGrpc.getApplyMethod) == null) {
          RoutineCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.routine.v1.Routine, ai.stigmer.agentic.routine.v1.Routine>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.Routine.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.Routine.getDefaultInstance()))
              .setSchemaDescriptor(new RoutineCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.Routine,
      ai.stigmer.agentic.routine.v1.Routine> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.routine.v1.Routine.class,
      responseType = ai.stigmer.agentic.routine.v1.Routine.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.Routine,
      ai.stigmer.agentic.routine.v1.Routine> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.Routine, ai.stigmer.agentic.routine.v1.Routine> getCreateMethod;
    if ((getCreateMethod = RoutineCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (RoutineCommandControllerGrpc.class) {
        if ((getCreateMethod = RoutineCommandControllerGrpc.getCreateMethod) == null) {
          RoutineCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.routine.v1.Routine, ai.stigmer.agentic.routine.v1.Routine>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.Routine.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.Routine.getDefaultInstance()))
              .setSchemaDescriptor(new RoutineCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.UpdateRoutineInput,
      ai.stigmer.agentic.routine.v1.Routine> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.routine.v1.UpdateRoutineInput.class,
      responseType = ai.stigmer.agentic.routine.v1.Routine.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.UpdateRoutineInput,
      ai.stigmer.agentic.routine.v1.Routine> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.UpdateRoutineInput, ai.stigmer.agentic.routine.v1.Routine> getUpdateMethod;
    if ((getUpdateMethod = RoutineCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (RoutineCommandControllerGrpc.class) {
        if ((getUpdateMethod = RoutineCommandControllerGrpc.getUpdateMethod) == null) {
          RoutineCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.routine.v1.UpdateRoutineInput, ai.stigmer.agentic.routine.v1.Routine>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.UpdateRoutineInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.Routine.getDefaultInstance()))
              .setSchemaDescriptor(new RoutineCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput,
      ai.stigmer.agentic.routine.v1.Routine> getRenameMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "rename",
      requestType = ai.stigmer.commons.apiresource.RenameInput.class,
      responseType = ai.stigmer.agentic.routine.v1.Routine.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput,
      ai.stigmer.agentic.routine.v1.Routine> getRenameMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.RenameInput, ai.stigmer.agentic.routine.v1.Routine> getRenameMethod;
    if ((getRenameMethod = RoutineCommandControllerGrpc.getRenameMethod) == null) {
      synchronized (RoutineCommandControllerGrpc.class) {
        if ((getRenameMethod = RoutineCommandControllerGrpc.getRenameMethod) == null) {
          RoutineCommandControllerGrpc.getRenameMethod = getRenameMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.RenameInput, ai.stigmer.agentic.routine.v1.Routine>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "rename"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.RenameInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.Routine.getDefaultInstance()))
              .setSchemaDescriptor(new RoutineCommandControllerMethodDescriptorSupplier("rename"))
              .build();
        }
      }
    }
    return getRenameMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.RoutineId,
      ai.stigmer.agentic.routine.v1.Routine> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.routine.v1.RoutineId.class,
      responseType = ai.stigmer.agentic.routine.v1.Routine.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.RoutineId,
      ai.stigmer.agentic.routine.v1.Routine> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.RoutineId, ai.stigmer.agentic.routine.v1.Routine> getDeleteMethod;
    if ((getDeleteMethod = RoutineCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (RoutineCommandControllerGrpc.class) {
        if ((getDeleteMethod = RoutineCommandControllerGrpc.getDeleteMethod) == null) {
          RoutineCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.routine.v1.RoutineId, ai.stigmer.agentic.routine.v1.Routine>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.RoutineId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.Routine.getDefaultInstance()))
              .setSchemaDescriptor(new RoutineCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.RoutineId,
      ai.stigmer.agentic.routine.v1.Routine> getResumeMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "resume",
      requestType = ai.stigmer.agentic.routine.v1.RoutineId.class,
      responseType = ai.stigmer.agentic.routine.v1.Routine.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.RoutineId,
      ai.stigmer.agentic.routine.v1.Routine> getResumeMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.RoutineId, ai.stigmer.agentic.routine.v1.Routine> getResumeMethod;
    if ((getResumeMethod = RoutineCommandControllerGrpc.getResumeMethod) == null) {
      synchronized (RoutineCommandControllerGrpc.class) {
        if ((getResumeMethod = RoutineCommandControllerGrpc.getResumeMethod) == null) {
          RoutineCommandControllerGrpc.getResumeMethod = getResumeMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.routine.v1.RoutineId, ai.stigmer.agentic.routine.v1.Routine>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "resume"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.RoutineId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.Routine.getDefaultInstance()))
              .setSchemaDescriptor(new RoutineCommandControllerMethodDescriptorSupplier("resume"))
              .build();
        }
      }
    }
    return getResumeMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.FireRoutineInput,
      ai.stigmer.agentic.routine.v1.RoutineFireResult> getFireMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "fire",
      requestType = ai.stigmer.agentic.routine.v1.FireRoutineInput.class,
      responseType = ai.stigmer.agentic.routine.v1.RoutineFireResult.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.FireRoutineInput,
      ai.stigmer.agentic.routine.v1.RoutineFireResult> getFireMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.routine.v1.FireRoutineInput, ai.stigmer.agentic.routine.v1.RoutineFireResult> getFireMethod;
    if ((getFireMethod = RoutineCommandControllerGrpc.getFireMethod) == null) {
      synchronized (RoutineCommandControllerGrpc.class) {
        if ((getFireMethod = RoutineCommandControllerGrpc.getFireMethod) == null) {
          RoutineCommandControllerGrpc.getFireMethod = getFireMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.routine.v1.FireRoutineInput, ai.stigmer.agentic.routine.v1.RoutineFireResult>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "fire"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.FireRoutineInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.routine.v1.RoutineFireResult.getDefaultInstance()))
              .setSchemaDescriptor(new RoutineCommandControllerMethodDescriptorSupplier("fire"))
              .build();
        }
      }
    }
    return getFireMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static RoutineCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RoutineCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RoutineCommandControllerStub>() {
        @java.lang.Override
        public RoutineCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RoutineCommandControllerStub(channel, callOptions);
        }
      };
    return RoutineCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static RoutineCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RoutineCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RoutineCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public RoutineCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RoutineCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return RoutineCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static RoutineCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RoutineCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RoutineCommandControllerBlockingStub>() {
        @java.lang.Override
        public RoutineCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RoutineCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return RoutineCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static RoutineCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<RoutineCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<RoutineCommandControllerFutureStub>() {
        @java.lang.Override
        public RoutineCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new RoutineCommandControllerFutureStub(channel, callOptions);
        }
      };
    return RoutineCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * RoutineCommandController handles write operations for routines.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update a routine.
     * A request that carries metadata.id of a routine in its organization
     * updates that routine, and its slug changes only through rename. A slug the
     * routine was renamed away from, named without the routine's id, is refused
     * with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail (domain
     * "stigmer.ai"), because a write by a name that stops resolving after 30 days
     * would later make a second routine:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     routine for reading, but a write names its current slug. Metadata:
     *     slug (the one the request named).
     * </pre>
     */
    default void apply(ai.stigmer.agentic.routine.v1.Routine request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a routine.
     * Creating a routine is a spending decision: every run calls models on the
     * organization's own provider keys, unattended, and the providers bill the
     * organization for them. Every run acts as the routine's creator, its
     * owner.
     * A slug another routine of the organization holds is refused with
     * ALREADY_EXISTS. A slug another routine was renamed away from, which still
     * leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another routine held the slug until a recent rename,
     *     and it still leads there. Metadata: slug.
     * </pre>
     */
    default void create(ai.stigmer.agentic.routine.v1.Routine request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update a routine: the fields update_mask names change, every other
     * field keeps its stored value.
     * The referenced agent is immutable; the schedule, time zone, enablement
     * and the message may change. Only the routine's owner may change what it
     * runs (anything in spec but switching it off); whoever else may manage it
     * may switch it off, rename, relabel or delete it, and is refused
     * otherwise with PERMISSION_DENIED. Status (firing observations, the
     * platform pause) is never touched by updates: use resume to clear a
     * platform pause.
     * resource.metadata.id names the routine; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the routine does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the routine changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the routine kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    default void update(ai.stigmer.agentic.routine.v1.UpdateRoutineInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Rename a routine: change its slug, the name people type.
     * The routine keeps its id, so everything that names it keeps working, and
     * every answer names it by the new slug. The old slug keeps leading to the
     * routine for reading for 30 days, during which no other routine of the
     * organization can take it and this one can take it back; then it is
     * released. A write that names the old slug is refused with SLUG_RENAMED (see
     * apply). A slug another routine holds is refused with ALREADY_EXISTS, and
     * one another routine was recently renamed away from with SLUG_RESERVED (see
     * create).
     * Its schedule keeps its times; a conversation an earlier run started keeps
     * the name it was given then.
     * </pre>
     */
    default void rename(ai.stigmer.commons.apiresource.RenameInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRenameMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a routine.
     * The routine stops permanently. Runs it started are untouched. To stop it
     * while keeping the routine and its history, disable it (enabled=false)
     * instead. Deleting the routine's agent deletes the routine too.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.routine.v1.RoutineId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Resume a routine the platform paused after repeated run failures.
     * Clears status.paused_reason, resets status.consecutive_failures,
     * and re-arms its schedule. Resuming a routine that is not paused
     * succeeds and changes nothing. A disabled routine stays disabled:
     * resume clears the platform's pause, not the owner's switch
     * (spec.enabled).
     * </pre>
     */
    default void resume(ai.stigmer.agentic.routine.v1.RoutineId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getResumeMethod(), responseObserver);
    }

    /**
     * <pre>
     * Fire a routine once, immediately, and answer with the run's real
     * outcome.
     * The run acts as the routine's owner and starts a new conversation, with
     * the routine's message. `text`, when set, is appended inside a block that
     * tells the agent it is information from whoever started the run, not
     * instructions: the routine's own message decides what to do with it.
     * Each call is its own run, even two in one second; a caller that retries
     * starts a second run.
     * The fire runs synchronously through the standard run create pipeline
     * (every launch gate runs), and the result names what happened: the
     * created run's id, or the refusing gate's own copy verbatim.
     * status.last_fire_at and status.last_run_id record a started run. A fire
     * does NOT feed the failure streak: the streak is the schedule's
     * unattended health signal, and a test fire of a broken routine must not
     * race its owner to the pause threshold.
     * A disabled routine refuses (enable it first). A platform-paused routine
     * MAY be fired: a test fire is exactly how an owner verifies a fix before
     * resuming; resume remains the one path that clears the pause. A routine
     * started by hand as often as the server allows in an hour (30 by
     * default) refuses until the hour has room again; the routine's own
     * schedule is never limited by it.
     * </pre>
     */
    default void fire(ai.stigmer.agentic.routine.v1.FireRoutineInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.RoutineFireResult> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getFireMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service RoutineCommandController.
   * <pre>
   * RoutineCommandController handles write operations for routines.
   * </pre>
   */
  public static abstract class RoutineCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return RoutineCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service RoutineCommandController.
   * <pre>
   * RoutineCommandController handles write operations for routines.
   * </pre>
   */
  public static final class RoutineCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<RoutineCommandControllerStub> {
    private RoutineCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RoutineCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RoutineCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a routine.
     * A request that carries metadata.id of a routine in its organization
     * updates that routine, and its slug changes only through rename. A slug the
     * routine was renamed away from, named without the routine's id, is refused
     * with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail (domain
     * "stigmer.ai"), because a write by a name that stops resolving after 30 days
     * would later make a second routine:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     routine for reading, but a write names its current slug. Metadata:
     *     slug (the one the request named).
     * </pre>
     */
    public void apply(ai.stigmer.agentic.routine.v1.Routine request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a routine.
     * Creating a routine is a spending decision: every run calls models on the
     * organization's own provider keys, unattended, and the providers bill the
     * organization for them. Every run acts as the routine's creator, its
     * owner.
     * A slug another routine of the organization holds is refused with
     * ALREADY_EXISTS. A slug another routine was renamed away from, which still
     * leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another routine held the slug until a recent rename,
     *     and it still leads there. Metadata: slug.
     * </pre>
     */
    public void create(ai.stigmer.agentic.routine.v1.Routine request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update a routine: the fields update_mask names change, every other
     * field keeps its stored value.
     * The referenced agent is immutable; the schedule, time zone, enablement
     * and the message may change. Only the routine's owner may change what it
     * runs (anything in spec but switching it off); whoever else may manage it
     * may switch it off, rename, relabel or delete it, and is refused
     * otherwise with PERMISSION_DENIED. Status (firing observations, the
     * platform pause) is never touched by updates: use resume to clear a
     * platform pause.
     * resource.metadata.id names the routine; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the routine does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the routine changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the routine kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public void update(ai.stigmer.agentic.routine.v1.UpdateRoutineInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Rename a routine: change its slug, the name people type.
     * The routine keeps its id, so everything that names it keeps working, and
     * every answer names it by the new slug. The old slug keeps leading to the
     * routine for reading for 30 days, during which no other routine of the
     * organization can take it and this one can take it back; then it is
     * released. A write that names the old slug is refused with SLUG_RENAMED (see
     * apply). A slug another routine holds is refused with ALREADY_EXISTS, and
     * one another routine was recently renamed away from with SLUG_RESERVED (see
     * create).
     * Its schedule keeps its times; a conversation an earlier run started keeps
     * the name it was given then.
     * </pre>
     */
    public void rename(ai.stigmer.commons.apiresource.RenameInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRenameMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a routine.
     * The routine stops permanently. Runs it started are untouched. To stop it
     * while keeping the routine and its history, disable it (enabled=false)
     * instead. Deleting the routine's agent deletes the routine too.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.routine.v1.RoutineId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Resume a routine the platform paused after repeated run failures.
     * Clears status.paused_reason, resets status.consecutive_failures,
     * and re-arms its schedule. Resuming a routine that is not paused
     * succeeds and changes nothing. A disabled routine stays disabled:
     * resume clears the platform's pause, not the owner's switch
     * (spec.enabled).
     * </pre>
     */
    public void resume(ai.stigmer.agentic.routine.v1.RoutineId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getResumeMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Fire a routine once, immediately, and answer with the run's real
     * outcome.
     * The run acts as the routine's owner and starts a new conversation, with
     * the routine's message. `text`, when set, is appended inside a block that
     * tells the agent it is information from whoever started the run, not
     * instructions: the routine's own message decides what to do with it.
     * Each call is its own run, even two in one second; a caller that retries
     * starts a second run.
     * The fire runs synchronously through the standard run create pipeline
     * (every launch gate runs), and the result names what happened: the
     * created run's id, or the refusing gate's own copy verbatim.
     * status.last_fire_at and status.last_run_id record a started run. A fire
     * does NOT feed the failure streak: the streak is the schedule's
     * unattended health signal, and a test fire of a broken routine must not
     * race its owner to the pause threshold.
     * A disabled routine refuses (enable it first). A platform-paused routine
     * MAY be fired: a test fire is exactly how an owner verifies a fix before
     * resuming; resume remains the one path that clears the pause. A routine
     * started by hand as often as the server allows in an hour (30 by
     * default) refuses until the hour has room again; the routine's own
     * schedule is never limited by it.
     * </pre>
     */
    public void fire(ai.stigmer.agentic.routine.v1.FireRoutineInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.RoutineFireResult> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getFireMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service RoutineCommandController.
   * <pre>
   * RoutineCommandController handles write operations for routines.
   * </pre>
   */
  public static final class RoutineCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<RoutineCommandControllerBlockingV2Stub> {
    private RoutineCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RoutineCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RoutineCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a routine.
     * A request that carries metadata.id of a routine in its organization
     * updates that routine, and its slug changes only through rename. A slug the
     * routine was renamed away from, named without the routine's id, is refused
     * with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail (domain
     * "stigmer.ai"), because a write by a name that stops resolving after 30 days
     * would later make a second routine:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     routine for reading, but a write names its current slug. Metadata:
     *     slug (the one the request named).
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.Routine apply(ai.stigmer.agentic.routine.v1.Routine request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a routine.
     * Creating a routine is a spending decision: every run calls models on the
     * organization's own provider keys, unattended, and the providers bill the
     * organization for them. Every run acts as the routine's creator, its
     * owner.
     * A slug another routine of the organization holds is refused with
     * ALREADY_EXISTS. A slug another routine was renamed away from, which still
     * leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another routine held the slug until a recent rename,
     *     and it still leads there. Metadata: slug.
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.Routine create(ai.stigmer.agentic.routine.v1.Routine request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a routine: the fields update_mask names change, every other
     * field keeps its stored value.
     * The referenced agent is immutable; the schedule, time zone, enablement
     * and the message may change. Only the routine's owner may change what it
     * runs (anything in spec but switching it off); whoever else may manage it
     * may switch it off, rename, relabel or delete it, and is refused
     * otherwise with PERMISSION_DENIED. Status (firing observations, the
     * platform pause) is never touched by updates: use resume to clear a
     * platform pause.
     * resource.metadata.id names the routine; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the routine does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the routine changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the routine kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.Routine update(ai.stigmer.agentic.routine.v1.UpdateRoutineInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rename a routine: change its slug, the name people type.
     * The routine keeps its id, so everything that names it keeps working, and
     * every answer names it by the new slug. The old slug keeps leading to the
     * routine for reading for 30 days, during which no other routine of the
     * organization can take it and this one can take it back; then it is
     * released. A write that names the old slug is refused with SLUG_RENAMED (see
     * apply). A slug another routine holds is refused with ALREADY_EXISTS, and
     * one another routine was recently renamed away from with SLUG_RESERVED (see
     * create).
     * Its schedule keeps its times; a conversation an earlier run started keeps
     * the name it was given then.
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.Routine rename(ai.stigmer.commons.apiresource.RenameInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRenameMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a routine.
     * The routine stops permanently. Runs it started are untouched. To stop it
     * while keeping the routine and its history, disable it (enabled=false)
     * instead. Deleting the routine's agent deletes the routine too.
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.Routine delete(ai.stigmer.agentic.routine.v1.RoutineId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Resume a routine the platform paused after repeated run failures.
     * Clears status.paused_reason, resets status.consecutive_failures,
     * and re-arms its schedule. Resuming a routine that is not paused
     * succeeds and changes nothing. A disabled routine stays disabled:
     * resume clears the platform's pause, not the owner's switch
     * (spec.enabled).
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.Routine resume(ai.stigmer.agentic.routine.v1.RoutineId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getResumeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Fire a routine once, immediately, and answer with the run's real
     * outcome.
     * The run acts as the routine's owner and starts a new conversation, with
     * the routine's message. `text`, when set, is appended inside a block that
     * tells the agent it is information from whoever started the run, not
     * instructions: the routine's own message decides what to do with it.
     * Each call is its own run, even two in one second; a caller that retries
     * starts a second run.
     * The fire runs synchronously through the standard run create pipeline
     * (every launch gate runs), and the result names what happened: the
     * created run's id, or the refusing gate's own copy verbatim.
     * status.last_fire_at and status.last_run_id record a started run. A fire
     * does NOT feed the failure streak: the streak is the schedule's
     * unattended health signal, and a test fire of a broken routine must not
     * race its owner to the pause threshold.
     * A disabled routine refuses (enable it first). A platform-paused routine
     * MAY be fired: a test fire is exactly how an owner verifies a fix before
     * resuming; resume remains the one path that clears the pause. A routine
     * started by hand as often as the server allows in an hour (30 by
     * default) refuses until the hour has room again; the routine's own
     * schedule is never limited by it.
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.RoutineFireResult fire(ai.stigmer.agentic.routine.v1.FireRoutineInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getFireMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service RoutineCommandController.
   * <pre>
   * RoutineCommandController handles write operations for routines.
   * </pre>
   */
  public static final class RoutineCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<RoutineCommandControllerBlockingStub> {
    private RoutineCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RoutineCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RoutineCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a routine.
     * A request that carries metadata.id of a routine in its organization
     * updates that routine, and its slug changes only through rename. A slug the
     * routine was renamed away from, named without the routine's id, is refused
     * with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail (domain
     * "stigmer.ai"), because a write by a name that stops resolving after 30 days
     * would later make a second routine:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     routine for reading, but a write names its current slug. Metadata:
     *     slug (the one the request named).
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.Routine apply(ai.stigmer.agentic.routine.v1.Routine request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a routine.
     * Creating a routine is a spending decision: every run calls models on the
     * organization's own provider keys, unattended, and the providers bill the
     * organization for them. Every run acts as the routine's creator, its
     * owner.
     * A slug another routine of the organization holds is refused with
     * ALREADY_EXISTS. A slug another routine was renamed away from, which still
     * leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another routine held the slug until a recent rename,
     *     and it still leads there. Metadata: slug.
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.Routine create(ai.stigmer.agentic.routine.v1.Routine request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update a routine: the fields update_mask names change, every other
     * field keeps its stored value.
     * The referenced agent is immutable; the schedule, time zone, enablement
     * and the message may change. Only the routine's owner may change what it
     * runs (anything in spec but switching it off); whoever else may manage it
     * may switch it off, rename, relabel or delete it, and is refused
     * otherwise with PERMISSION_DENIED. Status (firing observations, the
     * platform pause) is never touched by updates: use resume to clear a
     * platform pause.
     * resource.metadata.id names the routine; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the routine does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the routine changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the routine kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.Routine update(ai.stigmer.agentic.routine.v1.UpdateRoutineInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Rename a routine: change its slug, the name people type.
     * The routine keeps its id, so everything that names it keeps working, and
     * every answer names it by the new slug. The old slug keeps leading to the
     * routine for reading for 30 days, during which no other routine of the
     * organization can take it and this one can take it back; then it is
     * released. A write that names the old slug is refused with SLUG_RENAMED (see
     * apply). A slug another routine holds is refused with ALREADY_EXISTS, and
     * one another routine was recently renamed away from with SLUG_RESERVED (see
     * create).
     * Its schedule keeps its times; a conversation an earlier run started keeps
     * the name it was given then.
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.Routine rename(ai.stigmer.commons.apiresource.RenameInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRenameMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a routine.
     * The routine stops permanently. Runs it started are untouched. To stop it
     * while keeping the routine and its history, disable it (enabled=false)
     * instead. Deleting the routine's agent deletes the routine too.
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.Routine delete(ai.stigmer.agentic.routine.v1.RoutineId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Resume a routine the platform paused after repeated run failures.
     * Clears status.paused_reason, resets status.consecutive_failures,
     * and re-arms its schedule. Resuming a routine that is not paused
     * succeeds and changes nothing. A disabled routine stays disabled:
     * resume clears the platform's pause, not the owner's switch
     * (spec.enabled).
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.Routine resume(ai.stigmer.agentic.routine.v1.RoutineId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getResumeMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Fire a routine once, immediately, and answer with the run's real
     * outcome.
     * The run acts as the routine's owner and starts a new conversation, with
     * the routine's message. `text`, when set, is appended inside a block that
     * tells the agent it is information from whoever started the run, not
     * instructions: the routine's own message decides what to do with it.
     * Each call is its own run, even two in one second; a caller that retries
     * starts a second run.
     * The fire runs synchronously through the standard run create pipeline
     * (every launch gate runs), and the result names what happened: the
     * created run's id, or the refusing gate's own copy verbatim.
     * status.last_fire_at and status.last_run_id record a started run. A fire
     * does NOT feed the failure streak: the streak is the schedule's
     * unattended health signal, and a test fire of a broken routine must not
     * race its owner to the pause threshold.
     * A disabled routine refuses (enable it first). A platform-paused routine
     * MAY be fired: a test fire is exactly how an owner verifies a fix before
     * resuming; resume remains the one path that clears the pause. A routine
     * started by hand as often as the server allows in an hour (30 by
     * default) refuses until the hour has room again; the routine's own
     * schedule is never limited by it.
     * </pre>
     */
    public ai.stigmer.agentic.routine.v1.RoutineFireResult fire(ai.stigmer.agentic.routine.v1.FireRoutineInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getFireMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service RoutineCommandController.
   * <pre>
   * RoutineCommandController handles write operations for routines.
   * </pre>
   */
  public static final class RoutineCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<RoutineCommandControllerFutureStub> {
    private RoutineCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected RoutineCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new RoutineCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a routine.
     * A request that carries metadata.id of a routine in its organization
     * updates that routine, and its slug changes only through rename. A slug the
     * routine was renamed away from, named without the routine's id, is refused
     * with FAILED_PRECONDITION carrying a google.rpc.ErrorInfo detail (domain
     * "stigmer.ai"), because a write by a name that stops resolving after 30 days
     * would later make a second routine:
     *   - SLUG_RENAMED — the slug was renamed: it still leads to the same
     *     routine for reading, but a write names its current slug. Metadata:
     *     slug (the one the request named).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.routine.v1.Routine> apply(
        ai.stigmer.agentic.routine.v1.Routine request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a routine.
     * Creating a routine is a spending decision: every run calls models on the
     * organization's own provider keys, unattended, and the providers bill the
     * organization for them. Every run acts as the routine's creator, its
     * owner.
     * A slug another routine of the organization holds is refused with
     * ALREADY_EXISTS. A slug another routine was renamed away from, which still
     * leads to it for 30 days, is refused with ALREADY_EXISTS carrying a
     * google.rpc.ErrorInfo detail (domain "stigmer.ai"):
     *   - SLUG_RESERVED — another routine held the slug until a recent rename,
     *     and it still leads there. Metadata: slug.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.routine.v1.Routine> create(
        ai.stigmer.agentic.routine.v1.Routine request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update a routine: the fields update_mask names change, every other
     * field keeps its stored value.
     * The referenced agent is immutable; the schedule, time zone, enablement
     * and the message may change. Only the routine's owner may change what it
     * runs (anything in spec but switching it off); whoever else may manage it
     * may switch it off, rename, relabel or delete it, and is refused
     * otherwise with PERMISSION_DENIED. Status (firing observations, the
     * platform pause) is never touched by updates: use resume to clear a
     * platform pause.
     * resource.metadata.id names the routine; apply finds one by slug. The slug
     * changes only through rename, and a mask naming a field another door
     * owns, or a path the routine does not have, is refused with
     * INVALID_ARGUMENT naming the path.
     * An update is refused with ABORTED carrying a google.rpc.ErrorInfo detail
     * (domain "stigmer.ai"):
     *   - ETAG_MISMATCH — resource.metadata.etag is set and the routine changed
     *     since that etag was read: read it again and make the change again.
     *     No metadata.
     *   - WRITE_CONFLICT — the routine kept changing while the update was
     *     being saved: try again. No metadata.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.routine.v1.Routine> update(
        ai.stigmer.agentic.routine.v1.UpdateRoutineInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Rename a routine: change its slug, the name people type.
     * The routine keeps its id, so everything that names it keeps working, and
     * every answer names it by the new slug. The old slug keeps leading to the
     * routine for reading for 30 days, during which no other routine of the
     * organization can take it and this one can take it back; then it is
     * released. A write that names the old slug is refused with SLUG_RENAMED (see
     * apply). A slug another routine holds is refused with ALREADY_EXISTS, and
     * one another routine was recently renamed away from with SLUG_RESERVED (see
     * create).
     * Its schedule keeps its times; a conversation an earlier run started keeps
     * the name it was given then.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.routine.v1.Routine> rename(
        ai.stigmer.commons.apiresource.RenameInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRenameMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a routine.
     * The routine stops permanently. Runs it started are untouched. To stop it
     * while keeping the routine and its history, disable it (enabled=false)
     * instead. Deleting the routine's agent deletes the routine too.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.routine.v1.Routine> delete(
        ai.stigmer.agentic.routine.v1.RoutineId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Resume a routine the platform paused after repeated run failures.
     * Clears status.paused_reason, resets status.consecutive_failures,
     * and re-arms its schedule. Resuming a routine that is not paused
     * succeeds and changes nothing. A disabled routine stays disabled:
     * resume clears the platform's pause, not the owner's switch
     * (spec.enabled).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.routine.v1.Routine> resume(
        ai.stigmer.agentic.routine.v1.RoutineId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getResumeMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Fire a routine once, immediately, and answer with the run's real
     * outcome.
     * The run acts as the routine's owner and starts a new conversation, with
     * the routine's message. `text`, when set, is appended inside a block that
     * tells the agent it is information from whoever started the run, not
     * instructions: the routine's own message decides what to do with it.
     * Each call is its own run, even two in one second; a caller that retries
     * starts a second run.
     * The fire runs synchronously through the standard run create pipeline
     * (every launch gate runs), and the result names what happened: the
     * created run's id, or the refusing gate's own copy verbatim.
     * status.last_fire_at and status.last_run_id record a started run. A fire
     * does NOT feed the failure streak: the streak is the schedule's
     * unattended health signal, and a test fire of a broken routine must not
     * race its owner to the pause threshold.
     * A disabled routine refuses (enable it first). A platform-paused routine
     * MAY be fired: a test fire is exactly how an owner verifies a fix before
     * resuming; resume remains the one path that clears the pause. A routine
     * started by hand as often as the server allows in an hour (30 by
     * default) refuses until the hour has room again; the routine's own
     * schedule is never limited by it.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.routine.v1.RoutineFireResult> fire(
        ai.stigmer.agentic.routine.v1.FireRoutineInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getFireMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_RENAME = 3;
  private static final int METHODID_DELETE = 4;
  private static final int METHODID_RESUME = 5;
  private static final int METHODID_FIRE = 6;

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
          serviceImpl.apply((ai.stigmer.agentic.routine.v1.Routine) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.routine.v1.Routine) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.routine.v1.UpdateRoutineInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine>) responseObserver);
          break;
        case METHODID_RENAME:
          serviceImpl.rename((ai.stigmer.commons.apiresource.RenameInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.routine.v1.RoutineId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine>) responseObserver);
          break;
        case METHODID_RESUME:
          serviceImpl.resume((ai.stigmer.agentic.routine.v1.RoutineId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.Routine>) responseObserver);
          break;
        case METHODID_FIRE:
          serviceImpl.fire((ai.stigmer.agentic.routine.v1.FireRoutineInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.routine.v1.RoutineFireResult>) responseObserver);
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
              ai.stigmer.agentic.routine.v1.Routine,
              ai.stigmer.agentic.routine.v1.Routine>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.routine.v1.Routine,
              ai.stigmer.agentic.routine.v1.Routine>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.routine.v1.UpdateRoutineInput,
              ai.stigmer.agentic.routine.v1.Routine>(
                service, METHODID_UPDATE)))
        .addMethod(
          getRenameMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.RenameInput,
              ai.stigmer.agentic.routine.v1.Routine>(
                service, METHODID_RENAME)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.routine.v1.RoutineId,
              ai.stigmer.agentic.routine.v1.Routine>(
                service, METHODID_DELETE)))
        .addMethod(
          getResumeMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.routine.v1.RoutineId,
              ai.stigmer.agentic.routine.v1.Routine>(
                service, METHODID_RESUME)))
        .addMethod(
          getFireMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.routine.v1.FireRoutineInput,
              ai.stigmer.agentic.routine.v1.RoutineFireResult>(
                service, METHODID_FIRE)))
        .build();
  }

  private static abstract class RoutineCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    RoutineCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.routine.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("RoutineCommandController");
    }
  }

  private static final class RoutineCommandControllerFileDescriptorSupplier
      extends RoutineCommandControllerBaseDescriptorSupplier {
    RoutineCommandControllerFileDescriptorSupplier() {}
  }

  private static final class RoutineCommandControllerMethodDescriptorSupplier
      extends RoutineCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    RoutineCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (RoutineCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new RoutineCommandControllerFileDescriptorSupplier())
              .addMethod(getApplyMethod())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getRenameMethod())
              .addMethod(getDeleteMethod())
              .addMethod(getResumeMethod())
              .addMethod(getFireMethod())
              .build();
        }
      }
    }
    return result;
  }
}
