package ai.stigmer.agentic.schedule.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * ScheduleCommandController handles write operations for schedules.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class ScheduleCommandControllerGrpc {

  private ScheduleCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.schedule.v1.ScheduleCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.schedule.v1.Schedule,
      ai.stigmer.agentic.schedule.v1.Schedule> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.agentic.schedule.v1.Schedule.class,
      responseType = ai.stigmer.agentic.schedule.v1.Schedule.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.schedule.v1.Schedule,
      ai.stigmer.agentic.schedule.v1.Schedule> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.schedule.v1.Schedule, ai.stigmer.agentic.schedule.v1.Schedule> getApplyMethod;
    if ((getApplyMethod = ScheduleCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (ScheduleCommandControllerGrpc.class) {
        if ((getApplyMethod = ScheduleCommandControllerGrpc.getApplyMethod) == null) {
          ScheduleCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.schedule.v1.Schedule, ai.stigmer.agentic.schedule.v1.Schedule>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.schedule.v1.Schedule.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.schedule.v1.Schedule.getDefaultInstance()))
              .setSchemaDescriptor(new ScheduleCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.schedule.v1.Schedule,
      ai.stigmer.agentic.schedule.v1.Schedule> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.schedule.v1.Schedule.class,
      responseType = ai.stigmer.agentic.schedule.v1.Schedule.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.schedule.v1.Schedule,
      ai.stigmer.agentic.schedule.v1.Schedule> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.schedule.v1.Schedule, ai.stigmer.agentic.schedule.v1.Schedule> getCreateMethod;
    if ((getCreateMethod = ScheduleCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (ScheduleCommandControllerGrpc.class) {
        if ((getCreateMethod = ScheduleCommandControllerGrpc.getCreateMethod) == null) {
          ScheduleCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.schedule.v1.Schedule, ai.stigmer.agentic.schedule.v1.Schedule>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.schedule.v1.Schedule.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.schedule.v1.Schedule.getDefaultInstance()))
              .setSchemaDescriptor(new ScheduleCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.schedule.v1.Schedule,
      ai.stigmer.agentic.schedule.v1.Schedule> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.schedule.v1.Schedule.class,
      responseType = ai.stigmer.agentic.schedule.v1.Schedule.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.schedule.v1.Schedule,
      ai.stigmer.agentic.schedule.v1.Schedule> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.schedule.v1.Schedule, ai.stigmer.agentic.schedule.v1.Schedule> getUpdateMethod;
    if ((getUpdateMethod = ScheduleCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (ScheduleCommandControllerGrpc.class) {
        if ((getUpdateMethod = ScheduleCommandControllerGrpc.getUpdateMethod) == null) {
          ScheduleCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.schedule.v1.Schedule, ai.stigmer.agentic.schedule.v1.Schedule>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.schedule.v1.Schedule.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.schedule.v1.Schedule.getDefaultInstance()))
              .setSchemaDescriptor(new ScheduleCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.schedule.v1.ScheduleId,
      ai.stigmer.agentic.schedule.v1.Schedule> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.schedule.v1.ScheduleId.class,
      responseType = ai.stigmer.agentic.schedule.v1.Schedule.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.schedule.v1.ScheduleId,
      ai.stigmer.agentic.schedule.v1.Schedule> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.schedule.v1.ScheduleId, ai.stigmer.agentic.schedule.v1.Schedule> getDeleteMethod;
    if ((getDeleteMethod = ScheduleCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (ScheduleCommandControllerGrpc.class) {
        if ((getDeleteMethod = ScheduleCommandControllerGrpc.getDeleteMethod) == null) {
          ScheduleCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.schedule.v1.ScheduleId, ai.stigmer.agentic.schedule.v1.Schedule>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.schedule.v1.ScheduleId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.schedule.v1.Schedule.getDefaultInstance()))
              .setSchemaDescriptor(new ScheduleCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static ScheduleCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScheduleCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScheduleCommandControllerStub>() {
        @java.lang.Override
        public ScheduleCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScheduleCommandControllerStub(channel, callOptions);
        }
      };
    return ScheduleCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static ScheduleCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScheduleCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScheduleCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public ScheduleCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScheduleCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return ScheduleCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static ScheduleCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScheduleCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScheduleCommandControllerBlockingStub>() {
        @java.lang.Override
        public ScheduleCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScheduleCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return ScheduleCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static ScheduleCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<ScheduleCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<ScheduleCommandControllerFutureStub>() {
        @java.lang.Override
        public ScheduleCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new ScheduleCommandControllerFutureStub(channel, callOptions);
        }
      };
    return ScheduleCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * ScheduleCommandController handles write operations for schedules.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update a schedule.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the schedule is going to be created or updated, resolved as
     * part of request execution. Status is preserved verbatim across
     * apply-as-update (the AgentChannel decision-004 posture): the
     * scheduling runtime is status's sole writer, and a routine manifest
     * apply must never reset the failure streak or un-pause an
     * auto-paused schedule (DD-008 D7 / DD-009 pinned behaviors).
     * </pre>
     */
    default void apply(ai.stigmer.agentic.schedule.v1.Schedule request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.Schedule> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a schedule.
     * Scheduling an agent is a billing-affecting decision: every fire
     * creates an execution that consumes the schedule-owning
     * organization's credits, unattended.
     * &#64;internal
     * Authorization: requires can_edit on the REFERENCED AGENT
     * (spec.agent.agent_ref), checked in-handler — the AgentChannel /
     * same-org AgentShare Phase A bar (DD-009 C-6): whoever may edit the
     * agent may schedule it; there is deliberately no org-level
     * can_create_schedule permission. Standard org-scoped create tuples
     * (owner = creator); no visibility tuples (the kind has no visibility
     * block). Invariant enforced here: metadata.org must equal
     * spec.agent.agent_ref.org.
     * </pre>
     */
    default void create(ai.stigmer.agentic.schedule.v1.Schedule request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.Schedule> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing schedule.
     * Replaces the spec wholesale. The slug, the referenced agent, and the
     * target arm are immutable; cron, time zone, enablement, and the
     * message may all change. Status (firing observations, auto-pause) is
     * never touched by updates.
     * &#64;internal
     * Authorization: requires can_edit permission on the schedule.
     * agent_ref immutability is a consent-bar guarantee, not convenience
     * (DD-009 C-7): create's bar is can_edit on the REFERENCED agent, and
     * a repointing update would let a schedule owner drive an agent they
     * may not edit — the AgentChannel rule for the AgentChannel reason.
     * Target-arm immutability (an agent schedule cannot become a workflow
     * schedule once that arm exists) is enforced in-handler: the two
     * targets enter different execution pipelines. When the clock lands,
     * an update touching the spec also clears a platform auto-pause
     * through the ensure-on-mutate path (DD-008 D7/D9).
     * </pre>
     */
    default void update(ai.stigmer.agentic.schedule.v1.Schedule request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.Schedule> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a schedule.
     * Firing stops permanently. Executions created by past fires are
     * untouched. To pause firing while keeping the schedule and its
     * history, update it with enabled=false instead.
     * &#64;internal
     * Authorization: requires can_delete permission on the schedule. The
     * referenced agent is untouched. The Temporal artifact teardown
     * (best-effort, AFTER the row delete — DD-008 D9) arrives with the
     * clock; until then delete is the row alone, and an orphaned artifact
     * is harmless by construction (fire-time revalidation no-ops it).
     * </pre>
     */
    default void delete(ai.stigmer.agentic.schedule.v1.ScheduleId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.Schedule> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service ScheduleCommandController.
   * <pre>
   * ScheduleCommandController handles write operations for schedules.
   * </pre>
   */
  public static abstract class ScheduleCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return ScheduleCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service ScheduleCommandController.
   * <pre>
   * ScheduleCommandController handles write operations for schedules.
   * </pre>
   */
  public static final class ScheduleCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<ScheduleCommandControllerStub> {
    private ScheduleCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScheduleCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScheduleCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a schedule.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the schedule is going to be created or updated, resolved as
     * part of request execution. Status is preserved verbatim across
     * apply-as-update (the AgentChannel decision-004 posture): the
     * scheduling runtime is status's sole writer, and a routine manifest
     * apply must never reset the failure streak or un-pause an
     * auto-paused schedule (DD-008 D7 / DD-009 pinned behaviors).
     * </pre>
     */
    public void apply(ai.stigmer.agentic.schedule.v1.Schedule request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.Schedule> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a schedule.
     * Scheduling an agent is a billing-affecting decision: every fire
     * creates an execution that consumes the schedule-owning
     * organization's credits, unattended.
     * &#64;internal
     * Authorization: requires can_edit on the REFERENCED AGENT
     * (spec.agent.agent_ref), checked in-handler — the AgentChannel /
     * same-org AgentShare Phase A bar (DD-009 C-6): whoever may edit the
     * agent may schedule it; there is deliberately no org-level
     * can_create_schedule permission. Standard org-scoped create tuples
     * (owner = creator); no visibility tuples (the kind has no visibility
     * block). Invariant enforced here: metadata.org must equal
     * spec.agent.agent_ref.org.
     * </pre>
     */
    public void create(ai.stigmer.agentic.schedule.v1.Schedule request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.Schedule> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing schedule.
     * Replaces the spec wholesale. The slug, the referenced agent, and the
     * target arm are immutable; cron, time zone, enablement, and the
     * message may all change. Status (firing observations, auto-pause) is
     * never touched by updates.
     * &#64;internal
     * Authorization: requires can_edit permission on the schedule.
     * agent_ref immutability is a consent-bar guarantee, not convenience
     * (DD-009 C-7): create's bar is can_edit on the REFERENCED agent, and
     * a repointing update would let a schedule owner drive an agent they
     * may not edit — the AgentChannel rule for the AgentChannel reason.
     * Target-arm immutability (an agent schedule cannot become a workflow
     * schedule once that arm exists) is enforced in-handler: the two
     * targets enter different execution pipelines. When the clock lands,
     * an update touching the spec also clears a platform auto-pause
     * through the ensure-on-mutate path (DD-008 D7/D9).
     * </pre>
     */
    public void update(ai.stigmer.agentic.schedule.v1.Schedule request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.Schedule> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a schedule.
     * Firing stops permanently. Executions created by past fires are
     * untouched. To pause firing while keeping the schedule and its
     * history, update it with enabled=false instead.
     * &#64;internal
     * Authorization: requires can_delete permission on the schedule. The
     * referenced agent is untouched. The Temporal artifact teardown
     * (best-effort, AFTER the row delete — DD-008 D9) arrives with the
     * clock; until then delete is the row alone, and an orphaned artifact
     * is harmless by construction (fire-time revalidation no-ops it).
     * </pre>
     */
    public void delete(ai.stigmer.agentic.schedule.v1.ScheduleId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.Schedule> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service ScheduleCommandController.
   * <pre>
   * ScheduleCommandController handles write operations for schedules.
   * </pre>
   */
  public static final class ScheduleCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<ScheduleCommandControllerBlockingV2Stub> {
    private ScheduleCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScheduleCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScheduleCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a schedule.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the schedule is going to be created or updated, resolved as
     * part of request execution. Status is preserved verbatim across
     * apply-as-update (the AgentChannel decision-004 posture): the
     * scheduling runtime is status's sole writer, and a routine manifest
     * apply must never reset the failure streak or un-pause an
     * auto-paused schedule (DD-008 D7 / DD-009 pinned behaviors).
     * </pre>
     */
    public ai.stigmer.agentic.schedule.v1.Schedule apply(ai.stigmer.agentic.schedule.v1.Schedule request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a schedule.
     * Scheduling an agent is a billing-affecting decision: every fire
     * creates an execution that consumes the schedule-owning
     * organization's credits, unattended.
     * &#64;internal
     * Authorization: requires can_edit on the REFERENCED AGENT
     * (spec.agent.agent_ref), checked in-handler — the AgentChannel /
     * same-org AgentShare Phase A bar (DD-009 C-6): whoever may edit the
     * agent may schedule it; there is deliberately no org-level
     * can_create_schedule permission. Standard org-scoped create tuples
     * (owner = creator); no visibility tuples (the kind has no visibility
     * block). Invariant enforced here: metadata.org must equal
     * spec.agent.agent_ref.org.
     * </pre>
     */
    public ai.stigmer.agentic.schedule.v1.Schedule create(ai.stigmer.agentic.schedule.v1.Schedule request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing schedule.
     * Replaces the spec wholesale. The slug, the referenced agent, and the
     * target arm are immutable; cron, time zone, enablement, and the
     * message may all change. Status (firing observations, auto-pause) is
     * never touched by updates.
     * &#64;internal
     * Authorization: requires can_edit permission on the schedule.
     * agent_ref immutability is a consent-bar guarantee, not convenience
     * (DD-009 C-7): create's bar is can_edit on the REFERENCED agent, and
     * a repointing update would let a schedule owner drive an agent they
     * may not edit — the AgentChannel rule for the AgentChannel reason.
     * Target-arm immutability (an agent schedule cannot become a workflow
     * schedule once that arm exists) is enforced in-handler: the two
     * targets enter different execution pipelines. When the clock lands,
     * an update touching the spec also clears a platform auto-pause
     * through the ensure-on-mutate path (DD-008 D7/D9).
     * </pre>
     */
    public ai.stigmer.agentic.schedule.v1.Schedule update(ai.stigmer.agentic.schedule.v1.Schedule request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a schedule.
     * Firing stops permanently. Executions created by past fires are
     * untouched. To pause firing while keeping the schedule and its
     * history, update it with enabled=false instead.
     * &#64;internal
     * Authorization: requires can_delete permission on the schedule. The
     * referenced agent is untouched. The Temporal artifact teardown
     * (best-effort, AFTER the row delete — DD-008 D9) arrives with the
     * clock; until then delete is the row alone, and an orphaned artifact
     * is harmless by construction (fire-time revalidation no-ops it).
     * </pre>
     */
    public ai.stigmer.agentic.schedule.v1.Schedule delete(ai.stigmer.agentic.schedule.v1.ScheduleId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service ScheduleCommandController.
   * <pre>
   * ScheduleCommandController handles write operations for schedules.
   * </pre>
   */
  public static final class ScheduleCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<ScheduleCommandControllerBlockingStub> {
    private ScheduleCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScheduleCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScheduleCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a schedule.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the schedule is going to be created or updated, resolved as
     * part of request execution. Status is preserved verbatim across
     * apply-as-update (the AgentChannel decision-004 posture): the
     * scheduling runtime is status's sole writer, and a routine manifest
     * apply must never reset the failure streak or un-pause an
     * auto-paused schedule (DD-008 D7 / DD-009 pinned behaviors).
     * </pre>
     */
    public ai.stigmer.agentic.schedule.v1.Schedule apply(ai.stigmer.agentic.schedule.v1.Schedule request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a schedule.
     * Scheduling an agent is a billing-affecting decision: every fire
     * creates an execution that consumes the schedule-owning
     * organization's credits, unattended.
     * &#64;internal
     * Authorization: requires can_edit on the REFERENCED AGENT
     * (spec.agent.agent_ref), checked in-handler — the AgentChannel /
     * same-org AgentShare Phase A bar (DD-009 C-6): whoever may edit the
     * agent may schedule it; there is deliberately no org-level
     * can_create_schedule permission. Standard org-scoped create tuples
     * (owner = creator); no visibility tuples (the kind has no visibility
     * block). Invariant enforced here: metadata.org must equal
     * spec.agent.agent_ref.org.
     * </pre>
     */
    public ai.stigmer.agentic.schedule.v1.Schedule create(ai.stigmer.agentic.schedule.v1.Schedule request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing schedule.
     * Replaces the spec wholesale. The slug, the referenced agent, and the
     * target arm are immutable; cron, time zone, enablement, and the
     * message may all change. Status (firing observations, auto-pause) is
     * never touched by updates.
     * &#64;internal
     * Authorization: requires can_edit permission on the schedule.
     * agent_ref immutability is a consent-bar guarantee, not convenience
     * (DD-009 C-7): create's bar is can_edit on the REFERENCED agent, and
     * a repointing update would let a schedule owner drive an agent they
     * may not edit — the AgentChannel rule for the AgentChannel reason.
     * Target-arm immutability (an agent schedule cannot become a workflow
     * schedule once that arm exists) is enforced in-handler: the two
     * targets enter different execution pipelines. When the clock lands,
     * an update touching the spec also clears a platform auto-pause
     * through the ensure-on-mutate path (DD-008 D7/D9).
     * </pre>
     */
    public ai.stigmer.agentic.schedule.v1.Schedule update(ai.stigmer.agentic.schedule.v1.Schedule request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a schedule.
     * Firing stops permanently. Executions created by past fires are
     * untouched. To pause firing while keeping the schedule and its
     * history, update it with enabled=false instead.
     * &#64;internal
     * Authorization: requires can_delete permission on the schedule. The
     * referenced agent is untouched. The Temporal artifact teardown
     * (best-effort, AFTER the row delete — DD-008 D9) arrives with the
     * clock; until then delete is the row alone, and an orphaned artifact
     * is harmless by construction (fire-time revalidation no-ops it).
     * </pre>
     */
    public ai.stigmer.agentic.schedule.v1.Schedule delete(ai.stigmer.agentic.schedule.v1.ScheduleId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service ScheduleCommandController.
   * <pre>
   * ScheduleCommandController handles write operations for schedules.
   * </pre>
   */
  public static final class ScheduleCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<ScheduleCommandControllerFutureStub> {
    private ScheduleCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected ScheduleCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new ScheduleCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a schedule.
     * &#64;internal
     * The authorization and state-operation are determined depending on
     * whether the schedule is going to be created or updated, resolved as
     * part of request execution. Status is preserved verbatim across
     * apply-as-update (the AgentChannel decision-004 posture): the
     * scheduling runtime is status's sole writer, and a routine manifest
     * apply must never reset the failure streak or un-pause an
     * auto-paused schedule (DD-008 D7 / DD-009 pinned behaviors).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.schedule.v1.Schedule> apply(
        ai.stigmer.agentic.schedule.v1.Schedule request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a schedule.
     * Scheduling an agent is a billing-affecting decision: every fire
     * creates an execution that consumes the schedule-owning
     * organization's credits, unattended.
     * &#64;internal
     * Authorization: requires can_edit on the REFERENCED AGENT
     * (spec.agent.agent_ref), checked in-handler — the AgentChannel /
     * same-org AgentShare Phase A bar (DD-009 C-6): whoever may edit the
     * agent may schedule it; there is deliberately no org-level
     * can_create_schedule permission. Standard org-scoped create tuples
     * (owner = creator); no visibility tuples (the kind has no visibility
     * block). Invariant enforced here: metadata.org must equal
     * spec.agent.agent_ref.org.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.schedule.v1.Schedule> create(
        ai.stigmer.agentic.schedule.v1.Schedule request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing schedule.
     * Replaces the spec wholesale. The slug, the referenced agent, and the
     * target arm are immutable; cron, time zone, enablement, and the
     * message may all change. Status (firing observations, auto-pause) is
     * never touched by updates.
     * &#64;internal
     * Authorization: requires can_edit permission on the schedule.
     * agent_ref immutability is a consent-bar guarantee, not convenience
     * (DD-009 C-7): create's bar is can_edit on the REFERENCED agent, and
     * a repointing update would let a schedule owner drive an agent they
     * may not edit — the AgentChannel rule for the AgentChannel reason.
     * Target-arm immutability (an agent schedule cannot become a workflow
     * schedule once that arm exists) is enforced in-handler: the two
     * targets enter different execution pipelines. When the clock lands,
     * an update touching the spec also clears a platform auto-pause
     * through the ensure-on-mutate path (DD-008 D7/D9).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.schedule.v1.Schedule> update(
        ai.stigmer.agentic.schedule.v1.Schedule request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a schedule.
     * Firing stops permanently. Executions created by past fires are
     * untouched. To pause firing while keeping the schedule and its
     * history, update it with enabled=false instead.
     * &#64;internal
     * Authorization: requires can_delete permission on the schedule. The
     * referenced agent is untouched. The Temporal artifact teardown
     * (best-effort, AFTER the row delete — DD-008 D9) arrives with the
     * clock; until then delete is the row alone, and an orphaned artifact
     * is harmless by construction (fire-time revalidation no-ops it).
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.schedule.v1.Schedule> delete(
        ai.stigmer.agentic.schedule.v1.ScheduleId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_DELETE = 3;

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
          serviceImpl.apply((ai.stigmer.agentic.schedule.v1.Schedule) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.Schedule>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.schedule.v1.Schedule) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.Schedule>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.schedule.v1.Schedule) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.Schedule>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.schedule.v1.ScheduleId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.schedule.v1.Schedule>) responseObserver);
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
              ai.stigmer.agentic.schedule.v1.Schedule,
              ai.stigmer.agentic.schedule.v1.Schedule>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.schedule.v1.Schedule,
              ai.stigmer.agentic.schedule.v1.Schedule>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.schedule.v1.Schedule,
              ai.stigmer.agentic.schedule.v1.Schedule>(
                service, METHODID_UPDATE)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.schedule.v1.ScheduleId,
              ai.stigmer.agentic.schedule.v1.Schedule>(
                service, METHODID_DELETE)))
        .build();
  }

  private static abstract class ScheduleCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    ScheduleCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.schedule.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("ScheduleCommandController");
    }
  }

  private static final class ScheduleCommandControllerFileDescriptorSupplier
      extends ScheduleCommandControllerBaseDescriptorSupplier {
    ScheduleCommandControllerFileDescriptorSupplier() {}
  }

  private static final class ScheduleCommandControllerMethodDescriptorSupplier
      extends ScheduleCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    ScheduleCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (ScheduleCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new ScheduleCommandControllerFileDescriptorSupplier())
              .addMethod(getApplyMethod())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getDeleteMethod())
              .build();
        }
      }
    }
    return result;
  }
}
