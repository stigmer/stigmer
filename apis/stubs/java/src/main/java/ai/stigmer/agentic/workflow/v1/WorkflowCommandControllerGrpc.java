package ai.stigmer.agentic.workflow.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * WorkflowCommandController handles write operations for workflows.
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class WorkflowCommandControllerGrpc {

  private WorkflowCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.workflow.v1.WorkflowCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.Workflow,
      ai.stigmer.agentic.workflow.v1.Workflow> getApplyMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "apply",
      requestType = ai.stigmer.agentic.workflow.v1.Workflow.class,
      responseType = ai.stigmer.agentic.workflow.v1.Workflow.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.Workflow,
      ai.stigmer.agentic.workflow.v1.Workflow> getApplyMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.Workflow, ai.stigmer.agentic.workflow.v1.Workflow> getApplyMethod;
    if ((getApplyMethod = WorkflowCommandControllerGrpc.getApplyMethod) == null) {
      synchronized (WorkflowCommandControllerGrpc.class) {
        if ((getApplyMethod = WorkflowCommandControllerGrpc.getApplyMethod) == null) {
          WorkflowCommandControllerGrpc.getApplyMethod = getApplyMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflow.v1.Workflow, ai.stigmer.agentic.workflow.v1.Workflow>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "apply"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.Workflow.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.Workflow.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowCommandControllerMethodDescriptorSupplier("apply"))
              .build();
        }
      }
    }
    return getApplyMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.Workflow,
      ai.stigmer.agentic.workflow.v1.Workflow> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.workflow.v1.Workflow.class,
      responseType = ai.stigmer.agentic.workflow.v1.Workflow.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.Workflow,
      ai.stigmer.agentic.workflow.v1.Workflow> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.Workflow, ai.stigmer.agentic.workflow.v1.Workflow> getCreateMethod;
    if ((getCreateMethod = WorkflowCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (WorkflowCommandControllerGrpc.class) {
        if ((getCreateMethod = WorkflowCommandControllerGrpc.getCreateMethod) == null) {
          WorkflowCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflow.v1.Workflow, ai.stigmer.agentic.workflow.v1.Workflow>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.Workflow.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.Workflow.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.Workflow,
      ai.stigmer.agentic.workflow.v1.Workflow> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.workflow.v1.Workflow.class,
      responseType = ai.stigmer.agentic.workflow.v1.Workflow.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.Workflow,
      ai.stigmer.agentic.workflow.v1.Workflow> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.Workflow, ai.stigmer.agentic.workflow.v1.Workflow> getUpdateMethod;
    if ((getUpdateMethod = WorkflowCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (WorkflowCommandControllerGrpc.class) {
        if ((getUpdateMethod = WorkflowCommandControllerGrpc.getUpdateMethod) == null) {
          WorkflowCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflow.v1.Workflow, ai.stigmer.agentic.workflow.v1.Workflow>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.Workflow.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.Workflow.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.workflow.v1.Workflow> getUpdateVisibilityMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateVisibility",
      requestType = ai.stigmer.commons.apiresource.UpdateVisibilityInput.class,
      responseType = ai.stigmer.agentic.workflow.v1.Workflow.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput,
      ai.stigmer.agentic.workflow.v1.Workflow> getUpdateVisibilityMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.workflow.v1.Workflow> getUpdateVisibilityMethod;
    if ((getUpdateVisibilityMethod = WorkflowCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
      synchronized (WorkflowCommandControllerGrpc.class) {
        if ((getUpdateVisibilityMethod = WorkflowCommandControllerGrpc.getUpdateVisibilityMethod) == null) {
          WorkflowCommandControllerGrpc.getUpdateVisibilityMethod = getUpdateVisibilityMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.UpdateVisibilityInput, ai.stigmer.agentic.workflow.v1.Workflow>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateVisibility"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.UpdateVisibilityInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.Workflow.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowCommandControllerMethodDescriptorSupplier("updateVisibility"))
              .build();
        }
      }
    }
    return getUpdateVisibilityMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.WorkflowId,
      ai.stigmer.agentic.workflow.v1.Workflow> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.agentic.workflow.v1.WorkflowId.class,
      responseType = ai.stigmer.agentic.workflow.v1.Workflow.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.WorkflowId,
      ai.stigmer.agentic.workflow.v1.Workflow> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.WorkflowId, ai.stigmer.agentic.workflow.v1.Workflow> getDeleteMethod;
    if ((getDeleteMethod = WorkflowCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (WorkflowCommandControllerGrpc.class) {
        if ((getDeleteMethod = WorkflowCommandControllerGrpc.getDeleteMethod) == null) {
          WorkflowCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflow.v1.WorkflowId, ai.stigmer.agentic.workflow.v1.Workflow>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.WorkflowId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.Workflow.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.Workflow,
      ai.stigmer.agentic.workflow.v1.serverless.ServerlessWorkflowValidation> getValidateSpecMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "validateSpec",
      requestType = ai.stigmer.agentic.workflow.v1.Workflow.class,
      responseType = ai.stigmer.agentic.workflow.v1.serverless.ServerlessWorkflowValidation.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.Workflow,
      ai.stigmer.agentic.workflow.v1.serverless.ServerlessWorkflowValidation> getValidateSpecMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.Workflow, ai.stigmer.agentic.workflow.v1.serverless.ServerlessWorkflowValidation> getValidateSpecMethod;
    if ((getValidateSpecMethod = WorkflowCommandControllerGrpc.getValidateSpecMethod) == null) {
      synchronized (WorkflowCommandControllerGrpc.class) {
        if ((getValidateSpecMethod = WorkflowCommandControllerGrpc.getValidateSpecMethod) == null) {
          WorkflowCommandControllerGrpc.getValidateSpecMethod = getValidateSpecMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflow.v1.Workflow, ai.stigmer.agentic.workflow.v1.serverless.ServerlessWorkflowValidation>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "validateSpec"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.Workflow.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.serverless.ServerlessWorkflowValidation.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowCommandControllerMethodDescriptorSupplier("validateSpec"))
              .build();
        }
      }
    }
    return getValidateSpecMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.TagWorkflowVersionInput,
      ai.stigmer.agentic.workflow.v1.Workflow> getTagVersionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "tagVersion",
      requestType = ai.stigmer.agentic.workflow.v1.TagWorkflowVersionInput.class,
      responseType = ai.stigmer.agentic.workflow.v1.Workflow.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.TagWorkflowVersionInput,
      ai.stigmer.agentic.workflow.v1.Workflow> getTagVersionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflow.v1.TagWorkflowVersionInput, ai.stigmer.agentic.workflow.v1.Workflow> getTagVersionMethod;
    if ((getTagVersionMethod = WorkflowCommandControllerGrpc.getTagVersionMethod) == null) {
      synchronized (WorkflowCommandControllerGrpc.class) {
        if ((getTagVersionMethod = WorkflowCommandControllerGrpc.getTagVersionMethod) == null) {
          WorkflowCommandControllerGrpc.getTagVersionMethod = getTagVersionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflow.v1.TagWorkflowVersionInput, ai.stigmer.agentic.workflow.v1.Workflow>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "tagVersion"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.TagWorkflowVersionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflow.v1.Workflow.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowCommandControllerMethodDescriptorSupplier("tagVersion"))
              .build();
        }
      }
    }
    return getTagVersionMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static WorkflowCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowCommandControllerStub>() {
        @java.lang.Override
        public WorkflowCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowCommandControllerStub(channel, callOptions);
        }
      };
    return WorkflowCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static WorkflowCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public WorkflowCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return WorkflowCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static WorkflowCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowCommandControllerBlockingStub>() {
        @java.lang.Override
        public WorkflowCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return WorkflowCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static WorkflowCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowCommandControllerFutureStub>() {
        @java.lang.Override
        public WorkflowCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowCommandControllerFutureStub(channel, callOptions);
        }
      };
    return WorkflowCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * WorkflowCommandController handles write operations for workflows.
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create or update a workflow.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the workflow
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    default void apply(ai.stigmer.agentic.workflow.v1.Workflow request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getApplyMethod(), responseObserver);
    }

    /**
     * <pre>
     * Create a workflow.
     * &#64;internal
     * Authorization:
     * - Organization-scoped workflows: Caller must have can_create_workflow permission in the organization
     * - Platform-scoped workflows: Caller must be a platform operator (handled automatically by common auth step)
     * </pre>
     */
    default void create(ai.stigmer.agentic.workflow.v1.Workflow request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing workflow.
     * </pre>
     */
    default void update(ai.stigmer.agentic.workflow.v1.Workflow request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an existing workflow.
     * This is a targeted metadata update — it only modifies metadata.visibility,
     * leaving spec, status, and other metadata fields untouched. Use this to
     * make a workflow publicly accessible or to revoke public access without
     * sending the entire workflow resource (avoiding read-modify-write races).
     * In the cloud edition, PUBLIC is operator-gated: public listing crosses
     * every org boundary, so it is granted by the platform team on request.
     * Un-publishing and all other levels stay self-service.
     * &#64;internal
     * Authorization: can_edit on the workflow for private/org/platform
     * transitions; escalation to PUBLIC instead requires
     * can_set_public_visibility on platform:stigmer (cloud edition);
     * downgrade from PUBLIC: can_edit OR the platform permission.
     * Visibility transitions trigger FGA tuple management in Cloud mode:
     * - PRIVATE → PUBLIC: creates workflow#viewer&#64;identity_account:* tuple
     * - PUBLIC → PRIVATE: deletes the wildcard viewer tuple
     * </pre>
     */
    default void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateVisibilityMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a workflow.
     * </pre>
     */
    default void delete(ai.stigmer.agentic.workflow.v1.WorkflowId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Validate a workflow spec without persisting it.
     * Runs the same two validation layers as create/update, but never throws for a
     * user-fixable spec problem: it always returns a structured
     * ServerlessWorkflowValidation the caller can render field-by-field.
     *   Layer 1: proto field constraints (buf validate / protovalidate)
     *   Layer 2: in-process structural validation (proto → CNCF YAML plus
     *            structural, cross-reference, model, and budget checks)
     * Result states:
     *   - VALID: workflow structure passed all checks
     *   - INVALID: user error (bad structure, missing fields, unknown task kinds)
     *   - FAILED: internal validation fault (reserved; not a user error)
     * gRPC errors are limited to input that cannot be validated at all (a missing
     * workflow or spec) and to genuine internal faults. This RPC does NOT persist,
     * authorize, or create instances. It is a pure validation endpoint suitable for
     * iterative authoring where the caller needs fast feedback before committing.
     * &#64;internal
     * Authorization: Uses the same permission as create — caller must have
     * can_create_workflow in the org. This prevents unauthenticated abuse
     * of the validation pipeline while allowing any user who could create
     * a workflow to also validate one.
     * </pre>
     */
    default void validateSpec(ai.stigmer.agentic.workflow.v1.Workflow request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.serverless.ServerlessWorkflowValidation> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getValidateSpecMethod(), responseObserver);
    }

    /**
     * <pre>
     * Assign or move a tag to a specific workflow version.
     * Tags are human-readable pointers to immutable versions. Calling this
     * with an existing tag name moves it from the previous version to the
     * specified version. Common tags: "stable", "production", "v2.0".
     * &#64;internal
     * Authorization: Requires can_edit permission on the workflow resource.
     * The handler validates that the version_hash exists in the workflow's
     * audit history before assigning the tag.
     * &#64;since Workflow Versioning
     * </pre>
     */
    default void tagVersion(ai.stigmer.agentic.workflow.v1.TagWorkflowVersionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getTagVersionMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service WorkflowCommandController.
   * <pre>
   * WorkflowCommandController handles write operations for workflows.
   * </pre>
   */
  public static abstract class WorkflowCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return WorkflowCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service WorkflowCommandController.
   * <pre>
   * WorkflowCommandController handles write operations for workflows.
   * </pre>
   */
  public static final class WorkflowCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<WorkflowCommandControllerStub> {
    private WorkflowCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a workflow.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the workflow
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public void apply(ai.stigmer.agentic.workflow.v1.Workflow request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Create a workflow.
     * &#64;internal
     * Authorization:
     * - Organization-scoped workflows: Caller must have can_create_workflow permission in the organization
     * - Platform-scoped workflows: Caller must be a platform operator (handled automatically by common auth step)
     * </pre>
     */
    public void create(ai.stigmer.agentic.workflow.v1.Workflow request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing workflow.
     * </pre>
     */
    public void update(ai.stigmer.agentic.workflow.v1.Workflow request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update the visibility of an existing workflow.
     * This is a targeted metadata update — it only modifies metadata.visibility,
     * leaving spec, status, and other metadata fields untouched. Use this to
     * make a workflow publicly accessible or to revoke public access without
     * sending the entire workflow resource (avoiding read-modify-write races).
     * In the cloud edition, PUBLIC is operator-gated: public listing crosses
     * every org boundary, so it is granted by the platform team on request.
     * Un-publishing and all other levels stay self-service.
     * &#64;internal
     * Authorization: can_edit on the workflow for private/org/platform
     * transitions; escalation to PUBLIC instead requires
     * can_set_public_visibility on platform:stigmer (cloud edition);
     * downgrade from PUBLIC: can_edit OR the platform permission.
     * Visibility transitions trigger FGA tuple management in Cloud mode:
     * - PRIVATE → PUBLIC: creates workflow#viewer&#64;identity_account:* tuple
     * - PUBLIC → PRIVATE: deletes the wildcard viewer tuple
     * </pre>
     */
    public void updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a workflow.
     * </pre>
     */
    public void delete(ai.stigmer.agentic.workflow.v1.WorkflowId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Validate a workflow spec without persisting it.
     * Runs the same two validation layers as create/update, but never throws for a
     * user-fixable spec problem: it always returns a structured
     * ServerlessWorkflowValidation the caller can render field-by-field.
     *   Layer 1: proto field constraints (buf validate / protovalidate)
     *   Layer 2: in-process structural validation (proto → CNCF YAML plus
     *            structural, cross-reference, model, and budget checks)
     * Result states:
     *   - VALID: workflow structure passed all checks
     *   - INVALID: user error (bad structure, missing fields, unknown task kinds)
     *   - FAILED: internal validation fault (reserved; not a user error)
     * gRPC errors are limited to input that cannot be validated at all (a missing
     * workflow or spec) and to genuine internal faults. This RPC does NOT persist,
     * authorize, or create instances. It is a pure validation endpoint suitable for
     * iterative authoring where the caller needs fast feedback before committing.
     * &#64;internal
     * Authorization: Uses the same permission as create — caller must have
     * can_create_workflow in the org. This prevents unauthenticated abuse
     * of the validation pipeline while allowing any user who could create
     * a workflow to also validate one.
     * </pre>
     */
    public void validateSpec(ai.stigmer.agentic.workflow.v1.Workflow request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.serverless.ServerlessWorkflowValidation> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getValidateSpecMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Assign or move a tag to a specific workflow version.
     * Tags are human-readable pointers to immutable versions. Calling this
     * with an existing tag name moves it from the previous version to the
     * specified version. Common tags: "stable", "production", "v2.0".
     * &#64;internal
     * Authorization: Requires can_edit permission on the workflow resource.
     * The handler validates that the version_hash exists in the workflow's
     * audit history before assigning the tag.
     * &#64;since Workflow Versioning
     * </pre>
     */
    public void tagVersion(ai.stigmer.agentic.workflow.v1.TagWorkflowVersionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getTagVersionMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service WorkflowCommandController.
   * <pre>
   * WorkflowCommandController handles write operations for workflows.
   * </pre>
   */
  public static final class WorkflowCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<WorkflowCommandControllerBlockingV2Stub> {
    private WorkflowCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a workflow.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the workflow
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow apply(ai.stigmer.agentic.workflow.v1.Workflow request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a workflow.
     * &#64;internal
     * Authorization:
     * - Organization-scoped workflows: Caller must have can_create_workflow permission in the organization
     * - Platform-scoped workflows: Caller must be a platform operator (handled automatically by common auth step)
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow create(ai.stigmer.agentic.workflow.v1.Workflow request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing workflow.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow update(ai.stigmer.agentic.workflow.v1.Workflow request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing workflow.
     * This is a targeted metadata update — it only modifies metadata.visibility,
     * leaving spec, status, and other metadata fields untouched. Use this to
     * make a workflow publicly accessible or to revoke public access without
     * sending the entire workflow resource (avoiding read-modify-write races).
     * In the cloud edition, PUBLIC is operator-gated: public listing crosses
     * every org boundary, so it is granted by the platform team on request.
     * Un-publishing and all other levels stay self-service.
     * &#64;internal
     * Authorization: can_edit on the workflow for private/org/platform
     * transitions; escalation to PUBLIC instead requires
     * can_set_public_visibility on platform:stigmer (cloud edition);
     * downgrade from PUBLIC: can_edit OR the platform permission.
     * Visibility transitions trigger FGA tuple management in Cloud mode:
     * - PRIVATE → PUBLIC: creates workflow#viewer&#64;identity_account:* tuple
     * - PUBLIC → PRIVATE: deletes the wildcard viewer tuple
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a workflow.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow delete(ai.stigmer.agentic.workflow.v1.WorkflowId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Validate a workflow spec without persisting it.
     * Runs the same two validation layers as create/update, but never throws for a
     * user-fixable spec problem: it always returns a structured
     * ServerlessWorkflowValidation the caller can render field-by-field.
     *   Layer 1: proto field constraints (buf validate / protovalidate)
     *   Layer 2: in-process structural validation (proto → CNCF YAML plus
     *            structural, cross-reference, model, and budget checks)
     * Result states:
     *   - VALID: workflow structure passed all checks
     *   - INVALID: user error (bad structure, missing fields, unknown task kinds)
     *   - FAILED: internal validation fault (reserved; not a user error)
     * gRPC errors are limited to input that cannot be validated at all (a missing
     * workflow or spec) and to genuine internal faults. This RPC does NOT persist,
     * authorize, or create instances. It is a pure validation endpoint suitable for
     * iterative authoring where the caller needs fast feedback before committing.
     * &#64;internal
     * Authorization: Uses the same permission as create — caller must have
     * can_create_workflow in the org. This prevents unauthenticated abuse
     * of the validation pipeline while allowing any user who could create
     * a workflow to also validate one.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.serverless.ServerlessWorkflowValidation validateSpec(ai.stigmer.agentic.workflow.v1.Workflow request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getValidateSpecMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Assign or move a tag to a specific workflow version.
     * Tags are human-readable pointers to immutable versions. Calling this
     * with an existing tag name moves it from the previous version to the
     * specified version. Common tags: "stable", "production", "v2.0".
     * &#64;internal
     * Authorization: Requires can_edit permission on the workflow resource.
     * The handler validates that the version_hash exists in the workflow's
     * audit history before assigning the tag.
     * &#64;since Workflow Versioning
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow tagVersion(ai.stigmer.agentic.workflow.v1.TagWorkflowVersionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getTagVersionMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service WorkflowCommandController.
   * <pre>
   * WorkflowCommandController handles write operations for workflows.
   * </pre>
   */
  public static final class WorkflowCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<WorkflowCommandControllerBlockingStub> {
    private WorkflowCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a workflow.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the workflow
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow apply(ai.stigmer.agentic.workflow.v1.Workflow request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getApplyMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Create a workflow.
     * &#64;internal
     * Authorization:
     * - Organization-scoped workflows: Caller must have can_create_workflow permission in the organization
     * - Platform-scoped workflows: Caller must be a platform operator (handled automatically by common auth step)
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow create(ai.stigmer.agentic.workflow.v1.Workflow request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing workflow.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow update(ai.stigmer.agentic.workflow.v1.Workflow request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing workflow.
     * This is a targeted metadata update — it only modifies metadata.visibility,
     * leaving spec, status, and other metadata fields untouched. Use this to
     * make a workflow publicly accessible or to revoke public access without
     * sending the entire workflow resource (avoiding read-modify-write races).
     * In the cloud edition, PUBLIC is operator-gated: public listing crosses
     * every org boundary, so it is granted by the platform team on request.
     * Un-publishing and all other levels stay self-service.
     * &#64;internal
     * Authorization: can_edit on the workflow for private/org/platform
     * transitions; escalation to PUBLIC instead requires
     * can_set_public_visibility on platform:stigmer (cloud edition);
     * downgrade from PUBLIC: can_edit OR the platform permission.
     * Visibility transitions trigger FGA tuple management in Cloud mode:
     * - PRIVATE → PUBLIC: creates workflow#viewer&#64;identity_account:* tuple
     * - PUBLIC → PRIVATE: deletes the wildcard viewer tuple
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow updateVisibility(ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateVisibilityMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a workflow.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow delete(ai.stigmer.agentic.workflow.v1.WorkflowId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Validate a workflow spec without persisting it.
     * Runs the same two validation layers as create/update, but never throws for a
     * user-fixable spec problem: it always returns a structured
     * ServerlessWorkflowValidation the caller can render field-by-field.
     *   Layer 1: proto field constraints (buf validate / protovalidate)
     *   Layer 2: in-process structural validation (proto → CNCF YAML plus
     *            structural, cross-reference, model, and budget checks)
     * Result states:
     *   - VALID: workflow structure passed all checks
     *   - INVALID: user error (bad structure, missing fields, unknown task kinds)
     *   - FAILED: internal validation fault (reserved; not a user error)
     * gRPC errors are limited to input that cannot be validated at all (a missing
     * workflow or spec) and to genuine internal faults. This RPC does NOT persist,
     * authorize, or create instances. It is a pure validation endpoint suitable for
     * iterative authoring where the caller needs fast feedback before committing.
     * &#64;internal
     * Authorization: Uses the same permission as create — caller must have
     * can_create_workflow in the org. This prevents unauthenticated abuse
     * of the validation pipeline while allowing any user who could create
     * a workflow to also validate one.
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.serverless.ServerlessWorkflowValidation validateSpec(ai.stigmer.agentic.workflow.v1.Workflow request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getValidateSpecMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Assign or move a tag to a specific workflow version.
     * Tags are human-readable pointers to immutable versions. Calling this
     * with an existing tag name moves it from the previous version to the
     * specified version. Common tags: "stable", "production", "v2.0".
     * &#64;internal
     * Authorization: Requires can_edit permission on the workflow resource.
     * The handler validates that the version_hash exists in the workflow's
     * audit history before assigning the tag.
     * &#64;since Workflow Versioning
     * </pre>
     */
    public ai.stigmer.agentic.workflow.v1.Workflow tagVersion(ai.stigmer.agentic.workflow.v1.TagWorkflowVersionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getTagVersionMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service WorkflowCommandController.
   * <pre>
   * WorkflowCommandController handles write operations for workflows.
   * </pre>
   */
  public static final class WorkflowCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<WorkflowCommandControllerFutureStub> {
    private WorkflowCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create or update a workflow.
     * &#64;internal
     * The authorization and state-operation are determined depending on whether the workflow
     * is going to be created or updated which is determined as part of the request execution.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflow.v1.Workflow> apply(
        ai.stigmer.agentic.workflow.v1.Workflow request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getApplyMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Create a workflow.
     * &#64;internal
     * Authorization:
     * - Organization-scoped workflows: Caller must have can_create_workflow permission in the organization
     * - Platform-scoped workflows: Caller must be a platform operator (handled automatically by common auth step)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflow.v1.Workflow> create(
        ai.stigmer.agentic.workflow.v1.Workflow request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing workflow.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflow.v1.Workflow> update(
        ai.stigmer.agentic.workflow.v1.Workflow request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update the visibility of an existing workflow.
     * This is a targeted metadata update — it only modifies metadata.visibility,
     * leaving spec, status, and other metadata fields untouched. Use this to
     * make a workflow publicly accessible or to revoke public access without
     * sending the entire workflow resource (avoiding read-modify-write races).
     * In the cloud edition, PUBLIC is operator-gated: public listing crosses
     * every org boundary, so it is granted by the platform team on request.
     * Un-publishing and all other levels stay self-service.
     * &#64;internal
     * Authorization: can_edit on the workflow for private/org/platform
     * transitions; escalation to PUBLIC instead requires
     * can_set_public_visibility on platform:stigmer (cloud edition);
     * downgrade from PUBLIC: can_edit OR the platform permission.
     * Visibility transitions trigger FGA tuple management in Cloud mode:
     * - PRIVATE → PUBLIC: creates workflow#viewer&#64;identity_account:* tuple
     * - PUBLIC → PRIVATE: deletes the wildcard viewer tuple
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflow.v1.Workflow> updateVisibility(
        ai.stigmer.commons.apiresource.UpdateVisibilityInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateVisibilityMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a workflow.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflow.v1.Workflow> delete(
        ai.stigmer.agentic.workflow.v1.WorkflowId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Validate a workflow spec without persisting it.
     * Runs the same two validation layers as create/update, but never throws for a
     * user-fixable spec problem: it always returns a structured
     * ServerlessWorkflowValidation the caller can render field-by-field.
     *   Layer 1: proto field constraints (buf validate / protovalidate)
     *   Layer 2: in-process structural validation (proto → CNCF YAML plus
     *            structural, cross-reference, model, and budget checks)
     * Result states:
     *   - VALID: workflow structure passed all checks
     *   - INVALID: user error (bad structure, missing fields, unknown task kinds)
     *   - FAILED: internal validation fault (reserved; not a user error)
     * gRPC errors are limited to input that cannot be validated at all (a missing
     * workflow or spec) and to genuine internal faults. This RPC does NOT persist,
     * authorize, or create instances. It is a pure validation endpoint suitable for
     * iterative authoring where the caller needs fast feedback before committing.
     * &#64;internal
     * Authorization: Uses the same permission as create — caller must have
     * can_create_workflow in the org. This prevents unauthenticated abuse
     * of the validation pipeline while allowing any user who could create
     * a workflow to also validate one.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflow.v1.serverless.ServerlessWorkflowValidation> validateSpec(
        ai.stigmer.agentic.workflow.v1.Workflow request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getValidateSpecMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Assign or move a tag to a specific workflow version.
     * Tags are human-readable pointers to immutable versions. Calling this
     * with an existing tag name moves it from the previous version to the
     * specified version. Common tags: "stable", "production", "v2.0".
     * &#64;internal
     * Authorization: Requires can_edit permission on the workflow resource.
     * The handler validates that the version_hash exists in the workflow's
     * audit history before assigning the tag.
     * &#64;since Workflow Versioning
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflow.v1.Workflow> tagVersion(
        ai.stigmer.agentic.workflow.v1.TagWorkflowVersionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getTagVersionMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_APPLY = 0;
  private static final int METHODID_CREATE = 1;
  private static final int METHODID_UPDATE = 2;
  private static final int METHODID_UPDATE_VISIBILITY = 3;
  private static final int METHODID_DELETE = 4;
  private static final int METHODID_VALIDATE_SPEC = 5;
  private static final int METHODID_TAG_VERSION = 6;

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
          serviceImpl.apply((ai.stigmer.agentic.workflow.v1.Workflow) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow>) responseObserver);
          break;
        case METHODID_CREATE:
          serviceImpl.create((ai.stigmer.agentic.workflow.v1.Workflow) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.workflow.v1.Workflow) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow>) responseObserver);
          break;
        case METHODID_UPDATE_VISIBILITY:
          serviceImpl.updateVisibility((ai.stigmer.commons.apiresource.UpdateVisibilityInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.agentic.workflow.v1.WorkflowId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow>) responseObserver);
          break;
        case METHODID_VALIDATE_SPEC:
          serviceImpl.validateSpec((ai.stigmer.agentic.workflow.v1.Workflow) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.serverless.ServerlessWorkflowValidation>) responseObserver);
          break;
        case METHODID_TAG_VERSION:
          serviceImpl.tagVersion((ai.stigmer.agentic.workflow.v1.TagWorkflowVersionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflow.v1.Workflow>) responseObserver);
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
              ai.stigmer.agentic.workflow.v1.Workflow,
              ai.stigmer.agentic.workflow.v1.Workflow>(
                service, METHODID_APPLY)))
        .addMethod(
          getCreateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflow.v1.Workflow,
              ai.stigmer.agentic.workflow.v1.Workflow>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflow.v1.Workflow,
              ai.stigmer.agentic.workflow.v1.Workflow>(
                service, METHODID_UPDATE)))
        .addMethod(
          getUpdateVisibilityMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.UpdateVisibilityInput,
              ai.stigmer.agentic.workflow.v1.Workflow>(
                service, METHODID_UPDATE_VISIBILITY)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflow.v1.WorkflowId,
              ai.stigmer.agentic.workflow.v1.Workflow>(
                service, METHODID_DELETE)))
        .addMethod(
          getValidateSpecMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflow.v1.Workflow,
              ai.stigmer.agentic.workflow.v1.serverless.ServerlessWorkflowValidation>(
                service, METHODID_VALIDATE_SPEC)))
        .addMethod(
          getTagVersionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflow.v1.TagWorkflowVersionInput,
              ai.stigmer.agentic.workflow.v1.Workflow>(
                service, METHODID_TAG_VERSION)))
        .build();
  }

  private static abstract class WorkflowCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    WorkflowCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.workflow.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("WorkflowCommandController");
    }
  }

  private static final class WorkflowCommandControllerFileDescriptorSupplier
      extends WorkflowCommandControllerBaseDescriptorSupplier {
    WorkflowCommandControllerFileDescriptorSupplier() {}
  }

  private static final class WorkflowCommandControllerMethodDescriptorSupplier
      extends WorkflowCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    WorkflowCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (WorkflowCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new WorkflowCommandControllerFileDescriptorSupplier())
              .addMethod(getApplyMethod())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getUpdateVisibilityMethod())
              .addMethod(getDeleteMethod())
              .addMethod(getValidateSpecMethod())
              .addMethod(getTagVersionMethod())
              .build();
        }
      }
    }
    return result;
  }
}
