package ai.stigmer.agentic.workflowrun.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * WorkflowRunCommandController handles write operations (Create, Update, Delete) for WorkflowRun resources.
 * This service follows the Command-Query Separation (CQS) pattern:
 * - CommandController: Write operations (create, update, delete)
 * - QueryController: Read operations (get, list, search)
 * Authorization:
 * All RPCs use custom authorization logic implemented in middleware.
 * Custom authorization is needed because:
 * - create: Must verify user has "execute" permission on the referenced Workflow
 * - update: Only the workflow runner (system) can update run status, not users
 * Service Options:
 * - api_resource_kind: workflow_run - Links this service to the WorkflowRun resource
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class WorkflowRunCommandControllerGrpc {

  private WorkflowRunCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.workflowrun.v1.WorkflowRunCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.WorkflowRun,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.workflowrun.v1.WorkflowRun.class,
      responseType = ai.stigmer.agentic.workflowrun.v1.WorkflowRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.WorkflowRun,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.WorkflowRun, ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getCreateMethod;
    if ((getCreateMethod = WorkflowRunCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (WorkflowRunCommandControllerGrpc.class) {
        if ((getCreateMethod = WorkflowRunCommandControllerGrpc.getCreateMethod) == null) {
          WorkflowRunCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowrun.v1.WorkflowRun, ai.stigmer.agentic.workflowrun.v1.WorkflowRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRun.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRun.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowRunCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.WorkflowRun,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.workflowrun.v1.WorkflowRun.class,
      responseType = ai.stigmer.agentic.workflowrun.v1.WorkflowRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.WorkflowRun,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.WorkflowRun, ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getUpdateMethod;
    if ((getUpdateMethod = WorkflowRunCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (WorkflowRunCommandControllerGrpc.class) {
        if ((getUpdateMethod = WorkflowRunCommandControllerGrpc.getUpdateMethod) == null) {
          WorkflowRunCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowrun.v1.WorkflowRun, ai.stigmer.agentic.workflowrun.v1.WorkflowRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRun.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRun.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowRunCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.WorkflowRunUpdateStatusInput,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getUpdateStatusMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateStatus",
      requestType = ai.stigmer.agentic.workflowrun.v1.WorkflowRunUpdateStatusInput.class,
      responseType = ai.stigmer.agentic.workflowrun.v1.WorkflowRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.WorkflowRunUpdateStatusInput,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getUpdateStatusMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.WorkflowRunUpdateStatusInput, ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getUpdateStatusMethod;
    if ((getUpdateStatusMethod = WorkflowRunCommandControllerGrpc.getUpdateStatusMethod) == null) {
      synchronized (WorkflowRunCommandControllerGrpc.class) {
        if ((getUpdateStatusMethod = WorkflowRunCommandControllerGrpc.getUpdateStatusMethod) == null) {
          WorkflowRunCommandControllerGrpc.getUpdateStatusMethod = getUpdateStatusMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowrun.v1.WorkflowRunUpdateStatusInput, ai.stigmer.agentic.workflowrun.v1.WorkflowRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateStatus"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRunUpdateStatusInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRun.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowRunCommandControllerMethodDescriptorSupplier("updateStatus"))
              .build();
        }
      }
    }
    return getUpdateStatusMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowApprovalInput,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getSubmitApprovalMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "submitApproval",
      requestType = ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowApprovalInput.class,
      responseType = ai.stigmer.agentic.workflowrun.v1.WorkflowRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowApprovalInput,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getSubmitApprovalMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowApprovalInput, ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getSubmitApprovalMethod;
    if ((getSubmitApprovalMethod = WorkflowRunCommandControllerGrpc.getSubmitApprovalMethod) == null) {
      synchronized (WorkflowRunCommandControllerGrpc.class) {
        if ((getSubmitApprovalMethod = WorkflowRunCommandControllerGrpc.getSubmitApprovalMethod) == null) {
          WorkflowRunCommandControllerGrpc.getSubmitApprovalMethod = getSubmitApprovalMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowApprovalInput, ai.stigmer.agentic.workflowrun.v1.WorkflowRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "submitApproval"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowApprovalInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRun.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowRunCommandControllerMethodDescriptorSupplier("submitApproval"))
              .build();
        }
      }
    }
    return getSubmitApprovalMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowFileDecisionInput,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getSubmitFileDecisionMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "submitFileDecision",
      requestType = ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowFileDecisionInput.class,
      responseType = ai.stigmer.agentic.workflowrun.v1.WorkflowRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowFileDecisionInput,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getSubmitFileDecisionMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowFileDecisionInput, ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getSubmitFileDecisionMethod;
    if ((getSubmitFileDecisionMethod = WorkflowRunCommandControllerGrpc.getSubmitFileDecisionMethod) == null) {
      synchronized (WorkflowRunCommandControllerGrpc.class) {
        if ((getSubmitFileDecisionMethod = WorkflowRunCommandControllerGrpc.getSubmitFileDecisionMethod) == null) {
          WorkflowRunCommandControllerGrpc.getSubmitFileDecisionMethod = getSubmitFileDecisionMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowFileDecisionInput, ai.stigmer.agentic.workflowrun.v1.WorkflowRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "submitFileDecision"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowFileDecisionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRun.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowRunCommandControllerMethodDescriptorSupplier("submitFileDecision"))
              .build();
        }
      }
    }
    return getSubmitFileDecisionMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowTaskApprovalInput,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getSubmitWorkflowTaskApprovalMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "submitWorkflowTaskApproval",
      requestType = ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowTaskApprovalInput.class,
      responseType = ai.stigmer.agentic.workflowrun.v1.WorkflowRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowTaskApprovalInput,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getSubmitWorkflowTaskApprovalMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowTaskApprovalInput, ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getSubmitWorkflowTaskApprovalMethod;
    if ((getSubmitWorkflowTaskApprovalMethod = WorkflowRunCommandControllerGrpc.getSubmitWorkflowTaskApprovalMethod) == null) {
      synchronized (WorkflowRunCommandControllerGrpc.class) {
        if ((getSubmitWorkflowTaskApprovalMethod = WorkflowRunCommandControllerGrpc.getSubmitWorkflowTaskApprovalMethod) == null) {
          WorkflowRunCommandControllerGrpc.getSubmitWorkflowTaskApprovalMethod = getSubmitWorkflowTaskApprovalMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowTaskApprovalInput, ai.stigmer.agentic.workflowrun.v1.WorkflowRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "submitWorkflowTaskApproval"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowTaskApprovalInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRun.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowRunCommandControllerMethodDescriptorSupplier("submitWorkflowTaskApproval"))
              .build();
        }
      }
    }
    return getSubmitWorkflowTaskApprovalMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.commons.apiresource.ApiResourceId.class,
      responseType = ai.stigmer.agentic.workflowrun.v1.WorkflowRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getDeleteMethod;
    if ((getDeleteMethod = WorkflowRunCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (WorkflowRunCommandControllerGrpc.class) {
        if ((getDeleteMethod = WorkflowRunCommandControllerGrpc.getDeleteMethod) == null) {
          WorkflowRunCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.workflowrun.v1.WorkflowRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRun.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowRunCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.SendSignalInput,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getSendSignalMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "sendSignal",
      requestType = ai.stigmer.agentic.workflowrun.v1.SendSignalInput.class,
      responseType = ai.stigmer.agentic.workflowrun.v1.WorkflowRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.SendSignalInput,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getSendSignalMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.SendSignalInput, ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getSendSignalMethod;
    if ((getSendSignalMethod = WorkflowRunCommandControllerGrpc.getSendSignalMethod) == null) {
      synchronized (WorkflowRunCommandControllerGrpc.class) {
        if ((getSendSignalMethod = WorkflowRunCommandControllerGrpc.getSendSignalMethod) == null) {
          WorkflowRunCommandControllerGrpc.getSendSignalMethod = getSendSignalMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowrun.v1.SendSignalInput, ai.stigmer.agentic.workflowrun.v1.WorkflowRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "sendSignal"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.SendSignalInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRun.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowRunCommandControllerMethodDescriptorSupplier("sendSignal"))
              .build();
        }
      }
    }
    return getSendSignalMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.CancelWorkflowRunInput,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getCancelMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "cancel",
      requestType = ai.stigmer.agentic.workflowrun.v1.CancelWorkflowRunInput.class,
      responseType = ai.stigmer.agentic.workflowrun.v1.WorkflowRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.CancelWorkflowRunInput,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getCancelMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.CancelWorkflowRunInput, ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getCancelMethod;
    if ((getCancelMethod = WorkflowRunCommandControllerGrpc.getCancelMethod) == null) {
      synchronized (WorkflowRunCommandControllerGrpc.class) {
        if ((getCancelMethod = WorkflowRunCommandControllerGrpc.getCancelMethod) == null) {
          WorkflowRunCommandControllerGrpc.getCancelMethod = getCancelMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowrun.v1.CancelWorkflowRunInput, ai.stigmer.agentic.workflowrun.v1.WorkflowRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "cancel"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.CancelWorkflowRunInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRun.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowRunCommandControllerMethodDescriptorSupplier("cancel"))
              .build();
        }
      }
    }
    return getCancelMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.TerminateWorkflowRunInput,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getTerminateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "terminate",
      requestType = ai.stigmer.agentic.workflowrun.v1.TerminateWorkflowRunInput.class,
      responseType = ai.stigmer.agentic.workflowrun.v1.WorkflowRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.TerminateWorkflowRunInput,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getTerminateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.TerminateWorkflowRunInput, ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getTerminateMethod;
    if ((getTerminateMethod = WorkflowRunCommandControllerGrpc.getTerminateMethod) == null) {
      synchronized (WorkflowRunCommandControllerGrpc.class) {
        if ((getTerminateMethod = WorkflowRunCommandControllerGrpc.getTerminateMethod) == null) {
          WorkflowRunCommandControllerGrpc.getTerminateMethod = getTerminateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowrun.v1.TerminateWorkflowRunInput, ai.stigmer.agentic.workflowrun.v1.WorkflowRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "terminate"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.TerminateWorkflowRunInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRun.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowRunCommandControllerMethodDescriptorSupplier("terminate"))
              .build();
        }
      }
    }
    return getTerminateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.RecoverWorkflowRunInput,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getRecoverMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "recover",
      requestType = ai.stigmer.agentic.workflowrun.v1.RecoverWorkflowRunInput.class,
      responseType = ai.stigmer.agentic.workflowrun.v1.WorkflowRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.RecoverWorkflowRunInput,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getRecoverMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.RecoverWorkflowRunInput, ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getRecoverMethod;
    if ((getRecoverMethod = WorkflowRunCommandControllerGrpc.getRecoverMethod) == null) {
      synchronized (WorkflowRunCommandControllerGrpc.class) {
        if ((getRecoverMethod = WorkflowRunCommandControllerGrpc.getRecoverMethod) == null) {
          WorkflowRunCommandControllerGrpc.getRecoverMethod = getRecoverMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowrun.v1.RecoverWorkflowRunInput, ai.stigmer.agentic.workflowrun.v1.WorkflowRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "recover"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.RecoverWorkflowRunInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRun.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowRunCommandControllerMethodDescriptorSupplier("recover"))
              .build();
        }
      }
    }
    return getRecoverMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.PauseWorkflowRunInput,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getPauseMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "pause",
      requestType = ai.stigmer.agentic.workflowrun.v1.PauseWorkflowRunInput.class,
      responseType = ai.stigmer.agentic.workflowrun.v1.WorkflowRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.PauseWorkflowRunInput,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getPauseMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.PauseWorkflowRunInput, ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getPauseMethod;
    if ((getPauseMethod = WorkflowRunCommandControllerGrpc.getPauseMethod) == null) {
      synchronized (WorkflowRunCommandControllerGrpc.class) {
        if ((getPauseMethod = WorkflowRunCommandControllerGrpc.getPauseMethod) == null) {
          WorkflowRunCommandControllerGrpc.getPauseMethod = getPauseMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowrun.v1.PauseWorkflowRunInput, ai.stigmer.agentic.workflowrun.v1.WorkflowRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "pause"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.PauseWorkflowRunInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRun.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowRunCommandControllerMethodDescriptorSupplier("pause"))
              .build();
        }
      }
    }
    return getPauseMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.ResumeWorkflowRunInput,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getResumeMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "resume",
      requestType = ai.stigmer.agentic.workflowrun.v1.ResumeWorkflowRunInput.class,
      responseType = ai.stigmer.agentic.workflowrun.v1.WorkflowRun.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.ResumeWorkflowRunInput,
      ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getResumeMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowrun.v1.ResumeWorkflowRunInput, ai.stigmer.agentic.workflowrun.v1.WorkflowRun> getResumeMethod;
    if ((getResumeMethod = WorkflowRunCommandControllerGrpc.getResumeMethod) == null) {
      synchronized (WorkflowRunCommandControllerGrpc.class) {
        if ((getResumeMethod = WorkflowRunCommandControllerGrpc.getResumeMethod) == null) {
          WorkflowRunCommandControllerGrpc.getResumeMethod = getResumeMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowrun.v1.ResumeWorkflowRunInput, ai.stigmer.agentic.workflowrun.v1.WorkflowRun>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "resume"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.ResumeWorkflowRunInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowrun.v1.WorkflowRun.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowRunCommandControllerMethodDescriptorSupplier("resume"))
              .build();
        }
      }
    }
    return getResumeMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static WorkflowRunCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowRunCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowRunCommandControllerStub>() {
        @java.lang.Override
        public WorkflowRunCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowRunCommandControllerStub(channel, callOptions);
        }
      };
    return WorkflowRunCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static WorkflowRunCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowRunCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowRunCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public WorkflowRunCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowRunCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return WorkflowRunCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static WorkflowRunCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowRunCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowRunCommandControllerBlockingStub>() {
        @java.lang.Override
        public WorkflowRunCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowRunCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return WorkflowRunCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static WorkflowRunCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowRunCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowRunCommandControllerFutureStub>() {
        @java.lang.Override
        public WorkflowRunCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowRunCommandControllerFutureStub(channel, callOptions);
        }
      };
    return WorkflowRunCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * WorkflowRunCommandController handles write operations (Create, Update, Delete) for WorkflowRun resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search)
   * Authorization:
   * All RPCs use custom authorization logic implemented in middleware.
   * Custom authorization is needed because:
   * - create: Must verify user has "execute" permission on the referenced Workflow
   * - update: Only the workflow runner (system) can update run status, not users
   * Service Options:
   * - api_resource_kind: workflow_run - Links this service to the WorkflowRun resource
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create and trigger a new workflow run.
     * This RPC creates a WorkflowRun resource and immediately triggers it for execution.
     * The workflow run engine picks up the run and begins processing tasks.
     * </pre>
     */
    default void create(ai.stigmer.agentic.workflowrun.v1.WorkflowRun request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing workflow run with full state.
     * </pre>
     */
    default void update(ai.stigmer.agentic.workflowrun.v1.WorkflowRun request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update run status during workflow run.
     * </pre>
     */
    default void updateStatus(ai.stigmer.agentic.workflowrun.v1.WorkflowRunUpdateStatusInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateStatusMethod(), responseObserver);
    }

    /**
     * <pre>
     * Submit an approval decision for a child agent's tool execution.
     * This RPC forwards the approval decision to the child AgentRun that
     * is waiting for approval. The child is identified by the child_agent_run_id
     * in status.pending_approval.
     * When a workflow invokes an agent that requires tool approval, the approval
     * request surfaces at the workflow level via status.pending_approval. Users can
     * submit their decision through this RPC, which forwards it to the child agent.
     * </pre>
     */
    default void submitApproval(ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowApprovalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSubmitApprovalMethod(), responseObserver);
    }

    /**
     * <pre>
     * Submit a keep/discard decision for a child agent's file review.
     * Forwards the decision to the child AgentRun whose file-review gate is
     * surfaced on this workflow via status.pending_file_reviews. This is the
     * file-review sibling of submitApproval: submitApproval forwards a tool-call
     * approval, submitFileDecision forwards a FileChangeSet keep/discard.
     * </pre>
     */
    default void submitFileDecision(ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowFileDecisionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSubmitFileDecisionMethod(), responseObserver);
    }

    /**
     * <pre>
     * Submit a human reviewer's decision for a workflow-level human_input task.
     * Resolves a human_input approval gate by sending the reviewer's outcome
     * (and optional form data) to the waiting workflow task via Temporal signal.
     * </pre>
     */
    default void submitWorkflowTaskApproval(ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowTaskApprovalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSubmitWorkflowTaskApprovalMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a workflow run.
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Send a signal to a running workflow run.
     * Delivers a signal to a workflow run, typically to unblock a LISTEN task.
     * Delivery is race-proof: the signal is guaranteed to arrive even if sent
     * before the workflow is fully started.
     * </pre>
     */
    default void sendSignal(ai.stigmer.agentic.workflowrun.v1.SendSignalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSendSignalMethod(), responseObserver);
    }

    /**
     * <pre>
     * Cancel a running workflow run gracefully.
     * Sends a cancellation signal to the workflow. The workflow code can handle
     * the cancellation signal to perform cleanup (e.g., compensation logic,
     * resource cleanup, notifications) before transitioning to the CANCELLED phase.
     * </pre>
     */
    default void cancel(ai.stigmer.agentic.workflowrun.v1.CancelWorkflowRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCancelMethod(), responseObserver);
    }

    /**
     * <pre>
     * Terminate a workflow run immediately.
     * Force-stops the workflow without allowing cleanup. Unlike cancel,
     * the workflow code cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive workflows that don't respond to cancellation.
     * </pre>
     */
    default void terminate(ai.stigmer.agentic.workflowrun.v1.TerminateWorkflowRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getTerminateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Recover a failed workflow run.
     * Terminates the existing (possibly stuck) Temporal orchestrator and child
     * workflows, recreates the ExecutionContext with freshly resolved environment
     * variables, and starts a new Temporal workflow with recovery mode enabled.
     * The workflow engine reads completed task outputs from the persisted event
     * log, skips those tasks, and resumes the run from the first incomplete or
     * failed task — preserving all previously completed work.
     * </pre>
     */
    default void recover(ai.stigmer.agentic.workflowrun.v1.RecoverWorkflowRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRecoverMethod(), responseObserver);
    }

    /**
     * <pre>
     * Pause a running workflow run.
     * Temporarily stops the workflow at its current checkpoint. Unlike cancel,
     * the run is NOT terminal and can be resumed later from where it left off.
     * The workflow gracefully checkpoints and exits, preserving all progress.
     * </pre>
     */
    default void pause(ai.stigmer.agentic.workflowrun.v1.PauseWorkflowRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getPauseMethod(), responseObserver);
    }

    /**
     * <pre>
     * Resume a paused workflow run.
     * Continues the run from the checkpoint where it was paused. The workflow
     * re-invokes activities with the same thread_id, which loads from checkpoint
     * and continues from where it left off.
     * </pre>
     */
    default void resume(ai.stigmer.agentic.workflowrun.v1.ResumeWorkflowRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getResumeMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service WorkflowRunCommandController.
   * <pre>
   * WorkflowRunCommandController handles write operations (Create, Update, Delete) for WorkflowRun resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search)
   * Authorization:
   * All RPCs use custom authorization logic implemented in middleware.
   * Custom authorization is needed because:
   * - create: Must verify user has "execute" permission on the referenced Workflow
   * - update: Only the workflow runner (system) can update run status, not users
   * Service Options:
   * - api_resource_kind: workflow_run - Links this service to the WorkflowRun resource
   * </pre>
   */
  public static abstract class WorkflowRunCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return WorkflowRunCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service WorkflowRunCommandController.
   * <pre>
   * WorkflowRunCommandController handles write operations (Create, Update, Delete) for WorkflowRun resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search)
   * Authorization:
   * All RPCs use custom authorization logic implemented in middleware.
   * Custom authorization is needed because:
   * - create: Must verify user has "execute" permission on the referenced Workflow
   * - update: Only the workflow runner (system) can update run status, not users
   * Service Options:
   * - api_resource_kind: workflow_run - Links this service to the WorkflowRun resource
   * </pre>
   */
  public static final class WorkflowRunCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<WorkflowRunCommandControllerStub> {
    private WorkflowRunCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowRunCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowRunCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new workflow run.
     * This RPC creates a WorkflowRun resource and immediately triggers it for execution.
     * The workflow run engine picks up the run and begins processing tasks.
     * </pre>
     */
    public void create(ai.stigmer.agentic.workflowrun.v1.WorkflowRun request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing workflow run with full state.
     * </pre>
     */
    public void update(ai.stigmer.agentic.workflowrun.v1.WorkflowRun request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update run status during workflow run.
     * </pre>
     */
    public void updateStatus(ai.stigmer.agentic.workflowrun.v1.WorkflowRunUpdateStatusInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateStatusMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Submit an approval decision for a child agent's tool execution.
     * This RPC forwards the approval decision to the child AgentRun that
     * is waiting for approval. The child is identified by the child_agent_run_id
     * in status.pending_approval.
     * When a workflow invokes an agent that requires tool approval, the approval
     * request surfaces at the workflow level via status.pending_approval. Users can
     * submit their decision through this RPC, which forwards it to the child agent.
     * </pre>
     */
    public void submitApproval(ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowApprovalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSubmitApprovalMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Submit a keep/discard decision for a child agent's file review.
     * Forwards the decision to the child AgentRun whose file-review gate is
     * surfaced on this workflow via status.pending_file_reviews. This is the
     * file-review sibling of submitApproval: submitApproval forwards a tool-call
     * approval, submitFileDecision forwards a FileChangeSet keep/discard.
     * </pre>
     */
    public void submitFileDecision(ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowFileDecisionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSubmitFileDecisionMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Submit a human reviewer's decision for a workflow-level human_input task.
     * Resolves a human_input approval gate by sending the reviewer's outcome
     * (and optional form data) to the waiting workflow task via Temporal signal.
     * </pre>
     */
    public void submitWorkflowTaskApproval(ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowTaskApprovalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSubmitWorkflowTaskApprovalMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a workflow run.
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Send a signal to a running workflow run.
     * Delivers a signal to a workflow run, typically to unblock a LISTEN task.
     * Delivery is race-proof: the signal is guaranteed to arrive even if sent
     * before the workflow is fully started.
     * </pre>
     */
    public void sendSignal(ai.stigmer.agentic.workflowrun.v1.SendSignalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSendSignalMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Cancel a running workflow run gracefully.
     * Sends a cancellation signal to the workflow. The workflow code can handle
     * the cancellation signal to perform cleanup (e.g., compensation logic,
     * resource cleanup, notifications) before transitioning to the CANCELLED phase.
     * </pre>
     */
    public void cancel(ai.stigmer.agentic.workflowrun.v1.CancelWorkflowRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCancelMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Terminate a workflow run immediately.
     * Force-stops the workflow without allowing cleanup. Unlike cancel,
     * the workflow code cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive workflows that don't respond to cancellation.
     * </pre>
     */
    public void terminate(ai.stigmer.agentic.workflowrun.v1.TerminateWorkflowRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getTerminateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Recover a failed workflow run.
     * Terminates the existing (possibly stuck) Temporal orchestrator and child
     * workflows, recreates the ExecutionContext with freshly resolved environment
     * variables, and starts a new Temporal workflow with recovery mode enabled.
     * The workflow engine reads completed task outputs from the persisted event
     * log, skips those tasks, and resumes the run from the first incomplete or
     * failed task — preserving all previously completed work.
     * </pre>
     */
    public void recover(ai.stigmer.agentic.workflowrun.v1.RecoverWorkflowRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRecoverMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Pause a running workflow run.
     * Temporarily stops the workflow at its current checkpoint. Unlike cancel,
     * the run is NOT terminal and can be resumed later from where it left off.
     * The workflow gracefully checkpoints and exits, preserving all progress.
     * </pre>
     */
    public void pause(ai.stigmer.agentic.workflowrun.v1.PauseWorkflowRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getPauseMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Resume a paused workflow run.
     * Continues the run from the checkpoint where it was paused. The workflow
     * re-invokes activities with the same thread_id, which loads from checkpoint
     * and continues from where it left off.
     * </pre>
     */
    public void resume(ai.stigmer.agentic.workflowrun.v1.ResumeWorkflowRunInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getResumeMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service WorkflowRunCommandController.
   * <pre>
   * WorkflowRunCommandController handles write operations (Create, Update, Delete) for WorkflowRun resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search)
   * Authorization:
   * All RPCs use custom authorization logic implemented in middleware.
   * Custom authorization is needed because:
   * - create: Must verify user has "execute" permission on the referenced Workflow
   * - update: Only the workflow runner (system) can update run status, not users
   * Service Options:
   * - api_resource_kind: workflow_run - Links this service to the WorkflowRun resource
   * </pre>
   */
  public static final class WorkflowRunCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<WorkflowRunCommandControllerBlockingV2Stub> {
    private WorkflowRunCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowRunCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowRunCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new workflow run.
     * This RPC creates a WorkflowRun resource and immediately triggers it for execution.
     * The workflow run engine picks up the run and begins processing tasks.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun create(ai.stigmer.agentic.workflowrun.v1.WorkflowRun request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing workflow run with full state.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun update(ai.stigmer.agentic.workflowrun.v1.WorkflowRun request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update run status during workflow run.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun updateStatus(ai.stigmer.agentic.workflowrun.v1.WorkflowRunUpdateStatusInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateStatusMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit an approval decision for a child agent's tool execution.
     * This RPC forwards the approval decision to the child AgentRun that
     * is waiting for approval. The child is identified by the child_agent_run_id
     * in status.pending_approval.
     * When a workflow invokes an agent that requires tool approval, the approval
     * request surfaces at the workflow level via status.pending_approval. Users can
     * submit their decision through this RPC, which forwards it to the child agent.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun submitApproval(ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowApprovalInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSubmitApprovalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit a keep/discard decision for a child agent's file review.
     * Forwards the decision to the child AgentRun whose file-review gate is
     * surfaced on this workflow via status.pending_file_reviews. This is the
     * file-review sibling of submitApproval: submitApproval forwards a tool-call
     * approval, submitFileDecision forwards a FileChangeSet keep/discard.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun submitFileDecision(ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowFileDecisionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSubmitFileDecisionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit a human reviewer's decision for a workflow-level human_input task.
     * Resolves a human_input approval gate by sending the reviewer's outcome
     * (and optional form data) to the waiting workflow task via Temporal signal.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun submitWorkflowTaskApproval(ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowTaskApprovalInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSubmitWorkflowTaskApprovalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a workflow run.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun delete(ai.stigmer.commons.apiresource.ApiResourceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Send a signal to a running workflow run.
     * Delivers a signal to a workflow run, typically to unblock a LISTEN task.
     * Delivery is race-proof: the signal is guaranteed to arrive even if sent
     * before the workflow is fully started.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun sendSignal(ai.stigmer.agentic.workflowrun.v1.SendSignalInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSendSignalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cancel a running workflow run gracefully.
     * Sends a cancellation signal to the workflow. The workflow code can handle
     * the cancellation signal to perform cleanup (e.g., compensation logic,
     * resource cleanup, notifications) before transitioning to the CANCELLED phase.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun cancel(ai.stigmer.agentic.workflowrun.v1.CancelWorkflowRunInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCancelMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Terminate a workflow run immediately.
     * Force-stops the workflow without allowing cleanup. Unlike cancel,
     * the workflow code cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive workflows that don't respond to cancellation.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun terminate(ai.stigmer.agentic.workflowrun.v1.TerminateWorkflowRunInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getTerminateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Recover a failed workflow run.
     * Terminates the existing (possibly stuck) Temporal orchestrator and child
     * workflows, recreates the ExecutionContext with freshly resolved environment
     * variables, and starts a new Temporal workflow with recovery mode enabled.
     * The workflow engine reads completed task outputs from the persisted event
     * log, skips those tasks, and resumes the run from the first incomplete or
     * failed task — preserving all previously completed work.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun recover(ai.stigmer.agentic.workflowrun.v1.RecoverWorkflowRunInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRecoverMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Pause a running workflow run.
     * Temporarily stops the workflow at its current checkpoint. Unlike cancel,
     * the run is NOT terminal and can be resumed later from where it left off.
     * The workflow gracefully checkpoints and exits, preserving all progress.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun pause(ai.stigmer.agentic.workflowrun.v1.PauseWorkflowRunInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getPauseMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Resume a paused workflow run.
     * Continues the run from the checkpoint where it was paused. The workflow
     * re-invokes activities with the same thread_id, which loads from checkpoint
     * and continues from where it left off.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun resume(ai.stigmer.agentic.workflowrun.v1.ResumeWorkflowRunInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getResumeMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service WorkflowRunCommandController.
   * <pre>
   * WorkflowRunCommandController handles write operations (Create, Update, Delete) for WorkflowRun resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search)
   * Authorization:
   * All RPCs use custom authorization logic implemented in middleware.
   * Custom authorization is needed because:
   * - create: Must verify user has "execute" permission on the referenced Workflow
   * - update: Only the workflow runner (system) can update run status, not users
   * Service Options:
   * - api_resource_kind: workflow_run - Links this service to the WorkflowRun resource
   * </pre>
   */
  public static final class WorkflowRunCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<WorkflowRunCommandControllerBlockingStub> {
    private WorkflowRunCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowRunCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowRunCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new workflow run.
     * This RPC creates a WorkflowRun resource and immediately triggers it for execution.
     * The workflow run engine picks up the run and begins processing tasks.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun create(ai.stigmer.agentic.workflowrun.v1.WorkflowRun request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing workflow run with full state.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun update(ai.stigmer.agentic.workflowrun.v1.WorkflowRun request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update run status during workflow run.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun updateStatus(ai.stigmer.agentic.workflowrun.v1.WorkflowRunUpdateStatusInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateStatusMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit an approval decision for a child agent's tool execution.
     * This RPC forwards the approval decision to the child AgentRun that
     * is waiting for approval. The child is identified by the child_agent_run_id
     * in status.pending_approval.
     * When a workflow invokes an agent that requires tool approval, the approval
     * request surfaces at the workflow level via status.pending_approval. Users can
     * submit their decision through this RPC, which forwards it to the child agent.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun submitApproval(ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowApprovalInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSubmitApprovalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit a keep/discard decision for a child agent's file review.
     * Forwards the decision to the child AgentRun whose file-review gate is
     * surfaced on this workflow via status.pending_file_reviews. This is the
     * file-review sibling of submitApproval: submitApproval forwards a tool-call
     * approval, submitFileDecision forwards a FileChangeSet keep/discard.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun submitFileDecision(ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowFileDecisionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSubmitFileDecisionMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit a human reviewer's decision for a workflow-level human_input task.
     * Resolves a human_input approval gate by sending the reviewer's outcome
     * (and optional form data) to the waiting workflow task via Temporal signal.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun submitWorkflowTaskApproval(ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowTaskApprovalInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSubmitWorkflowTaskApprovalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a workflow run.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun delete(ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Send a signal to a running workflow run.
     * Delivers a signal to a workflow run, typically to unblock a LISTEN task.
     * Delivery is race-proof: the signal is guaranteed to arrive even if sent
     * before the workflow is fully started.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun sendSignal(ai.stigmer.agentic.workflowrun.v1.SendSignalInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSendSignalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cancel a running workflow run gracefully.
     * Sends a cancellation signal to the workflow. The workflow code can handle
     * the cancellation signal to perform cleanup (e.g., compensation logic,
     * resource cleanup, notifications) before transitioning to the CANCELLED phase.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun cancel(ai.stigmer.agentic.workflowrun.v1.CancelWorkflowRunInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCancelMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Terminate a workflow run immediately.
     * Force-stops the workflow without allowing cleanup. Unlike cancel,
     * the workflow code cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive workflows that don't respond to cancellation.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun terminate(ai.stigmer.agentic.workflowrun.v1.TerminateWorkflowRunInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getTerminateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Recover a failed workflow run.
     * Terminates the existing (possibly stuck) Temporal orchestrator and child
     * workflows, recreates the ExecutionContext with freshly resolved environment
     * variables, and starts a new Temporal workflow with recovery mode enabled.
     * The workflow engine reads completed task outputs from the persisted event
     * log, skips those tasks, and resumes the run from the first incomplete or
     * failed task — preserving all previously completed work.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun recover(ai.stigmer.agentic.workflowrun.v1.RecoverWorkflowRunInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRecoverMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Pause a running workflow run.
     * Temporarily stops the workflow at its current checkpoint. Unlike cancel,
     * the run is NOT terminal and can be resumed later from where it left off.
     * The workflow gracefully checkpoints and exits, preserving all progress.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun pause(ai.stigmer.agentic.workflowrun.v1.PauseWorkflowRunInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getPauseMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Resume a paused workflow run.
     * Continues the run from the checkpoint where it was paused. The workflow
     * re-invokes activities with the same thread_id, which loads from checkpoint
     * and continues from where it left off.
     * </pre>
     */
    public ai.stigmer.agentic.workflowrun.v1.WorkflowRun resume(ai.stigmer.agentic.workflowrun.v1.ResumeWorkflowRunInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getResumeMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service WorkflowRunCommandController.
   * <pre>
   * WorkflowRunCommandController handles write operations (Create, Update, Delete) for WorkflowRun resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search)
   * Authorization:
   * All RPCs use custom authorization logic implemented in middleware.
   * Custom authorization is needed because:
   * - create: Must verify user has "execute" permission on the referenced Workflow
   * - update: Only the workflow runner (system) can update run status, not users
   * Service Options:
   * - api_resource_kind: workflow_run - Links this service to the WorkflowRun resource
   * </pre>
   */
  public static final class WorkflowRunCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<WorkflowRunCommandControllerFutureStub> {
    private WorkflowRunCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowRunCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowRunCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new workflow run.
     * This RPC creates a WorkflowRun resource and immediately triggers it for execution.
     * The workflow run engine picks up the run and begins processing tasks.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> create(
        ai.stigmer.agentic.workflowrun.v1.WorkflowRun request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing workflow run with full state.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> update(
        ai.stigmer.agentic.workflowrun.v1.WorkflowRun request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update run status during workflow run.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> updateStatus(
        ai.stigmer.agentic.workflowrun.v1.WorkflowRunUpdateStatusInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateStatusMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Submit an approval decision for a child agent's tool execution.
     * This RPC forwards the approval decision to the child AgentRun that
     * is waiting for approval. The child is identified by the child_agent_run_id
     * in status.pending_approval.
     * When a workflow invokes an agent that requires tool approval, the approval
     * request surfaces at the workflow level via status.pending_approval. Users can
     * submit their decision through this RPC, which forwards it to the child agent.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> submitApproval(
        ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowApprovalInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSubmitApprovalMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Submit a keep/discard decision for a child agent's file review.
     * Forwards the decision to the child AgentRun whose file-review gate is
     * surfaced on this workflow via status.pending_file_reviews. This is the
     * file-review sibling of submitApproval: submitApproval forwards a tool-call
     * approval, submitFileDecision forwards a FileChangeSet keep/discard.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> submitFileDecision(
        ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowFileDecisionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSubmitFileDecisionMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Submit a human reviewer's decision for a workflow-level human_input task.
     * Resolves a human_input approval gate by sending the reviewer's outcome
     * (and optional form data) to the waiting workflow task via Temporal signal.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> submitWorkflowTaskApproval(
        ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowTaskApprovalInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSubmitWorkflowTaskApprovalMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a workflow run.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> delete(
        ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Send a signal to a running workflow run.
     * Delivers a signal to a workflow run, typically to unblock a LISTEN task.
     * Delivery is race-proof: the signal is guaranteed to arrive even if sent
     * before the workflow is fully started.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> sendSignal(
        ai.stigmer.agentic.workflowrun.v1.SendSignalInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSendSignalMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Cancel a running workflow run gracefully.
     * Sends a cancellation signal to the workflow. The workflow code can handle
     * the cancellation signal to perform cleanup (e.g., compensation logic,
     * resource cleanup, notifications) before transitioning to the CANCELLED phase.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> cancel(
        ai.stigmer.agentic.workflowrun.v1.CancelWorkflowRunInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCancelMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Terminate a workflow run immediately.
     * Force-stops the workflow without allowing cleanup. Unlike cancel,
     * the workflow code cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive workflows that don't respond to cancellation.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> terminate(
        ai.stigmer.agentic.workflowrun.v1.TerminateWorkflowRunInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getTerminateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Recover a failed workflow run.
     * Terminates the existing (possibly stuck) Temporal orchestrator and child
     * workflows, recreates the ExecutionContext with freshly resolved environment
     * variables, and starts a new Temporal workflow with recovery mode enabled.
     * The workflow engine reads completed task outputs from the persisted event
     * log, skips those tasks, and resumes the run from the first incomplete or
     * failed task — preserving all previously completed work.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> recover(
        ai.stigmer.agentic.workflowrun.v1.RecoverWorkflowRunInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRecoverMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Pause a running workflow run.
     * Temporarily stops the workflow at its current checkpoint. Unlike cancel,
     * the run is NOT terminal and can be resumed later from where it left off.
     * The workflow gracefully checkpoints and exits, preserving all progress.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> pause(
        ai.stigmer.agentic.workflowrun.v1.PauseWorkflowRunInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getPauseMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Resume a paused workflow run.
     * Continues the run from the checkpoint where it was paused. The workflow
     * re-invokes activities with the same thread_id, which loads from checkpoint
     * and continues from where it left off.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowrun.v1.WorkflowRun> resume(
        ai.stigmer.agentic.workflowrun.v1.ResumeWorkflowRunInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getResumeMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;
  private static final int METHODID_UPDATE = 1;
  private static final int METHODID_UPDATE_STATUS = 2;
  private static final int METHODID_SUBMIT_APPROVAL = 3;
  private static final int METHODID_SUBMIT_FILE_DECISION = 4;
  private static final int METHODID_SUBMIT_WORKFLOW_TASK_APPROVAL = 5;
  private static final int METHODID_DELETE = 6;
  private static final int METHODID_SEND_SIGNAL = 7;
  private static final int METHODID_CANCEL = 8;
  private static final int METHODID_TERMINATE = 9;
  private static final int METHODID_RECOVER = 10;
  private static final int METHODID_PAUSE = 11;
  private static final int METHODID_RESUME = 12;

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
          serviceImpl.create((ai.stigmer.agentic.workflowrun.v1.WorkflowRun) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.workflowrun.v1.WorkflowRun) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun>) responseObserver);
          break;
        case METHODID_UPDATE_STATUS:
          serviceImpl.updateStatus((ai.stigmer.agentic.workflowrun.v1.WorkflowRunUpdateStatusInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun>) responseObserver);
          break;
        case METHODID_SUBMIT_APPROVAL:
          serviceImpl.submitApproval((ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowApprovalInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun>) responseObserver);
          break;
        case METHODID_SUBMIT_FILE_DECISION:
          serviceImpl.submitFileDecision((ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowFileDecisionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun>) responseObserver);
          break;
        case METHODID_SUBMIT_WORKFLOW_TASK_APPROVAL:
          serviceImpl.submitWorkflowTaskApproval((ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowTaskApprovalInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.commons.apiresource.ApiResourceId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun>) responseObserver);
          break;
        case METHODID_SEND_SIGNAL:
          serviceImpl.sendSignal((ai.stigmer.agentic.workflowrun.v1.SendSignalInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun>) responseObserver);
          break;
        case METHODID_CANCEL:
          serviceImpl.cancel((ai.stigmer.agentic.workflowrun.v1.CancelWorkflowRunInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun>) responseObserver);
          break;
        case METHODID_TERMINATE:
          serviceImpl.terminate((ai.stigmer.agentic.workflowrun.v1.TerminateWorkflowRunInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun>) responseObserver);
          break;
        case METHODID_RECOVER:
          serviceImpl.recover((ai.stigmer.agentic.workflowrun.v1.RecoverWorkflowRunInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun>) responseObserver);
          break;
        case METHODID_PAUSE:
          serviceImpl.pause((ai.stigmer.agentic.workflowrun.v1.PauseWorkflowRunInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun>) responseObserver);
          break;
        case METHODID_RESUME:
          serviceImpl.resume((ai.stigmer.agentic.workflowrun.v1.ResumeWorkflowRunInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowrun.v1.WorkflowRun>) responseObserver);
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
              ai.stigmer.agentic.workflowrun.v1.WorkflowRun,
              ai.stigmer.agentic.workflowrun.v1.WorkflowRun>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowrun.v1.WorkflowRun,
              ai.stigmer.agentic.workflowrun.v1.WorkflowRun>(
                service, METHODID_UPDATE)))
        .addMethod(
          getUpdateStatusMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowrun.v1.WorkflowRunUpdateStatusInput,
              ai.stigmer.agentic.workflowrun.v1.WorkflowRun>(
                service, METHODID_UPDATE_STATUS)))
        .addMethod(
          getSubmitApprovalMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowApprovalInput,
              ai.stigmer.agentic.workflowrun.v1.WorkflowRun>(
                service, METHODID_SUBMIT_APPROVAL)))
        .addMethod(
          getSubmitFileDecisionMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowFileDecisionInput,
              ai.stigmer.agentic.workflowrun.v1.WorkflowRun>(
                service, METHODID_SUBMIT_FILE_DECISION)))
        .addMethod(
          getSubmitWorkflowTaskApprovalMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowrun.v1.SubmitWorkflowTaskApprovalInput,
              ai.stigmer.agentic.workflowrun.v1.WorkflowRun>(
                service, METHODID_SUBMIT_WORKFLOW_TASK_APPROVAL)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceId,
              ai.stigmer.agentic.workflowrun.v1.WorkflowRun>(
                service, METHODID_DELETE)))
        .addMethod(
          getSendSignalMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowrun.v1.SendSignalInput,
              ai.stigmer.agentic.workflowrun.v1.WorkflowRun>(
                service, METHODID_SEND_SIGNAL)))
        .addMethod(
          getCancelMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowrun.v1.CancelWorkflowRunInput,
              ai.stigmer.agentic.workflowrun.v1.WorkflowRun>(
                service, METHODID_CANCEL)))
        .addMethod(
          getTerminateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowrun.v1.TerminateWorkflowRunInput,
              ai.stigmer.agentic.workflowrun.v1.WorkflowRun>(
                service, METHODID_TERMINATE)))
        .addMethod(
          getRecoverMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowrun.v1.RecoverWorkflowRunInput,
              ai.stigmer.agentic.workflowrun.v1.WorkflowRun>(
                service, METHODID_RECOVER)))
        .addMethod(
          getPauseMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowrun.v1.PauseWorkflowRunInput,
              ai.stigmer.agentic.workflowrun.v1.WorkflowRun>(
                service, METHODID_PAUSE)))
        .addMethod(
          getResumeMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowrun.v1.ResumeWorkflowRunInput,
              ai.stigmer.agentic.workflowrun.v1.WorkflowRun>(
                service, METHODID_RESUME)))
        .build();
  }

  private static abstract class WorkflowRunCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    WorkflowRunCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.workflowrun.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("WorkflowRunCommandController");
    }
  }

  private static final class WorkflowRunCommandControllerFileDescriptorSupplier
      extends WorkflowRunCommandControllerBaseDescriptorSupplier {
    WorkflowRunCommandControllerFileDescriptorSupplier() {}
  }

  private static final class WorkflowRunCommandControllerMethodDescriptorSupplier
      extends WorkflowRunCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    WorkflowRunCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (WorkflowRunCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new WorkflowRunCommandControllerFileDescriptorSupplier())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getUpdateStatusMethod())
              .addMethod(getSubmitApprovalMethod())
              .addMethod(getSubmitFileDecisionMethod())
              .addMethod(getSubmitWorkflowTaskApprovalMethod())
              .addMethod(getDeleteMethod())
              .addMethod(getSendSignalMethod())
              .addMethod(getCancelMethod())
              .addMethod(getTerminateMethod())
              .addMethod(getRecoverMethod())
              .addMethod(getPauseMethod())
              .addMethod(getResumeMethod())
              .build();
        }
      }
    }
    return result;
  }
}
