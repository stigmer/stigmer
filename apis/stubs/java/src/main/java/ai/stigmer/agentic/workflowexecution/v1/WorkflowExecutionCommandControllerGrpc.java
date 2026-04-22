package ai.stigmer.agentic.workflowexecution.v1;

import static io.grpc.MethodDescriptor.generateFullMethodName;

/**
 * <pre>
 * WorkflowExecutionCommandController handles write operations (Create, Update, Delete) for WorkflowExecution resources.
 * This service follows the Command-Query Separation (CQS) pattern:
 * - CommandController: Write operations (create, update, delete)
 * - QueryController: Read operations (get, list, search)
 * Authorization:
 * All RPCs use custom authorization logic implemented in middleware.
 * Custom authorization is needed because:
 * - create: Must verify user has "execute" permission on the referenced WorkflowInstance
 * - update: Only the workflow runner (system) can update execution status, not users
 * Service Options:
 * - api_resource_kind: workflow_execution - Links this service to the WorkflowExecution resource
 * </pre>
 */
@io.grpc.stub.annotations.GrpcGenerated
public final class WorkflowExecutionCommandControllerGrpc {

  private WorkflowExecutionCommandControllerGrpc() {}

  public static final java.lang.String SERVICE_NAME = "ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionCommandController";

  // Static method descriptors that strictly reflect the proto.
  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getCreateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "create",
      requestType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getCreateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getCreateMethod;
    if ((getCreateMethod = WorkflowExecutionCommandControllerGrpc.getCreateMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getCreateMethod = WorkflowExecutionCommandControllerGrpc.getCreateMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getCreateMethod = getCreateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "create"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("create"))
              .build();
        }
      }
    }
    return getCreateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getUpdateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "update",
      requestType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getUpdateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getUpdateMethod;
    if ((getUpdateMethod = WorkflowExecutionCommandControllerGrpc.getUpdateMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getUpdateMethod = WorkflowExecutionCommandControllerGrpc.getUpdateMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getUpdateMethod = getUpdateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "update"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("update"))
              .build();
        }
      }
    }
    return getUpdateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getUpdateStatusMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "updateStatus",
      requestType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getUpdateStatusMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getUpdateStatusMethod;
    if ((getUpdateStatusMethod = WorkflowExecutionCommandControllerGrpc.getUpdateStatusMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getUpdateStatusMethod = WorkflowExecutionCommandControllerGrpc.getUpdateStatusMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getUpdateStatusMethod = getUpdateStatusMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "updateStatus"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("updateStatus"))
              .build();
        }
      }
    }
    return getUpdateStatusMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getSubmitApprovalMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "submitApproval",
      requestType = ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getSubmitApprovalMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getSubmitApprovalMethod;
    if ((getSubmitApprovalMethod = WorkflowExecutionCommandControllerGrpc.getSubmitApprovalMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getSubmitApprovalMethod = WorkflowExecutionCommandControllerGrpc.getSubmitApprovalMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getSubmitApprovalMethod = getSubmitApprovalMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "submitApproval"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("submitApproval"))
              .build();
        }
      }
    }
    return getSubmitApprovalMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getDeleteMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "delete",
      requestType = ai.stigmer.commons.apiresource.ApiResourceId.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getDeleteMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getDeleteMethod;
    if ((getDeleteMethod = WorkflowExecutionCommandControllerGrpc.getDeleteMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getDeleteMethod = WorkflowExecutionCommandControllerGrpc.getDeleteMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getDeleteMethod = getDeleteMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.commons.apiresource.ApiResourceId, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "delete"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.commons.apiresource.ApiResourceId.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("delete"))
              .build();
        }
      }
    }
    return getDeleteMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SendSignalInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getSendSignalMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "sendSignal",
      requestType = ai.stigmer.agentic.workflowexecution.v1.SendSignalInput.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SendSignalInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getSendSignalMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.SendSignalInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getSendSignalMethod;
    if ((getSendSignalMethod = WorkflowExecutionCommandControllerGrpc.getSendSignalMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getSendSignalMethod = WorkflowExecutionCommandControllerGrpc.getSendSignalMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getSendSignalMethod = getSendSignalMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.SendSignalInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "sendSignal"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.SendSignalInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("sendSignal"))
              .build();
        }
      }
    }
    return getSendSignalMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getCancelMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "cancel",
      requestType = ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getCancelMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getCancelMethod;
    if ((getCancelMethod = WorkflowExecutionCommandControllerGrpc.getCancelMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getCancelMethod = WorkflowExecutionCommandControllerGrpc.getCancelMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getCancelMethod = getCancelMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "cancel"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("cancel"))
              .build();
        }
      }
    }
    return getCancelMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getTerminateMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "terminate",
      requestType = ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getTerminateMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getTerminateMethod;
    if ((getTerminateMethod = WorkflowExecutionCommandControllerGrpc.getTerminateMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getTerminateMethod = WorkflowExecutionCommandControllerGrpc.getTerminateMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getTerminateMethod = getTerminateMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "terminate"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("terminate"))
              .build();
        }
      }
    }
    return getTerminateMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getRecoverMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "recover",
      requestType = ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getRecoverMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getRecoverMethod;
    if ((getRecoverMethod = WorkflowExecutionCommandControllerGrpc.getRecoverMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getRecoverMethod = WorkflowExecutionCommandControllerGrpc.getRecoverMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getRecoverMethod = getRecoverMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "recover"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("recover"))
              .build();
        }
      }
    }
    return getRecoverMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getPauseMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "pause",
      requestType = ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getPauseMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getPauseMethod;
    if ((getPauseMethod = WorkflowExecutionCommandControllerGrpc.getPauseMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getPauseMethod = WorkflowExecutionCommandControllerGrpc.getPauseMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getPauseMethod = getPauseMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "pause"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("pause"))
              .build();
        }
      }
    }
    return getPauseMethod;
  }

  private static volatile io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getResumeMethod;

  @io.grpc.stub.annotations.RpcMethod(
      fullMethodName = SERVICE_NAME + '/' + "resume",
      requestType = ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput.class,
      responseType = ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.class,
      methodType = io.grpc.MethodDescriptor.MethodType.UNARY)
  public static io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput,
      ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getResumeMethod() {
    io.grpc.MethodDescriptor<ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> getResumeMethod;
    if ((getResumeMethod = WorkflowExecutionCommandControllerGrpc.getResumeMethod) == null) {
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        if ((getResumeMethod = WorkflowExecutionCommandControllerGrpc.getResumeMethod) == null) {
          WorkflowExecutionCommandControllerGrpc.getResumeMethod = getResumeMethod =
              io.grpc.MethodDescriptor.<ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput, ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>newBuilder()
              .setType(io.grpc.MethodDescriptor.MethodType.UNARY)
              .setFullMethodName(generateFullMethodName(SERVICE_NAME, "resume"))
              .setSampledToLocalTracing(true)
              .setRequestMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput.getDefaultInstance()))
              .setResponseMarshaller(io.grpc.protobuf.ProtoUtils.marshaller(
                  ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution.getDefaultInstance()))
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerMethodDescriptorSupplier("resume"))
              .build();
        }
      }
    }
    return getResumeMethod;
  }

  /**
   * Creates a new async stub that supports all call types for the service
   */
  public static WorkflowExecutionCommandControllerStub newStub(io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionCommandControllerStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionCommandControllerStub>() {
        @java.lang.Override
        public WorkflowExecutionCommandControllerStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowExecutionCommandControllerStub(channel, callOptions);
        }
      };
    return WorkflowExecutionCommandControllerStub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports all types of calls on the service
   */
  public static WorkflowExecutionCommandControllerBlockingV2Stub newBlockingV2Stub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionCommandControllerBlockingV2Stub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionCommandControllerBlockingV2Stub>() {
        @java.lang.Override
        public WorkflowExecutionCommandControllerBlockingV2Stub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowExecutionCommandControllerBlockingV2Stub(channel, callOptions);
        }
      };
    return WorkflowExecutionCommandControllerBlockingV2Stub.newStub(factory, channel);
  }

  /**
   * Creates a new blocking-style stub that supports unary and streaming output calls on the service
   */
  public static WorkflowExecutionCommandControllerBlockingStub newBlockingStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionCommandControllerBlockingStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionCommandControllerBlockingStub>() {
        @java.lang.Override
        public WorkflowExecutionCommandControllerBlockingStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowExecutionCommandControllerBlockingStub(channel, callOptions);
        }
      };
    return WorkflowExecutionCommandControllerBlockingStub.newStub(factory, channel);
  }

  /**
   * Creates a new ListenableFuture-style stub that supports unary calls on the service
   */
  public static WorkflowExecutionCommandControllerFutureStub newFutureStub(
      io.grpc.Channel channel) {
    io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionCommandControllerFutureStub> factory =
      new io.grpc.stub.AbstractStub.StubFactory<WorkflowExecutionCommandControllerFutureStub>() {
        @java.lang.Override
        public WorkflowExecutionCommandControllerFutureStub newStub(io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
          return new WorkflowExecutionCommandControllerFutureStub(channel, callOptions);
        }
      };
    return WorkflowExecutionCommandControllerFutureStub.newStub(factory, channel);
  }

  /**
   * <pre>
   * WorkflowExecutionCommandController handles write operations (Create, Update, Delete) for WorkflowExecution resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search)
   * Authorization:
   * All RPCs use custom authorization logic implemented in middleware.
   * Custom authorization is needed because:
   * - create: Must verify user has "execute" permission on the referenced WorkflowInstance
   * - update: Only the workflow runner (system) can update execution status, not users
   * Service Options:
   * - api_resource_kind: workflow_execution - Links this service to the WorkflowExecution resource
   * </pre>
   */
  public interface AsyncService {

    /**
     * <pre>
     * Create and trigger a new workflow execution.
     * This RPC creates a WorkflowExecution resource and immediately triggers it for execution.
     * The workflow execution engine picks up the execution and begins processing tasks.
     * &#64;internal
     * Input Validation:
     * - metadata.org must be specified
     * - spec.workflow_instance_id is required and must reference an existing WorkflowInstance
     * - api_version must be exactly "agentic.stigmer.ai/v1"
     * - kind must be exactly "WorkflowExecution"
     * Authorization:
     * Custom authorization verifies:
     * 1. User has "execute" permission on the referenced WorkflowInstance
     * 2. User has access to all referenced Environments (from WorkflowInstance)
     * 3. User has access to all referenced Secrets (from runtime_env secret_refs)
     * Execution Flow:
     * 1. Validate input (proto validation + business rules)
     * 2. Check authorization (user can execute WorkflowInstance)
     * 3. Create WorkflowExecution resource in database
     * 4. Set initial status.phase = EXECUTION_PENDING
     * 5. Trigger workflow in execution engine (Temporal)
     * 6. Return WorkflowExecution with status.phase = EXECUTION_PENDING or EXECUTION_IN_PROGRESS
     * Status After Create:
     * - status.phase: EXECUTION_PENDING (or EXECUTION_IN_PROGRESS if already picked up)
     * - status.audit.created_at: Current timestamp
     * - status.audit.created_by: Authenticated user ID
     * - status.started_at: Not set yet (set when phase transitions to IN_PROGRESS)
     * Use Cases:
     * 1. API-Triggered Execution:
     * - User calls API to execute a workflow
     * - Input: WorkflowExecution with spec.workflow_instance_id and spec.trigger_message
     * - Output: WorkflowExecution with generated ID and PENDING status
     * 2. Webhook-Triggered Execution:
     * - External system (Stripe, GitHub, etc.) sends webhook
     * - Webhook handler creates WorkflowExecution with webhook payload in spec.trigger_message
     * - spec.trigger_metadata captures webhook source, event type, timestamp
     * 3. Scheduled Execution:
     * - Scheduler service creates WorkflowExecution at scheduled time
     * - spec.trigger_metadata includes schedule ID and cron expression
     * 4. UI-Triggered Execution:
     * - User clicks "Execute" button in web console
     * - UI creates WorkflowExecution with user-provided inputs
     * 5. Workflow Chaining (Workflow A triggers Workflow B):
     * - Workflow A completes, creates WorkflowExecution for Workflow B
     * - spec.trigger_message contains output from Workflow A
     * - spec.trigger_metadata includes parent workflow execution ID
     * Error Cases:
     * - INVALID_ARGUMENT:
     *   - workflow_instance_id is missing or invalid
     *   - org is missing
     *   - api_version or kind is incorrect
     * - PERMISSION_DENIED:
     *   - User doesn't have "execute" permission on WorkflowInstance
     *   - User doesn't have access to referenced Environments
     *   - User doesn't have access to referenced Secrets
     * - NOT_FOUND:
     *   - Referenced WorkflowInstance doesn't exist
     *   - Referenced Environment doesn't exist
     *   - Referenced Secret doesn't exist
     * - FAILED_PRECONDITION:
     *   - WorkflowInstance is in invalid state (e.g., archived, disabled)
     *   - Too many concurrent executions (quota exceeded)
     * Example Request:
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": {
     *     "name": "customer-onboarding-20250111-143022",
     *     "org": "acme"
     *   },
     *   "spec": {
     *     "workflow_instance_id": "wfi_customer-onboarding-prod",
     *     "trigger_message": "New signup: john.doe&#64;example.com",
     *     "trigger_metadata": {
     *       "source": "api",
     *       "caller_id": "usr-jane-admin",
     *       "timestamp": "2025-01-11T14:30:22Z"
     *     },
     *     "runtime_env": {
     *       "CUSTOMER_EMAIL": { "value": "john.doe&#64;example.com" }
     *     }
     *   }
     * }
     * Example Response:
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": {
     *     "id": "wfx_abc123xyz456",  // Auto-generated
     *     "name": "customer-onboarding-20250111-143022",
     *     "org": "acme"
     *   },
     *   "spec": { ... },  // Same as request
     *   "status": {
     *     "phase": 1,  // EXECUTION_PENDING
     *     "audit": {
     *       "created_at": "2025-01-11T14:30:22Z",
     *       "created_by": "usr-jane-admin"
     *     }
     *   }
     * }
     * </pre>
     */
    default void create(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCreateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update an existing workflow execution with full state.
     * &#64;internal
     * Used by users to update execution configuration (spec fields).
     * No individual field updates - always provide complete state.
     * </pre>
     */
    default void update(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Update execution status during workflow execution.
     * &#64;internal
     * System-level RPC used by workflow-runner to send progressive status updates
     * (messages, task states, phase, etc.). Optimized for frequent status updates
     * and merges status fields with existing state.
     * This RPC is used by the workflow execution engine (Temporal) to update the status
     * of a running workflow execution. Users cannot call this RPC directly.
     * What Can Be Updated:
     * - status.phase (PENDING → IN_PROGRESS → COMPLETED/FAILED/CANCELLED)
     * - status.tasks (update task statuses, outputs, errors)
     * - status.output (set final workflow output when COMPLETED)
     * - status.error (set error message when FAILED)
     * - status.started_at (set when execution starts)
     * - status.completed_at (set when execution finishes)
     * What Cannot Be Updated:
     * - spec.* (user inputs are immutable after creation)
     * - metadata.id (resource ID is immutable)
     * - status.audit.created_at (creation timestamp is immutable)
     * Authorization:
     * Custom authorization verifies:
     * 1. Caller is the workflow runner service (system identity, not a user)
     * 2. Only status fields are being modified (spec and metadata unchanged)
     * Update Flow:
     * 1. Workflow runner executes a task
     * 2. Task completes/fails
     * 3. Workflow runner calls updateStatus() with:
     *    - Updated status.tasks (new task status, output/error)
     *    - Updated status.phase (if all tasks done)
     * 4. Backend validates and persists update
     * 5. Backend broadcasts update via WebSocket (for real-time UI updates)
     * Use Cases:
     * 1. Task Started:
     * - Workflow runner updates status.tasks[i].status = IN_PROGRESS
     * 2. Task Completed:
     * - Workflow runner updates status.tasks[i].status = COMPLETED
     * - Workflow runner sets status.tasks[i].output
     * 3. Task Failed:
     * - Workflow runner updates status.tasks[i].status = FAILED
     * - Workflow runner sets status.tasks[i].error
     * - Workflow runner updates status.phase = EXECUTION_FAILED
     * - Workflow runner sets status.error
     * - Workflow runner sets status.completed_at
     * 4. Workflow Completed:
     * - Workflow runner updates status.phase = EXECUTION_COMPLETED
     * - Workflow runner sets status.output
     * - Workflow runner sets status.completed_at
     * 5. Workflow Cancelled:
     * - Workflow runner receives cancellation signal
     * - Workflow runner updates status.phase = EXECUTION_CANCELLED
     * - Workflow runner sets status.completed_at
     * Error Cases:
     * - PERMISSION_DENIED:
     *   - Caller lacks can_edit permission on the workflow execution
     * - INVALID_ARGUMENT:
     *   - Trying to modify spec or metadata (only status can be updated)
     *   - Invalid phase transition (e.g., COMPLETED → IN_PROGRESS)
     * - NOT_FOUND:
     *   - WorkflowExecution with given ID doesn't exist
     * Example Request (Task Completed):
     * {
     *   "metadata": {
     *     "id": "wfx_abc123xyz456"
     *   },
     *   "status": {
     *     "phase": 2,  // EXECUTION_IN_PROGRESS
     *     "completed_tasks": 1,
     *     "tasks": [
     *       {
     *         "task_id": "task-1",
     *         "task_name": "validate_email",
     *         "status": 3,  // WORKFLOW_TASK_COMPLETED
     *         "output": { "valid": true },
     *         "completed_at": "2025-01-11T14:30:27Z"
     *       },
     *       {
     *         "task_id": "task-2",
     *         "task_name": "create_account",
     *         "status": 2,  // WORKFLOW_TASK_IN_PROGRESS
     *         "timestamp": "2025-01-11T14:30:27Z"
     *       }
     *     ]
     *   }
     * }
     * </pre>
     */
    default void updateStatus(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getUpdateStatusMethod(), responseObserver);
    }

    /**
     * <pre>
     * Submit an approval decision for a child agent's tool execution.
     * This RPC forwards the approval decision to the child AgentExecution that
     * is waiting for approval. The child is identified by the child_agent_execution_id
     * in status.pending_approval.
     * When a workflow invokes an agent that requires tool approval, the approval
     * request surfaces at the workflow level via status.pending_approval. Users can
     * submit their decision through this RPC, which forwards it to the child agent.
     * &#64;internal
     * The approval is forwarded to the child via AgentExecution.submitApproval RPC,
     * ensuring consistent validation and Temporal workflow signaling.
     * Preconditions:
     * - status.pending_approval must be populated
     * - tool_call_id must match status.pending_approval.tool_call_id
     * - status.pending_approval.child_agent_execution_id must not be empty
     * - User must have can_edit permission on the workflow execution
     * State Transitions
     * After successful approval:
     * - Approval is forwarded to child AgentExecution
     * - Child agent resumes execution based on action (APPROVE/SKIP/REJECT)
     * - Child agent clears its pending_approval, which triggers signal to parent
     * - WorkflowExecution.status.pending_approval is eventually cleared
     * - Workflow task status returns from WAITING_APPROVAL to IN_PROGRESS
     * Approval Actions
     * - APPROVE: Tool executes with the provided arguments
     * - SKIP: Tool execution is skipped, agent continues with skip message
     * - REJECT: Agent execution fails with rejection error
     * Error Cases
     * - NOT_FOUND: Workflow execution doesn't exist
     * - PERMISSION_DENIED: User doesn't have can_edit permission
     * - FAILED_PRECONDITION: No pending approval, or child agent not waiting
     * - INVALID_ARGUMENT: Tool call ID mismatch, or action is UNSPECIFIED
     * - UNAVAILABLE: Failed to forward to child agent (transient error)
     * Idempotency
     * If the same approval is submitted twice (same workflow execution, tool_call_id,
     * and action), the second call is a no-op if the approval was already processed.
     * Alternative: Direct Agent Approval
     * Users can also submit approvals directly via AgentExecution.submitApproval
     * using the child_agent_execution_id. Both paths are equivalent and result
     * in the same state transitions.
     * &#64;since Phase 5.3 (Approval Forwarding)
     * </pre>
     */
    default void submitApproval(ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSubmitApprovalMethod(), responseObserver);
    }

    /**
     * <pre>
     * Delete a workflow execution.
     * </pre>
     */
    default void delete(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getDeleteMethod(), responseObserver);
    }

    /**
     * <pre>
     * Send a signal to a running workflow execution.
     * Delivers a signal to a workflow execution, typically to unblock a LISTEN task.
     * Delivery is race-proof: the signal is guaranteed to arrive even if sent
     * before the workflow is fully started.
     * &#64;internal
     * Uses Temporal's SignalWithStart API internally for race-proof delivery.
     * Behavior
     * 1. Validates execution exists and is in a signalable phase
     * 2. Uses Temporal SignalWithStart for atomic delivery:
     *    - If workflow exists → sends signal immediately
     *    - If workflow not started yet → starts workflow, then sends signal
     * 3. Signal is delivered to workflow's signal channel
     * 4. LISTEN task waiting for this signal will unblock and continue
     * 5. Returns the current WorkflowExecution state
     * Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot signal terminal executions (COMPLETED, FAILED, CANCELLED, TERMINATED)
     * - User must have can_edit permission on the workflow execution
     * Race-Proof Delivery (SignalWithStart)
     * This RPC uses Temporal's SignalWithStart API to handle the race condition
     * where a signal might arrive before the workflow is fully started:
     * - Traditional SignalWorkflow fails with "WorkflowNotFound" if called too early
     * - SignalWithStart atomically: starts workflow if needed, then sends signal
     * - Guarantees signal delivery even in race conditions
     * Signal Matching
     * The signal_name must match the signal ID defined in the workflow's LISTEN task:
     * Workflow YAML:
     *   - waitForPayment:
     *       listen:
     *         to:
     *           one:
     *             with:
     *               id: payment_confirmed  # &lt;-- signal_name must match this
     *               type: signal
     * API Call:
     *   { "signal_name": "payment_confirmed", "payload": {...} }
     * Error Cases
     * - NOT_FOUND: Workflow execution doesn't exist
     * - PERMISSION_DENIED: User doesn't have can_edit permission
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: execution_id or signal_name is empty
     * Example Request
     * {
     *   "execution_id": "wfx_abc123xyz456",
     *   "signal_name": "payment_confirmed",
     *   "payload": {
     *     "transaction_id": "txn_123",
     *     "amount": 99.99,
     *     "currency": "USD"
     *   }
     * }
     * Example Response
     * Returns the current WorkflowExecution state (phase may still be IN_PROGRESS
     * as the workflow continues after receiving the signal).
     * &#64;since Gap B1 (Signal-With-Start for race-proof event delivery)
     * </pre>
     */
    default void sendSignal(ai.stigmer.agentic.workflowexecution.v1.SendSignalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getSendSignalMethod(), responseObserver);
    }

    /**
     * <pre>
     * Cancel a running workflow execution gracefully.
     * Sends a cancellation signal to the workflow. The workflow code can handle
     * the cancellation signal to perform cleanup (e.g., compensation logic,
     * resource cleanup, notifications) before transitioning to the CANCELLED phase.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow cancel --workflow-id &lt;id&gt;`
     * Behavior
     * 1. Validates execution exists and is in a cancellable phase
     * 2. Sends cancellation signal to Temporal workflow
     * 3. Workflow code receives the signal and can perform cleanup
     * 4. Execution transitions to EXECUTION_CANCELLED phase
     * 5. Returns updated WorkflowExecution with new phase
     * Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot cancel already-terminal executions (COMPLETED, FAILED, CANCELLED, TERMINATED)
     * State Transitions
     * - status.phase: PENDING/IN_PROGRESS → CANCELLED
     * - status.completed_at: Set to current timestamp
     * - In-progress tasks: May complete cleanup or be interrupted
     * Idempotency
     * Cancelling an already-cancelled execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * This ensures safe retry of cancel requests.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase (COMPLETED, FAILED, TERMINATED)
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456",
     *   "reason": "Customer requested cancellation - order no longer needed"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 5,  // EXECUTION_CANCELLED
     *     "completed_at": "2026-02-07T18:30:00Z"
     *   }
     * }
     * </pre>
     */
    default void cancel(ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getCancelMethod(), responseObserver);
    }

    /**
     * <pre>
     * Terminate a workflow execution immediately.
     * Force-stops the workflow without allowing cleanup. Unlike cancel,
     * the workflow code cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive workflows that don't respond to cancellation.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow terminate --workflow-id &lt;id&gt;`
     * Behavior
     * 1. Validates execution exists and is in a terminable phase
     * 2. Force-kills workflow via Temporal (no signal sent to workflow)
     * 3. Execution transitions to EXECUTION_TERMINATED phase immediately
     * 4. No cleanup callbacks or defer blocks are executed
     * 5. Returns updated WorkflowExecution with TERMINATED phase
     * Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot terminate already-terminal executions
     * State Transitions
     * - status.phase: PENDING/IN_PROGRESS → TERMINATED
     * - status.completed_at: Set to current timestamp
     * - status.error: May contain termination reason
     * - In-progress tasks: Stopped abruptly (no cleanup)
     * Terminated vs Cancelled
     * | Aspect | cancel | terminate |
     * |--------|--------|-----------|
     * | Signal to workflow | Yes (can handle) | No |
     * | Cleanup opportunity | Yes | No |
     * | Use case | Normal stop | Stuck workflows |
     * | Can recover? | No | No |
     * Idempotency
     * Terminating an already-terminated execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456",
     *   "reason": "Workflow stuck for 2 hours, not responding to cancel"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 6,  // EXECUTION_TERMINATED
     *     "completed_at": "2026-02-07T18:35:00Z",
     *     "error": "Terminated by operator: Workflow stuck for 2 hours"
     *   }
     * }
     * </pre>
     */
    default void terminate(ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getTerminateMethod(), responseObserver);
    }

    /**
     * <pre>
     * Recover a failed workflow execution from the last checkpoint.
     * Resumes execution from the last successful point. Completed work is
     * preserved - successful tasks are NOT re-executed. This enables
     * "retry and resume" semantics without duplicating side effects.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow reset --workflow-id &lt;id&gt; --type LastWorkflowTask`
     * Behavior
     * 1. Validates execution is in FAILED phase (recoverable)
     * 2. Identifies the last successful checkpoint in workflow history
     * 3. Creates new Temporal run from that checkpoint via ResetWorkflow
     * 4. Execution transitions from FAILED to IN_PROGRESS phase
     * 5. Workflow continues from where it failed
     * 6. Returns updated WorkflowExecution with IN_PROGRESS phase
     * Preconditions
     * - Execution must be in EXECUTION_FAILED phase
     * - TERMINATED executions cannot be recovered (intentional hard stop)
     * - CANCELLED executions cannot be recovered (intentional user action)
     * - COMPLETED executions don't need recovery
     * State Transitions
     * - status.phase: FAILED → IN_PROGRESS
     * - status.completed_at: Cleared (execution is running again)
     * - status.error: Cleared (no longer failed)
     * - Completed tasks: Preserved (not re-executed)
     * - Failed tasks: Reset to pending, will be retried
     * Recovery vs Restart
     * | Aspect | recover | Create new execution |
     * |--------|---------|----------------------|
     * | Completed work | Preserved | Lost (re-executed) |
     * | Side effects | Not duplicated | May duplicate |
     * | Execution ID | Same | New ID |
     * | Use case | Resume after fix | Start fresh |
     * Idempotency
     * If recovery already succeeded (execution is now IN_PROGRESS from a
     * previous recover call), the call succeeds as a no-op and returns
     * the current execution state.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION:
     *   - Execution is not in FAILED phase
     *   - Execution is TERMINATED (cannot recover)
     *   - Execution is CANCELLED (cannot recover)
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456",
     *   "reason": "Stripe API recovered, resuming payment processing"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 2,  // EXECUTION_IN_PROGRESS
     *     "started_at": "2026-02-07T10:00:00Z",
     *     "tasks": [
     *       { "task_id": "task-1", "status": 3 },  // COMPLETED (preserved)
     *       { "task_id": "task-2", "status": 2 }   // IN_PROGRESS (resumed)
     *     ]
     *   }
     * }
     * </pre>
     */
    default void recover(ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getRecoverMethod(), responseObserver);
    }

    /**
     * <pre>
     * Pause a running workflow execution.
     * Temporarily stops the workflow at its current checkpoint. Unlike cancel,
     * the execution is NOT terminal and can be resumed later from where it left off.
     * The workflow gracefully checkpoints and exits, preserving all progress.
     * &#64;internal
     * Behavior
     * 1. Validates execution exists and is in a pausable phase
     * 2. Sends "pause" signal to Temporal workflow
     * 3. Workflow receives signal and sets pauseRequested flag
     * 4. Running activities are gracefully cancelled (checkpoints saved)
     * 5. Execution transitions to EXECUTION_PAUSED phase
     * 6. Workflow waits for resume signal (no resources consumed)
     * 7. Returns updated WorkflowExecution with PAUSED phase
     * Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot pause already-terminal executions (COMPLETED, FAILED, CANCELLED, TERMINATED)
     * State Transitions
     * - status.phase: PENDING/IN_PROGRESS → PAUSED
     * - status.completed_at: NOT set (execution is not finished)
     * - Running activities: Gracefully cancelled, checkpoint saved
     * - LangGraph state: Preserved via thread_id checkpoint
     * Paused vs Cancelled
     * | Aspect | pause | cancel |
     * |--------|-------|--------|
     * | Terminal state? | No | Yes |
     * | Can resume? | Yes (via resume RPC) | No |
     * | Checkpoint saved? | Yes | Best-effort |
     * | Progress preserved? | Yes | No |
     * | Use case | Temporary stop, maintenance | Permanent stop |
     * Agent Activity Behavior
     * When pause is signaled to a workflow running an agent:
     * 1. Workflow cancels the running activity gracefully
     * 2. Python activity catches CancelledError
     * 3. LangGraph saves final checkpoint automatically
     * 4. Activity returns with paused status
     * 5. On resume, activity loads from checkpoint and continues
     * Idempotency
     * Pausing an already-paused execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456",
     *   "reason": "Pausing for scheduled maintenance window"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 7,  // EXECUTION_PAUSED
     *     "started_at": "2026-02-07T10:00:00Z"
     *     // Note: completed_at is NOT set (execution can be resumed)
     *   }
     * }
     * &#64;since Gap A3 (Pause/Resume Propagation)
     * </pre>
     */
    default void pause(ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getPauseMethod(), responseObserver);
    }

    /**
     * <pre>
     * Resume a paused workflow execution.
     * Continues execution from the checkpoint where it was paused. The workflow
     * re-invokes activities with the same thread_id, which loads from checkpoint
     * and continues from where it left off.
     * &#64;internal
     * Behavior
     * 1. Validates execution is in EXECUTION_PAUSED phase
     * 2. Sends "resume" signal to Temporal workflow
     * 3. Workflow receives signal and sets resumeSignalReceived flag
     * 4. Workflow re-invokes activity with same execution context
     * 5. Activity detects resume and loads from LangGraph checkpoint
     * 6. Execution transitions back to EXECUTION_IN_PROGRESS phase
     * 7. Returns updated WorkflowExecution with IN_PROGRESS phase
     * Preconditions
     * - Execution must be in EXECUTION_PAUSED phase
     * - Cannot resume non-paused executions
     * State Transitions
     * - status.phase: PAUSED → IN_PROGRESS
     * - Activities: Re-invoked, load from checkpoint
     * - LangGraph state: Loaded from checkpoint via thread_id
     * Resume Behavior
     * When resume is signaled to a paused workflow:
     * 1. Java workflow unblocks from Workflow.await()
     * 2. Workflow re-invokes the activity with same parameters
     * 3. Python activity reads thread_id from heartbeat_details
     * 4. LangGraph loads checkpoint using thread_id
     * 5. Agent continues from exact position where it was paused
     * Idempotency
     * Resuming an already-running execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is not in PAUSED phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 2,  // EXECUTION_IN_PROGRESS
     *     "started_at": "2026-02-07T10:00:00Z"
     *   }
     * }
     * &#64;since Gap A3 (Pause/Resume Propagation)
     * </pre>
     */
    default void resume(ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ServerCalls.asyncUnimplementedUnaryCall(getResumeMethod(), responseObserver);
    }
  }

  /**
   * Base class for the server implementation of the service WorkflowExecutionCommandController.
   * <pre>
   * WorkflowExecutionCommandController handles write operations (Create, Update, Delete) for WorkflowExecution resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search)
   * Authorization:
   * All RPCs use custom authorization logic implemented in middleware.
   * Custom authorization is needed because:
   * - create: Must verify user has "execute" permission on the referenced WorkflowInstance
   * - update: Only the workflow runner (system) can update execution status, not users
   * Service Options:
   * - api_resource_kind: workflow_execution - Links this service to the WorkflowExecution resource
   * </pre>
   */
  public static abstract class WorkflowExecutionCommandControllerImplBase
      implements io.grpc.BindableService, AsyncService {

    @java.lang.Override public final io.grpc.ServerServiceDefinition bindService() {
      return WorkflowExecutionCommandControllerGrpc.bindService(this);
    }
  }

  /**
   * A stub to allow clients to do asynchronous rpc calls to service WorkflowExecutionCommandController.
   * <pre>
   * WorkflowExecutionCommandController handles write operations (Create, Update, Delete) for WorkflowExecution resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search)
   * Authorization:
   * All RPCs use custom authorization logic implemented in middleware.
   * Custom authorization is needed because:
   * - create: Must verify user has "execute" permission on the referenced WorkflowInstance
   * - update: Only the workflow runner (system) can update execution status, not users
   * Service Options:
   * - api_resource_kind: workflow_execution - Links this service to the WorkflowExecution resource
   * </pre>
   */
  public static final class WorkflowExecutionCommandControllerStub
      extends io.grpc.stub.AbstractAsyncStub<WorkflowExecutionCommandControllerStub> {
    private WorkflowExecutionCommandControllerStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowExecutionCommandControllerStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowExecutionCommandControllerStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new workflow execution.
     * This RPC creates a WorkflowExecution resource and immediately triggers it for execution.
     * The workflow execution engine picks up the execution and begins processing tasks.
     * &#64;internal
     * Input Validation:
     * - metadata.org must be specified
     * - spec.workflow_instance_id is required and must reference an existing WorkflowInstance
     * - api_version must be exactly "agentic.stigmer.ai/v1"
     * - kind must be exactly "WorkflowExecution"
     * Authorization:
     * Custom authorization verifies:
     * 1. User has "execute" permission on the referenced WorkflowInstance
     * 2. User has access to all referenced Environments (from WorkflowInstance)
     * 3. User has access to all referenced Secrets (from runtime_env secret_refs)
     * Execution Flow:
     * 1. Validate input (proto validation + business rules)
     * 2. Check authorization (user can execute WorkflowInstance)
     * 3. Create WorkflowExecution resource in database
     * 4. Set initial status.phase = EXECUTION_PENDING
     * 5. Trigger workflow in execution engine (Temporal)
     * 6. Return WorkflowExecution with status.phase = EXECUTION_PENDING or EXECUTION_IN_PROGRESS
     * Status After Create:
     * - status.phase: EXECUTION_PENDING (or EXECUTION_IN_PROGRESS if already picked up)
     * - status.audit.created_at: Current timestamp
     * - status.audit.created_by: Authenticated user ID
     * - status.started_at: Not set yet (set when phase transitions to IN_PROGRESS)
     * Use Cases:
     * 1. API-Triggered Execution:
     * - User calls API to execute a workflow
     * - Input: WorkflowExecution with spec.workflow_instance_id and spec.trigger_message
     * - Output: WorkflowExecution with generated ID and PENDING status
     * 2. Webhook-Triggered Execution:
     * - External system (Stripe, GitHub, etc.) sends webhook
     * - Webhook handler creates WorkflowExecution with webhook payload in spec.trigger_message
     * - spec.trigger_metadata captures webhook source, event type, timestamp
     * 3. Scheduled Execution:
     * - Scheduler service creates WorkflowExecution at scheduled time
     * - spec.trigger_metadata includes schedule ID and cron expression
     * 4. UI-Triggered Execution:
     * - User clicks "Execute" button in web console
     * - UI creates WorkflowExecution with user-provided inputs
     * 5. Workflow Chaining (Workflow A triggers Workflow B):
     * - Workflow A completes, creates WorkflowExecution for Workflow B
     * - spec.trigger_message contains output from Workflow A
     * - spec.trigger_metadata includes parent workflow execution ID
     * Error Cases:
     * - INVALID_ARGUMENT:
     *   - workflow_instance_id is missing or invalid
     *   - org is missing
     *   - api_version or kind is incorrect
     * - PERMISSION_DENIED:
     *   - User doesn't have "execute" permission on WorkflowInstance
     *   - User doesn't have access to referenced Environments
     *   - User doesn't have access to referenced Secrets
     * - NOT_FOUND:
     *   - Referenced WorkflowInstance doesn't exist
     *   - Referenced Environment doesn't exist
     *   - Referenced Secret doesn't exist
     * - FAILED_PRECONDITION:
     *   - WorkflowInstance is in invalid state (e.g., archived, disabled)
     *   - Too many concurrent executions (quota exceeded)
     * Example Request:
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": {
     *     "name": "customer-onboarding-20250111-143022",
     *     "org": "acme"
     *   },
     *   "spec": {
     *     "workflow_instance_id": "wfi_customer-onboarding-prod",
     *     "trigger_message": "New signup: john.doe&#64;example.com",
     *     "trigger_metadata": {
     *       "source": "api",
     *       "caller_id": "usr-jane-admin",
     *       "timestamp": "2025-01-11T14:30:22Z"
     *     },
     *     "runtime_env": {
     *       "CUSTOMER_EMAIL": { "value": "john.doe&#64;example.com" }
     *     }
     *   }
     * }
     * Example Response:
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": {
     *     "id": "wfx_abc123xyz456",  // Auto-generated
     *     "name": "customer-onboarding-20250111-143022",
     *     "org": "acme"
     *   },
     *   "spec": { ... },  // Same as request
     *   "status": {
     *     "phase": 1,  // EXECUTION_PENDING
     *     "audit": {
     *       "created_at": "2025-01-11T14:30:22Z",
     *       "created_by": "usr-jane-admin"
     *     }
     *   }
     * }
     * </pre>
     */
    public void create(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update an existing workflow execution with full state.
     * &#64;internal
     * Used by users to update execution configuration (spec fields).
     * No individual field updates - always provide complete state.
     * </pre>
     */
    public void update(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Update execution status during workflow execution.
     * &#64;internal
     * System-level RPC used by workflow-runner to send progressive status updates
     * (messages, task states, phase, etc.). Optimized for frequent status updates
     * and merges status fields with existing state.
     * This RPC is used by the workflow execution engine (Temporal) to update the status
     * of a running workflow execution. Users cannot call this RPC directly.
     * What Can Be Updated:
     * - status.phase (PENDING → IN_PROGRESS → COMPLETED/FAILED/CANCELLED)
     * - status.tasks (update task statuses, outputs, errors)
     * - status.output (set final workflow output when COMPLETED)
     * - status.error (set error message when FAILED)
     * - status.started_at (set when execution starts)
     * - status.completed_at (set when execution finishes)
     * What Cannot Be Updated:
     * - spec.* (user inputs are immutable after creation)
     * - metadata.id (resource ID is immutable)
     * - status.audit.created_at (creation timestamp is immutable)
     * Authorization:
     * Custom authorization verifies:
     * 1. Caller is the workflow runner service (system identity, not a user)
     * 2. Only status fields are being modified (spec and metadata unchanged)
     * Update Flow:
     * 1. Workflow runner executes a task
     * 2. Task completes/fails
     * 3. Workflow runner calls updateStatus() with:
     *    - Updated status.tasks (new task status, output/error)
     *    - Updated status.phase (if all tasks done)
     * 4. Backend validates and persists update
     * 5. Backend broadcasts update via WebSocket (for real-time UI updates)
     * Use Cases:
     * 1. Task Started:
     * - Workflow runner updates status.tasks[i].status = IN_PROGRESS
     * 2. Task Completed:
     * - Workflow runner updates status.tasks[i].status = COMPLETED
     * - Workflow runner sets status.tasks[i].output
     * 3. Task Failed:
     * - Workflow runner updates status.tasks[i].status = FAILED
     * - Workflow runner sets status.tasks[i].error
     * - Workflow runner updates status.phase = EXECUTION_FAILED
     * - Workflow runner sets status.error
     * - Workflow runner sets status.completed_at
     * 4. Workflow Completed:
     * - Workflow runner updates status.phase = EXECUTION_COMPLETED
     * - Workflow runner sets status.output
     * - Workflow runner sets status.completed_at
     * 5. Workflow Cancelled:
     * - Workflow runner receives cancellation signal
     * - Workflow runner updates status.phase = EXECUTION_CANCELLED
     * - Workflow runner sets status.completed_at
     * Error Cases:
     * - PERMISSION_DENIED:
     *   - Caller lacks can_edit permission on the workflow execution
     * - INVALID_ARGUMENT:
     *   - Trying to modify spec or metadata (only status can be updated)
     *   - Invalid phase transition (e.g., COMPLETED → IN_PROGRESS)
     * - NOT_FOUND:
     *   - WorkflowExecution with given ID doesn't exist
     * Example Request (Task Completed):
     * {
     *   "metadata": {
     *     "id": "wfx_abc123xyz456"
     *   },
     *   "status": {
     *     "phase": 2,  // EXECUTION_IN_PROGRESS
     *     "completed_tasks": 1,
     *     "tasks": [
     *       {
     *         "task_id": "task-1",
     *         "task_name": "validate_email",
     *         "status": 3,  // WORKFLOW_TASK_COMPLETED
     *         "output": { "valid": true },
     *         "completed_at": "2025-01-11T14:30:27Z"
     *       },
     *       {
     *         "task_id": "task-2",
     *         "task_name": "create_account",
     *         "status": 2,  // WORKFLOW_TASK_IN_PROGRESS
     *         "timestamp": "2025-01-11T14:30:27Z"
     *       }
     *     ]
     *   }
     * }
     * </pre>
     */
    public void updateStatus(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getUpdateStatusMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Submit an approval decision for a child agent's tool execution.
     * This RPC forwards the approval decision to the child AgentExecution that
     * is waiting for approval. The child is identified by the child_agent_execution_id
     * in status.pending_approval.
     * When a workflow invokes an agent that requires tool approval, the approval
     * request surfaces at the workflow level via status.pending_approval. Users can
     * submit their decision through this RPC, which forwards it to the child agent.
     * &#64;internal
     * The approval is forwarded to the child via AgentExecution.submitApproval RPC,
     * ensuring consistent validation and Temporal workflow signaling.
     * Preconditions:
     * - status.pending_approval must be populated
     * - tool_call_id must match status.pending_approval.tool_call_id
     * - status.pending_approval.child_agent_execution_id must not be empty
     * - User must have can_edit permission on the workflow execution
     * State Transitions
     * After successful approval:
     * - Approval is forwarded to child AgentExecution
     * - Child agent resumes execution based on action (APPROVE/SKIP/REJECT)
     * - Child agent clears its pending_approval, which triggers signal to parent
     * - WorkflowExecution.status.pending_approval is eventually cleared
     * - Workflow task status returns from WAITING_APPROVAL to IN_PROGRESS
     * Approval Actions
     * - APPROVE: Tool executes with the provided arguments
     * - SKIP: Tool execution is skipped, agent continues with skip message
     * - REJECT: Agent execution fails with rejection error
     * Error Cases
     * - NOT_FOUND: Workflow execution doesn't exist
     * - PERMISSION_DENIED: User doesn't have can_edit permission
     * - FAILED_PRECONDITION: No pending approval, or child agent not waiting
     * - INVALID_ARGUMENT: Tool call ID mismatch, or action is UNSPECIFIED
     * - UNAVAILABLE: Failed to forward to child agent (transient error)
     * Idempotency
     * If the same approval is submitted twice (same workflow execution, tool_call_id,
     * and action), the second call is a no-op if the approval was already processed.
     * Alternative: Direct Agent Approval
     * Users can also submit approvals directly via AgentExecution.submitApproval
     * using the child_agent_execution_id. Both paths are equivalent and result
     * in the same state transitions.
     * &#64;since Phase 5.3 (Approval Forwarding)
     * </pre>
     */
    public void submitApproval(ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSubmitApprovalMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Delete a workflow execution.
     * </pre>
     */
    public void delete(ai.stigmer.commons.apiresource.ApiResourceId request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Send a signal to a running workflow execution.
     * Delivers a signal to a workflow execution, typically to unblock a LISTEN task.
     * Delivery is race-proof: the signal is guaranteed to arrive even if sent
     * before the workflow is fully started.
     * &#64;internal
     * Uses Temporal's SignalWithStart API internally for race-proof delivery.
     * Behavior
     * 1. Validates execution exists and is in a signalable phase
     * 2. Uses Temporal SignalWithStart for atomic delivery:
     *    - If workflow exists → sends signal immediately
     *    - If workflow not started yet → starts workflow, then sends signal
     * 3. Signal is delivered to workflow's signal channel
     * 4. LISTEN task waiting for this signal will unblock and continue
     * 5. Returns the current WorkflowExecution state
     * Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot signal terminal executions (COMPLETED, FAILED, CANCELLED, TERMINATED)
     * - User must have can_edit permission on the workflow execution
     * Race-Proof Delivery (SignalWithStart)
     * This RPC uses Temporal's SignalWithStart API to handle the race condition
     * where a signal might arrive before the workflow is fully started:
     * - Traditional SignalWorkflow fails with "WorkflowNotFound" if called too early
     * - SignalWithStart atomically: starts workflow if needed, then sends signal
     * - Guarantees signal delivery even in race conditions
     * Signal Matching
     * The signal_name must match the signal ID defined in the workflow's LISTEN task:
     * Workflow YAML:
     *   - waitForPayment:
     *       listen:
     *         to:
     *           one:
     *             with:
     *               id: payment_confirmed  # &lt;-- signal_name must match this
     *               type: signal
     * API Call:
     *   { "signal_name": "payment_confirmed", "payload": {...} }
     * Error Cases
     * - NOT_FOUND: Workflow execution doesn't exist
     * - PERMISSION_DENIED: User doesn't have can_edit permission
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: execution_id or signal_name is empty
     * Example Request
     * {
     *   "execution_id": "wfx_abc123xyz456",
     *   "signal_name": "payment_confirmed",
     *   "payload": {
     *     "transaction_id": "txn_123",
     *     "amount": 99.99,
     *     "currency": "USD"
     *   }
     * }
     * Example Response
     * Returns the current WorkflowExecution state (phase may still be IN_PROGRESS
     * as the workflow continues after receiving the signal).
     * &#64;since Gap B1 (Signal-With-Start for race-proof event delivery)
     * </pre>
     */
    public void sendSignal(ai.stigmer.agentic.workflowexecution.v1.SendSignalInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getSendSignalMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Cancel a running workflow execution gracefully.
     * Sends a cancellation signal to the workflow. The workflow code can handle
     * the cancellation signal to perform cleanup (e.g., compensation logic,
     * resource cleanup, notifications) before transitioning to the CANCELLED phase.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow cancel --workflow-id &lt;id&gt;`
     * Behavior
     * 1. Validates execution exists and is in a cancellable phase
     * 2. Sends cancellation signal to Temporal workflow
     * 3. Workflow code receives the signal and can perform cleanup
     * 4. Execution transitions to EXECUTION_CANCELLED phase
     * 5. Returns updated WorkflowExecution with new phase
     * Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot cancel already-terminal executions (COMPLETED, FAILED, CANCELLED, TERMINATED)
     * State Transitions
     * - status.phase: PENDING/IN_PROGRESS → CANCELLED
     * - status.completed_at: Set to current timestamp
     * - In-progress tasks: May complete cleanup or be interrupted
     * Idempotency
     * Cancelling an already-cancelled execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * This ensures safe retry of cancel requests.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase (COMPLETED, FAILED, TERMINATED)
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456",
     *   "reason": "Customer requested cancellation - order no longer needed"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 5,  // EXECUTION_CANCELLED
     *     "completed_at": "2026-02-07T18:30:00Z"
     *   }
     * }
     * </pre>
     */
    public void cancel(ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getCancelMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Terminate a workflow execution immediately.
     * Force-stops the workflow without allowing cleanup. Unlike cancel,
     * the workflow code cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive workflows that don't respond to cancellation.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow terminate --workflow-id &lt;id&gt;`
     * Behavior
     * 1. Validates execution exists and is in a terminable phase
     * 2. Force-kills workflow via Temporal (no signal sent to workflow)
     * 3. Execution transitions to EXECUTION_TERMINATED phase immediately
     * 4. No cleanup callbacks or defer blocks are executed
     * 5. Returns updated WorkflowExecution with TERMINATED phase
     * Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot terminate already-terminal executions
     * State Transitions
     * - status.phase: PENDING/IN_PROGRESS → TERMINATED
     * - status.completed_at: Set to current timestamp
     * - status.error: May contain termination reason
     * - In-progress tasks: Stopped abruptly (no cleanup)
     * Terminated vs Cancelled
     * | Aspect | cancel | terminate |
     * |--------|--------|-----------|
     * | Signal to workflow | Yes (can handle) | No |
     * | Cleanup opportunity | Yes | No |
     * | Use case | Normal stop | Stuck workflows |
     * | Can recover? | No | No |
     * Idempotency
     * Terminating an already-terminated execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456",
     *   "reason": "Workflow stuck for 2 hours, not responding to cancel"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 6,  // EXECUTION_TERMINATED
     *     "completed_at": "2026-02-07T18:35:00Z",
     *     "error": "Terminated by operator: Workflow stuck for 2 hours"
     *   }
     * }
     * </pre>
     */
    public void terminate(ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getTerminateMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Recover a failed workflow execution from the last checkpoint.
     * Resumes execution from the last successful point. Completed work is
     * preserved - successful tasks are NOT re-executed. This enables
     * "retry and resume" semantics without duplicating side effects.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow reset --workflow-id &lt;id&gt; --type LastWorkflowTask`
     * Behavior
     * 1. Validates execution is in FAILED phase (recoverable)
     * 2. Identifies the last successful checkpoint in workflow history
     * 3. Creates new Temporal run from that checkpoint via ResetWorkflow
     * 4. Execution transitions from FAILED to IN_PROGRESS phase
     * 5. Workflow continues from where it failed
     * 6. Returns updated WorkflowExecution with IN_PROGRESS phase
     * Preconditions
     * - Execution must be in EXECUTION_FAILED phase
     * - TERMINATED executions cannot be recovered (intentional hard stop)
     * - CANCELLED executions cannot be recovered (intentional user action)
     * - COMPLETED executions don't need recovery
     * State Transitions
     * - status.phase: FAILED → IN_PROGRESS
     * - status.completed_at: Cleared (execution is running again)
     * - status.error: Cleared (no longer failed)
     * - Completed tasks: Preserved (not re-executed)
     * - Failed tasks: Reset to pending, will be retried
     * Recovery vs Restart
     * | Aspect | recover | Create new execution |
     * |--------|---------|----------------------|
     * | Completed work | Preserved | Lost (re-executed) |
     * | Side effects | Not duplicated | May duplicate |
     * | Execution ID | Same | New ID |
     * | Use case | Resume after fix | Start fresh |
     * Idempotency
     * If recovery already succeeded (execution is now IN_PROGRESS from a
     * previous recover call), the call succeeds as a no-op and returns
     * the current execution state.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION:
     *   - Execution is not in FAILED phase
     *   - Execution is TERMINATED (cannot recover)
     *   - Execution is CANCELLED (cannot recover)
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456",
     *   "reason": "Stripe API recovered, resuming payment processing"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 2,  // EXECUTION_IN_PROGRESS
     *     "started_at": "2026-02-07T10:00:00Z",
     *     "tasks": [
     *       { "task_id": "task-1", "status": 3 },  // COMPLETED (preserved)
     *       { "task_id": "task-2", "status": 2 }   // IN_PROGRESS (resumed)
     *     ]
     *   }
     * }
     * </pre>
     */
    public void recover(ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getRecoverMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Pause a running workflow execution.
     * Temporarily stops the workflow at its current checkpoint. Unlike cancel,
     * the execution is NOT terminal and can be resumed later from where it left off.
     * The workflow gracefully checkpoints and exits, preserving all progress.
     * &#64;internal
     * Behavior
     * 1. Validates execution exists and is in a pausable phase
     * 2. Sends "pause" signal to Temporal workflow
     * 3. Workflow receives signal and sets pauseRequested flag
     * 4. Running activities are gracefully cancelled (checkpoints saved)
     * 5. Execution transitions to EXECUTION_PAUSED phase
     * 6. Workflow waits for resume signal (no resources consumed)
     * 7. Returns updated WorkflowExecution with PAUSED phase
     * Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot pause already-terminal executions (COMPLETED, FAILED, CANCELLED, TERMINATED)
     * State Transitions
     * - status.phase: PENDING/IN_PROGRESS → PAUSED
     * - status.completed_at: NOT set (execution is not finished)
     * - Running activities: Gracefully cancelled, checkpoint saved
     * - LangGraph state: Preserved via thread_id checkpoint
     * Paused vs Cancelled
     * | Aspect | pause | cancel |
     * |--------|-------|--------|
     * | Terminal state? | No | Yes |
     * | Can resume? | Yes (via resume RPC) | No |
     * | Checkpoint saved? | Yes | Best-effort |
     * | Progress preserved? | Yes | No |
     * | Use case | Temporary stop, maintenance | Permanent stop |
     * Agent Activity Behavior
     * When pause is signaled to a workflow running an agent:
     * 1. Workflow cancels the running activity gracefully
     * 2. Python activity catches CancelledError
     * 3. LangGraph saves final checkpoint automatically
     * 4. Activity returns with paused status
     * 5. On resume, activity loads from checkpoint and continues
     * Idempotency
     * Pausing an already-paused execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456",
     *   "reason": "Pausing for scheduled maintenance window"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 7,  // EXECUTION_PAUSED
     *     "started_at": "2026-02-07T10:00:00Z"
     *     // Note: completed_at is NOT set (execution can be resumed)
     *   }
     * }
     * &#64;since Gap A3 (Pause/Resume Propagation)
     * </pre>
     */
    public void pause(ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getPauseMethod(), getCallOptions()), request, responseObserver);
    }

    /**
     * <pre>
     * Resume a paused workflow execution.
     * Continues execution from the checkpoint where it was paused. The workflow
     * re-invokes activities with the same thread_id, which loads from checkpoint
     * and continues from where it left off.
     * &#64;internal
     * Behavior
     * 1. Validates execution is in EXECUTION_PAUSED phase
     * 2. Sends "resume" signal to Temporal workflow
     * 3. Workflow receives signal and sets resumeSignalReceived flag
     * 4. Workflow re-invokes activity with same execution context
     * 5. Activity detects resume and loads from LangGraph checkpoint
     * 6. Execution transitions back to EXECUTION_IN_PROGRESS phase
     * 7. Returns updated WorkflowExecution with IN_PROGRESS phase
     * Preconditions
     * - Execution must be in EXECUTION_PAUSED phase
     * - Cannot resume non-paused executions
     * State Transitions
     * - status.phase: PAUSED → IN_PROGRESS
     * - Activities: Re-invoked, load from checkpoint
     * - LangGraph state: Loaded from checkpoint via thread_id
     * Resume Behavior
     * When resume is signaled to a paused workflow:
     * 1. Java workflow unblocks from Workflow.await()
     * 2. Workflow re-invokes the activity with same parameters
     * 3. Python activity reads thread_id from heartbeat_details
     * 4. LangGraph loads checkpoint using thread_id
     * 5. Agent continues from exact position where it was paused
     * Idempotency
     * Resuming an already-running execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is not in PAUSED phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 2,  // EXECUTION_IN_PROGRESS
     *     "started_at": "2026-02-07T10:00:00Z"
     *   }
     * }
     * &#64;since Gap A3 (Pause/Resume Propagation)
     * </pre>
     */
    public void resume(ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput request,
        io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> responseObserver) {
      io.grpc.stub.ClientCalls.asyncUnaryCall(
          getChannel().newCall(getResumeMethod(), getCallOptions()), request, responseObserver);
    }
  }

  /**
   * A stub to allow clients to do synchronous rpc calls to service WorkflowExecutionCommandController.
   * <pre>
   * WorkflowExecutionCommandController handles write operations (Create, Update, Delete) for WorkflowExecution resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search)
   * Authorization:
   * All RPCs use custom authorization logic implemented in middleware.
   * Custom authorization is needed because:
   * - create: Must verify user has "execute" permission on the referenced WorkflowInstance
   * - update: Only the workflow runner (system) can update execution status, not users
   * Service Options:
   * - api_resource_kind: workflow_execution - Links this service to the WorkflowExecution resource
   * </pre>
   */
  public static final class WorkflowExecutionCommandControllerBlockingV2Stub
      extends io.grpc.stub.AbstractBlockingStub<WorkflowExecutionCommandControllerBlockingV2Stub> {
    private WorkflowExecutionCommandControllerBlockingV2Stub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowExecutionCommandControllerBlockingV2Stub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowExecutionCommandControllerBlockingV2Stub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new workflow execution.
     * This RPC creates a WorkflowExecution resource and immediately triggers it for execution.
     * The workflow execution engine picks up the execution and begins processing tasks.
     * &#64;internal
     * Input Validation:
     * - metadata.org must be specified
     * - spec.workflow_instance_id is required and must reference an existing WorkflowInstance
     * - api_version must be exactly "agentic.stigmer.ai/v1"
     * - kind must be exactly "WorkflowExecution"
     * Authorization:
     * Custom authorization verifies:
     * 1. User has "execute" permission on the referenced WorkflowInstance
     * 2. User has access to all referenced Environments (from WorkflowInstance)
     * 3. User has access to all referenced Secrets (from runtime_env secret_refs)
     * Execution Flow:
     * 1. Validate input (proto validation + business rules)
     * 2. Check authorization (user can execute WorkflowInstance)
     * 3. Create WorkflowExecution resource in database
     * 4. Set initial status.phase = EXECUTION_PENDING
     * 5. Trigger workflow in execution engine (Temporal)
     * 6. Return WorkflowExecution with status.phase = EXECUTION_PENDING or EXECUTION_IN_PROGRESS
     * Status After Create:
     * - status.phase: EXECUTION_PENDING (or EXECUTION_IN_PROGRESS if already picked up)
     * - status.audit.created_at: Current timestamp
     * - status.audit.created_by: Authenticated user ID
     * - status.started_at: Not set yet (set when phase transitions to IN_PROGRESS)
     * Use Cases:
     * 1. API-Triggered Execution:
     * - User calls API to execute a workflow
     * - Input: WorkflowExecution with spec.workflow_instance_id and spec.trigger_message
     * - Output: WorkflowExecution with generated ID and PENDING status
     * 2. Webhook-Triggered Execution:
     * - External system (Stripe, GitHub, etc.) sends webhook
     * - Webhook handler creates WorkflowExecution with webhook payload in spec.trigger_message
     * - spec.trigger_metadata captures webhook source, event type, timestamp
     * 3. Scheduled Execution:
     * - Scheduler service creates WorkflowExecution at scheduled time
     * - spec.trigger_metadata includes schedule ID and cron expression
     * 4. UI-Triggered Execution:
     * - User clicks "Execute" button in web console
     * - UI creates WorkflowExecution with user-provided inputs
     * 5. Workflow Chaining (Workflow A triggers Workflow B):
     * - Workflow A completes, creates WorkflowExecution for Workflow B
     * - spec.trigger_message contains output from Workflow A
     * - spec.trigger_metadata includes parent workflow execution ID
     * Error Cases:
     * - INVALID_ARGUMENT:
     *   - workflow_instance_id is missing or invalid
     *   - org is missing
     *   - api_version or kind is incorrect
     * - PERMISSION_DENIED:
     *   - User doesn't have "execute" permission on WorkflowInstance
     *   - User doesn't have access to referenced Environments
     *   - User doesn't have access to referenced Secrets
     * - NOT_FOUND:
     *   - Referenced WorkflowInstance doesn't exist
     *   - Referenced Environment doesn't exist
     *   - Referenced Secret doesn't exist
     * - FAILED_PRECONDITION:
     *   - WorkflowInstance is in invalid state (e.g., archived, disabled)
     *   - Too many concurrent executions (quota exceeded)
     * Example Request:
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": {
     *     "name": "customer-onboarding-20250111-143022",
     *     "org": "acme"
     *   },
     *   "spec": {
     *     "workflow_instance_id": "wfi_customer-onboarding-prod",
     *     "trigger_message": "New signup: john.doe&#64;example.com",
     *     "trigger_metadata": {
     *       "source": "api",
     *       "caller_id": "usr-jane-admin",
     *       "timestamp": "2025-01-11T14:30:22Z"
     *     },
     *     "runtime_env": {
     *       "CUSTOMER_EMAIL": { "value": "john.doe&#64;example.com" }
     *     }
     *   }
     * }
     * Example Response:
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": {
     *     "id": "wfx_abc123xyz456",  // Auto-generated
     *     "name": "customer-onboarding-20250111-143022",
     *     "org": "acme"
     *   },
     *   "spec": { ... },  // Same as request
     *   "status": {
     *     "phase": 1,  // EXECUTION_PENDING
     *     "audit": {
     *       "created_at": "2025-01-11T14:30:22Z",
     *       "created_by": "usr-jane-admin"
     *     }
     *   }
     * }
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution create(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing workflow execution with full state.
     * &#64;internal
     * Used by users to update execution configuration (spec fields).
     * No individual field updates - always provide complete state.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution update(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update execution status during workflow execution.
     * &#64;internal
     * System-level RPC used by workflow-runner to send progressive status updates
     * (messages, task states, phase, etc.). Optimized for frequent status updates
     * and merges status fields with existing state.
     * This RPC is used by the workflow execution engine (Temporal) to update the status
     * of a running workflow execution. Users cannot call this RPC directly.
     * What Can Be Updated:
     * - status.phase (PENDING → IN_PROGRESS → COMPLETED/FAILED/CANCELLED)
     * - status.tasks (update task statuses, outputs, errors)
     * - status.output (set final workflow output when COMPLETED)
     * - status.error (set error message when FAILED)
     * - status.started_at (set when execution starts)
     * - status.completed_at (set when execution finishes)
     * What Cannot Be Updated:
     * - spec.* (user inputs are immutable after creation)
     * - metadata.id (resource ID is immutable)
     * - status.audit.created_at (creation timestamp is immutable)
     * Authorization:
     * Custom authorization verifies:
     * 1. Caller is the workflow runner service (system identity, not a user)
     * 2. Only status fields are being modified (spec and metadata unchanged)
     * Update Flow:
     * 1. Workflow runner executes a task
     * 2. Task completes/fails
     * 3. Workflow runner calls updateStatus() with:
     *    - Updated status.tasks (new task status, output/error)
     *    - Updated status.phase (if all tasks done)
     * 4. Backend validates and persists update
     * 5. Backend broadcasts update via WebSocket (for real-time UI updates)
     * Use Cases:
     * 1. Task Started:
     * - Workflow runner updates status.tasks[i].status = IN_PROGRESS
     * 2. Task Completed:
     * - Workflow runner updates status.tasks[i].status = COMPLETED
     * - Workflow runner sets status.tasks[i].output
     * 3. Task Failed:
     * - Workflow runner updates status.tasks[i].status = FAILED
     * - Workflow runner sets status.tasks[i].error
     * - Workflow runner updates status.phase = EXECUTION_FAILED
     * - Workflow runner sets status.error
     * - Workflow runner sets status.completed_at
     * 4. Workflow Completed:
     * - Workflow runner updates status.phase = EXECUTION_COMPLETED
     * - Workflow runner sets status.output
     * - Workflow runner sets status.completed_at
     * 5. Workflow Cancelled:
     * - Workflow runner receives cancellation signal
     * - Workflow runner updates status.phase = EXECUTION_CANCELLED
     * - Workflow runner sets status.completed_at
     * Error Cases:
     * - PERMISSION_DENIED:
     *   - Caller lacks can_edit permission on the workflow execution
     * - INVALID_ARGUMENT:
     *   - Trying to modify spec or metadata (only status can be updated)
     *   - Invalid phase transition (e.g., COMPLETED → IN_PROGRESS)
     * - NOT_FOUND:
     *   - WorkflowExecution with given ID doesn't exist
     * Example Request (Task Completed):
     * {
     *   "metadata": {
     *     "id": "wfx_abc123xyz456"
     *   },
     *   "status": {
     *     "phase": 2,  // EXECUTION_IN_PROGRESS
     *     "completed_tasks": 1,
     *     "tasks": [
     *       {
     *         "task_id": "task-1",
     *         "task_name": "validate_email",
     *         "status": 3,  // WORKFLOW_TASK_COMPLETED
     *         "output": { "valid": true },
     *         "completed_at": "2025-01-11T14:30:27Z"
     *       },
     *       {
     *         "task_id": "task-2",
     *         "task_name": "create_account",
     *         "status": 2,  // WORKFLOW_TASK_IN_PROGRESS
     *         "timestamp": "2025-01-11T14:30:27Z"
     *       }
     *     ]
     *   }
     * }
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution updateStatus(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getUpdateStatusMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit an approval decision for a child agent's tool execution.
     * This RPC forwards the approval decision to the child AgentExecution that
     * is waiting for approval. The child is identified by the child_agent_execution_id
     * in status.pending_approval.
     * When a workflow invokes an agent that requires tool approval, the approval
     * request surfaces at the workflow level via status.pending_approval. Users can
     * submit their decision through this RPC, which forwards it to the child agent.
     * &#64;internal
     * The approval is forwarded to the child via AgentExecution.submitApproval RPC,
     * ensuring consistent validation and Temporal workflow signaling.
     * Preconditions:
     * - status.pending_approval must be populated
     * - tool_call_id must match status.pending_approval.tool_call_id
     * - status.pending_approval.child_agent_execution_id must not be empty
     * - User must have can_edit permission on the workflow execution
     * State Transitions
     * After successful approval:
     * - Approval is forwarded to child AgentExecution
     * - Child agent resumes execution based on action (APPROVE/SKIP/REJECT)
     * - Child agent clears its pending_approval, which triggers signal to parent
     * - WorkflowExecution.status.pending_approval is eventually cleared
     * - Workflow task status returns from WAITING_APPROVAL to IN_PROGRESS
     * Approval Actions
     * - APPROVE: Tool executes with the provided arguments
     * - SKIP: Tool execution is skipped, agent continues with skip message
     * - REJECT: Agent execution fails with rejection error
     * Error Cases
     * - NOT_FOUND: Workflow execution doesn't exist
     * - PERMISSION_DENIED: User doesn't have can_edit permission
     * - FAILED_PRECONDITION: No pending approval, or child agent not waiting
     * - INVALID_ARGUMENT: Tool call ID mismatch, or action is UNSPECIFIED
     * - UNAVAILABLE: Failed to forward to child agent (transient error)
     * Idempotency
     * If the same approval is submitted twice (same workflow execution, tool_call_id,
     * and action), the second call is a no-op if the approval was already processed.
     * Alternative: Direct Agent Approval
     * Users can also submit approvals directly via AgentExecution.submitApproval
     * using the child_agent_execution_id. Both paths are equivalent and result
     * in the same state transitions.
     * &#64;since Phase 5.3 (Approval Forwarding)
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution submitApproval(ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSubmitApprovalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a workflow execution.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution delete(ai.stigmer.commons.apiresource.ApiResourceId request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Send a signal to a running workflow execution.
     * Delivers a signal to a workflow execution, typically to unblock a LISTEN task.
     * Delivery is race-proof: the signal is guaranteed to arrive even if sent
     * before the workflow is fully started.
     * &#64;internal
     * Uses Temporal's SignalWithStart API internally for race-proof delivery.
     * Behavior
     * 1. Validates execution exists and is in a signalable phase
     * 2. Uses Temporal SignalWithStart for atomic delivery:
     *    - If workflow exists → sends signal immediately
     *    - If workflow not started yet → starts workflow, then sends signal
     * 3. Signal is delivered to workflow's signal channel
     * 4. LISTEN task waiting for this signal will unblock and continue
     * 5. Returns the current WorkflowExecution state
     * Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot signal terminal executions (COMPLETED, FAILED, CANCELLED, TERMINATED)
     * - User must have can_edit permission on the workflow execution
     * Race-Proof Delivery (SignalWithStart)
     * This RPC uses Temporal's SignalWithStart API to handle the race condition
     * where a signal might arrive before the workflow is fully started:
     * - Traditional SignalWorkflow fails with "WorkflowNotFound" if called too early
     * - SignalWithStart atomically: starts workflow if needed, then sends signal
     * - Guarantees signal delivery even in race conditions
     * Signal Matching
     * The signal_name must match the signal ID defined in the workflow's LISTEN task:
     * Workflow YAML:
     *   - waitForPayment:
     *       listen:
     *         to:
     *           one:
     *             with:
     *               id: payment_confirmed  # &lt;-- signal_name must match this
     *               type: signal
     * API Call:
     *   { "signal_name": "payment_confirmed", "payload": {...} }
     * Error Cases
     * - NOT_FOUND: Workflow execution doesn't exist
     * - PERMISSION_DENIED: User doesn't have can_edit permission
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: execution_id or signal_name is empty
     * Example Request
     * {
     *   "execution_id": "wfx_abc123xyz456",
     *   "signal_name": "payment_confirmed",
     *   "payload": {
     *     "transaction_id": "txn_123",
     *     "amount": 99.99,
     *     "currency": "USD"
     *   }
     * }
     * Example Response
     * Returns the current WorkflowExecution state (phase may still be IN_PROGRESS
     * as the workflow continues after receiving the signal).
     * &#64;since Gap B1 (Signal-With-Start for race-proof event delivery)
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution sendSignal(ai.stigmer.agentic.workflowexecution.v1.SendSignalInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getSendSignalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cancel a running workflow execution gracefully.
     * Sends a cancellation signal to the workflow. The workflow code can handle
     * the cancellation signal to perform cleanup (e.g., compensation logic,
     * resource cleanup, notifications) before transitioning to the CANCELLED phase.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow cancel --workflow-id &lt;id&gt;`
     * Behavior
     * 1. Validates execution exists and is in a cancellable phase
     * 2. Sends cancellation signal to Temporal workflow
     * 3. Workflow code receives the signal and can perform cleanup
     * 4. Execution transitions to EXECUTION_CANCELLED phase
     * 5. Returns updated WorkflowExecution with new phase
     * Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot cancel already-terminal executions (COMPLETED, FAILED, CANCELLED, TERMINATED)
     * State Transitions
     * - status.phase: PENDING/IN_PROGRESS → CANCELLED
     * - status.completed_at: Set to current timestamp
     * - In-progress tasks: May complete cleanup or be interrupted
     * Idempotency
     * Cancelling an already-cancelled execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * This ensures safe retry of cancel requests.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase (COMPLETED, FAILED, TERMINATED)
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456",
     *   "reason": "Customer requested cancellation - order no longer needed"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 5,  // EXECUTION_CANCELLED
     *     "completed_at": "2026-02-07T18:30:00Z"
     *   }
     * }
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution cancel(ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getCancelMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Terminate a workflow execution immediately.
     * Force-stops the workflow without allowing cleanup. Unlike cancel,
     * the workflow code cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive workflows that don't respond to cancellation.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow terminate --workflow-id &lt;id&gt;`
     * Behavior
     * 1. Validates execution exists and is in a terminable phase
     * 2. Force-kills workflow via Temporal (no signal sent to workflow)
     * 3. Execution transitions to EXECUTION_TERMINATED phase immediately
     * 4. No cleanup callbacks or defer blocks are executed
     * 5. Returns updated WorkflowExecution with TERMINATED phase
     * Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot terminate already-terminal executions
     * State Transitions
     * - status.phase: PENDING/IN_PROGRESS → TERMINATED
     * - status.completed_at: Set to current timestamp
     * - status.error: May contain termination reason
     * - In-progress tasks: Stopped abruptly (no cleanup)
     * Terminated vs Cancelled
     * | Aspect | cancel | terminate |
     * |--------|--------|-----------|
     * | Signal to workflow | Yes (can handle) | No |
     * | Cleanup opportunity | Yes | No |
     * | Use case | Normal stop | Stuck workflows |
     * | Can recover? | No | No |
     * Idempotency
     * Terminating an already-terminated execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456",
     *   "reason": "Workflow stuck for 2 hours, not responding to cancel"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 6,  // EXECUTION_TERMINATED
     *     "completed_at": "2026-02-07T18:35:00Z",
     *     "error": "Terminated by operator: Workflow stuck for 2 hours"
     *   }
     * }
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution terminate(ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getTerminateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Recover a failed workflow execution from the last checkpoint.
     * Resumes execution from the last successful point. Completed work is
     * preserved - successful tasks are NOT re-executed. This enables
     * "retry and resume" semantics without duplicating side effects.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow reset --workflow-id &lt;id&gt; --type LastWorkflowTask`
     * Behavior
     * 1. Validates execution is in FAILED phase (recoverable)
     * 2. Identifies the last successful checkpoint in workflow history
     * 3. Creates new Temporal run from that checkpoint via ResetWorkflow
     * 4. Execution transitions from FAILED to IN_PROGRESS phase
     * 5. Workflow continues from where it failed
     * 6. Returns updated WorkflowExecution with IN_PROGRESS phase
     * Preconditions
     * - Execution must be in EXECUTION_FAILED phase
     * - TERMINATED executions cannot be recovered (intentional hard stop)
     * - CANCELLED executions cannot be recovered (intentional user action)
     * - COMPLETED executions don't need recovery
     * State Transitions
     * - status.phase: FAILED → IN_PROGRESS
     * - status.completed_at: Cleared (execution is running again)
     * - status.error: Cleared (no longer failed)
     * - Completed tasks: Preserved (not re-executed)
     * - Failed tasks: Reset to pending, will be retried
     * Recovery vs Restart
     * | Aspect | recover | Create new execution |
     * |--------|---------|----------------------|
     * | Completed work | Preserved | Lost (re-executed) |
     * | Side effects | Not duplicated | May duplicate |
     * | Execution ID | Same | New ID |
     * | Use case | Resume after fix | Start fresh |
     * Idempotency
     * If recovery already succeeded (execution is now IN_PROGRESS from a
     * previous recover call), the call succeeds as a no-op and returns
     * the current execution state.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION:
     *   - Execution is not in FAILED phase
     *   - Execution is TERMINATED (cannot recover)
     *   - Execution is CANCELLED (cannot recover)
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456",
     *   "reason": "Stripe API recovered, resuming payment processing"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 2,  // EXECUTION_IN_PROGRESS
     *     "started_at": "2026-02-07T10:00:00Z",
     *     "tasks": [
     *       { "task_id": "task-1", "status": 3 },  // COMPLETED (preserved)
     *       { "task_id": "task-2", "status": 2 }   // IN_PROGRESS (resumed)
     *     ]
     *   }
     * }
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution recover(ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getRecoverMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Pause a running workflow execution.
     * Temporarily stops the workflow at its current checkpoint. Unlike cancel,
     * the execution is NOT terminal and can be resumed later from where it left off.
     * The workflow gracefully checkpoints and exits, preserving all progress.
     * &#64;internal
     * Behavior
     * 1. Validates execution exists and is in a pausable phase
     * 2. Sends "pause" signal to Temporal workflow
     * 3. Workflow receives signal and sets pauseRequested flag
     * 4. Running activities are gracefully cancelled (checkpoints saved)
     * 5. Execution transitions to EXECUTION_PAUSED phase
     * 6. Workflow waits for resume signal (no resources consumed)
     * 7. Returns updated WorkflowExecution with PAUSED phase
     * Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot pause already-terminal executions (COMPLETED, FAILED, CANCELLED, TERMINATED)
     * State Transitions
     * - status.phase: PENDING/IN_PROGRESS → PAUSED
     * - status.completed_at: NOT set (execution is not finished)
     * - Running activities: Gracefully cancelled, checkpoint saved
     * - LangGraph state: Preserved via thread_id checkpoint
     * Paused vs Cancelled
     * | Aspect | pause | cancel |
     * |--------|-------|--------|
     * | Terminal state? | No | Yes |
     * | Can resume? | Yes (via resume RPC) | No |
     * | Checkpoint saved? | Yes | Best-effort |
     * | Progress preserved? | Yes | No |
     * | Use case | Temporary stop, maintenance | Permanent stop |
     * Agent Activity Behavior
     * When pause is signaled to a workflow running an agent:
     * 1. Workflow cancels the running activity gracefully
     * 2. Python activity catches CancelledError
     * 3. LangGraph saves final checkpoint automatically
     * 4. Activity returns with paused status
     * 5. On resume, activity loads from checkpoint and continues
     * Idempotency
     * Pausing an already-paused execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456",
     *   "reason": "Pausing for scheduled maintenance window"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 7,  // EXECUTION_PAUSED
     *     "started_at": "2026-02-07T10:00:00Z"
     *     // Note: completed_at is NOT set (execution can be resumed)
     *   }
     * }
     * &#64;since Gap A3 (Pause/Resume Propagation)
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution pause(ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getPauseMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Resume a paused workflow execution.
     * Continues execution from the checkpoint where it was paused. The workflow
     * re-invokes activities with the same thread_id, which loads from checkpoint
     * and continues from where it left off.
     * &#64;internal
     * Behavior
     * 1. Validates execution is in EXECUTION_PAUSED phase
     * 2. Sends "resume" signal to Temporal workflow
     * 3. Workflow receives signal and sets resumeSignalReceived flag
     * 4. Workflow re-invokes activity with same execution context
     * 5. Activity detects resume and loads from LangGraph checkpoint
     * 6. Execution transitions back to EXECUTION_IN_PROGRESS phase
     * 7. Returns updated WorkflowExecution with IN_PROGRESS phase
     * Preconditions
     * - Execution must be in EXECUTION_PAUSED phase
     * - Cannot resume non-paused executions
     * State Transitions
     * - status.phase: PAUSED → IN_PROGRESS
     * - Activities: Re-invoked, load from checkpoint
     * - LangGraph state: Loaded from checkpoint via thread_id
     * Resume Behavior
     * When resume is signaled to a paused workflow:
     * 1. Java workflow unblocks from Workflow.await()
     * 2. Workflow re-invokes the activity with same parameters
     * 3. Python activity reads thread_id from heartbeat_details
     * 4. LangGraph loads checkpoint using thread_id
     * 5. Agent continues from exact position where it was paused
     * Idempotency
     * Resuming an already-running execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is not in PAUSED phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 2,  // EXECUTION_IN_PROGRESS
     *     "started_at": "2026-02-07T10:00:00Z"
     *   }
     * }
     * &#64;since Gap A3 (Pause/Resume Propagation)
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution resume(ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput request) throws io.grpc.StatusException {
      return io.grpc.stub.ClientCalls.blockingV2UnaryCall(
          getChannel(), getResumeMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do limited synchronous rpc calls to service WorkflowExecutionCommandController.
   * <pre>
   * WorkflowExecutionCommandController handles write operations (Create, Update, Delete) for WorkflowExecution resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search)
   * Authorization:
   * All RPCs use custom authorization logic implemented in middleware.
   * Custom authorization is needed because:
   * - create: Must verify user has "execute" permission on the referenced WorkflowInstance
   * - update: Only the workflow runner (system) can update execution status, not users
   * Service Options:
   * - api_resource_kind: workflow_execution - Links this service to the WorkflowExecution resource
   * </pre>
   */
  public static final class WorkflowExecutionCommandControllerBlockingStub
      extends io.grpc.stub.AbstractBlockingStub<WorkflowExecutionCommandControllerBlockingStub> {
    private WorkflowExecutionCommandControllerBlockingStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowExecutionCommandControllerBlockingStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowExecutionCommandControllerBlockingStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new workflow execution.
     * This RPC creates a WorkflowExecution resource and immediately triggers it for execution.
     * The workflow execution engine picks up the execution and begins processing tasks.
     * &#64;internal
     * Input Validation:
     * - metadata.org must be specified
     * - spec.workflow_instance_id is required and must reference an existing WorkflowInstance
     * - api_version must be exactly "agentic.stigmer.ai/v1"
     * - kind must be exactly "WorkflowExecution"
     * Authorization:
     * Custom authorization verifies:
     * 1. User has "execute" permission on the referenced WorkflowInstance
     * 2. User has access to all referenced Environments (from WorkflowInstance)
     * 3. User has access to all referenced Secrets (from runtime_env secret_refs)
     * Execution Flow:
     * 1. Validate input (proto validation + business rules)
     * 2. Check authorization (user can execute WorkflowInstance)
     * 3. Create WorkflowExecution resource in database
     * 4. Set initial status.phase = EXECUTION_PENDING
     * 5. Trigger workflow in execution engine (Temporal)
     * 6. Return WorkflowExecution with status.phase = EXECUTION_PENDING or EXECUTION_IN_PROGRESS
     * Status After Create:
     * - status.phase: EXECUTION_PENDING (or EXECUTION_IN_PROGRESS if already picked up)
     * - status.audit.created_at: Current timestamp
     * - status.audit.created_by: Authenticated user ID
     * - status.started_at: Not set yet (set when phase transitions to IN_PROGRESS)
     * Use Cases:
     * 1. API-Triggered Execution:
     * - User calls API to execute a workflow
     * - Input: WorkflowExecution with spec.workflow_instance_id and spec.trigger_message
     * - Output: WorkflowExecution with generated ID and PENDING status
     * 2. Webhook-Triggered Execution:
     * - External system (Stripe, GitHub, etc.) sends webhook
     * - Webhook handler creates WorkflowExecution with webhook payload in spec.trigger_message
     * - spec.trigger_metadata captures webhook source, event type, timestamp
     * 3. Scheduled Execution:
     * - Scheduler service creates WorkflowExecution at scheduled time
     * - spec.trigger_metadata includes schedule ID and cron expression
     * 4. UI-Triggered Execution:
     * - User clicks "Execute" button in web console
     * - UI creates WorkflowExecution with user-provided inputs
     * 5. Workflow Chaining (Workflow A triggers Workflow B):
     * - Workflow A completes, creates WorkflowExecution for Workflow B
     * - spec.trigger_message contains output from Workflow A
     * - spec.trigger_metadata includes parent workflow execution ID
     * Error Cases:
     * - INVALID_ARGUMENT:
     *   - workflow_instance_id is missing or invalid
     *   - org is missing
     *   - api_version or kind is incorrect
     * - PERMISSION_DENIED:
     *   - User doesn't have "execute" permission on WorkflowInstance
     *   - User doesn't have access to referenced Environments
     *   - User doesn't have access to referenced Secrets
     * - NOT_FOUND:
     *   - Referenced WorkflowInstance doesn't exist
     *   - Referenced Environment doesn't exist
     *   - Referenced Secret doesn't exist
     * - FAILED_PRECONDITION:
     *   - WorkflowInstance is in invalid state (e.g., archived, disabled)
     *   - Too many concurrent executions (quota exceeded)
     * Example Request:
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": {
     *     "name": "customer-onboarding-20250111-143022",
     *     "org": "acme"
     *   },
     *   "spec": {
     *     "workflow_instance_id": "wfi_customer-onboarding-prod",
     *     "trigger_message": "New signup: john.doe&#64;example.com",
     *     "trigger_metadata": {
     *       "source": "api",
     *       "caller_id": "usr-jane-admin",
     *       "timestamp": "2025-01-11T14:30:22Z"
     *     },
     *     "runtime_env": {
     *       "CUSTOMER_EMAIL": { "value": "john.doe&#64;example.com" }
     *     }
     *   }
     * }
     * Example Response:
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": {
     *     "id": "wfx_abc123xyz456",  // Auto-generated
     *     "name": "customer-onboarding-20250111-143022",
     *     "org": "acme"
     *   },
     *   "spec": { ... },  // Same as request
     *   "status": {
     *     "phase": 1,  // EXECUTION_PENDING
     *     "audit": {
     *       "created_at": "2025-01-11T14:30:22Z",
     *       "created_by": "usr-jane-admin"
     *     }
     *   }
     * }
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution create(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCreateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update an existing workflow execution with full state.
     * &#64;internal
     * Used by users to update execution configuration (spec fields).
     * No individual field updates - always provide complete state.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution update(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Update execution status during workflow execution.
     * &#64;internal
     * System-level RPC used by workflow-runner to send progressive status updates
     * (messages, task states, phase, etc.). Optimized for frequent status updates
     * and merges status fields with existing state.
     * This RPC is used by the workflow execution engine (Temporal) to update the status
     * of a running workflow execution. Users cannot call this RPC directly.
     * What Can Be Updated:
     * - status.phase (PENDING → IN_PROGRESS → COMPLETED/FAILED/CANCELLED)
     * - status.tasks (update task statuses, outputs, errors)
     * - status.output (set final workflow output when COMPLETED)
     * - status.error (set error message when FAILED)
     * - status.started_at (set when execution starts)
     * - status.completed_at (set when execution finishes)
     * What Cannot Be Updated:
     * - spec.* (user inputs are immutable after creation)
     * - metadata.id (resource ID is immutable)
     * - status.audit.created_at (creation timestamp is immutable)
     * Authorization:
     * Custom authorization verifies:
     * 1. Caller is the workflow runner service (system identity, not a user)
     * 2. Only status fields are being modified (spec and metadata unchanged)
     * Update Flow:
     * 1. Workflow runner executes a task
     * 2. Task completes/fails
     * 3. Workflow runner calls updateStatus() with:
     *    - Updated status.tasks (new task status, output/error)
     *    - Updated status.phase (if all tasks done)
     * 4. Backend validates and persists update
     * 5. Backend broadcasts update via WebSocket (for real-time UI updates)
     * Use Cases:
     * 1. Task Started:
     * - Workflow runner updates status.tasks[i].status = IN_PROGRESS
     * 2. Task Completed:
     * - Workflow runner updates status.tasks[i].status = COMPLETED
     * - Workflow runner sets status.tasks[i].output
     * 3. Task Failed:
     * - Workflow runner updates status.tasks[i].status = FAILED
     * - Workflow runner sets status.tasks[i].error
     * - Workflow runner updates status.phase = EXECUTION_FAILED
     * - Workflow runner sets status.error
     * - Workflow runner sets status.completed_at
     * 4. Workflow Completed:
     * - Workflow runner updates status.phase = EXECUTION_COMPLETED
     * - Workflow runner sets status.output
     * - Workflow runner sets status.completed_at
     * 5. Workflow Cancelled:
     * - Workflow runner receives cancellation signal
     * - Workflow runner updates status.phase = EXECUTION_CANCELLED
     * - Workflow runner sets status.completed_at
     * Error Cases:
     * - PERMISSION_DENIED:
     *   - Caller lacks can_edit permission on the workflow execution
     * - INVALID_ARGUMENT:
     *   - Trying to modify spec or metadata (only status can be updated)
     *   - Invalid phase transition (e.g., COMPLETED → IN_PROGRESS)
     * - NOT_FOUND:
     *   - WorkflowExecution with given ID doesn't exist
     * Example Request (Task Completed):
     * {
     *   "metadata": {
     *     "id": "wfx_abc123xyz456"
     *   },
     *   "status": {
     *     "phase": 2,  // EXECUTION_IN_PROGRESS
     *     "completed_tasks": 1,
     *     "tasks": [
     *       {
     *         "task_id": "task-1",
     *         "task_name": "validate_email",
     *         "status": 3,  // WORKFLOW_TASK_COMPLETED
     *         "output": { "valid": true },
     *         "completed_at": "2025-01-11T14:30:27Z"
     *       },
     *       {
     *         "task_id": "task-2",
     *         "task_name": "create_account",
     *         "status": 2,  // WORKFLOW_TASK_IN_PROGRESS
     *         "timestamp": "2025-01-11T14:30:27Z"
     *       }
     *     ]
     *   }
     * }
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution updateStatus(ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getUpdateStatusMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Submit an approval decision for a child agent's tool execution.
     * This RPC forwards the approval decision to the child AgentExecution that
     * is waiting for approval. The child is identified by the child_agent_execution_id
     * in status.pending_approval.
     * When a workflow invokes an agent that requires tool approval, the approval
     * request surfaces at the workflow level via status.pending_approval. Users can
     * submit their decision through this RPC, which forwards it to the child agent.
     * &#64;internal
     * The approval is forwarded to the child via AgentExecution.submitApproval RPC,
     * ensuring consistent validation and Temporal workflow signaling.
     * Preconditions:
     * - status.pending_approval must be populated
     * - tool_call_id must match status.pending_approval.tool_call_id
     * - status.pending_approval.child_agent_execution_id must not be empty
     * - User must have can_edit permission on the workflow execution
     * State Transitions
     * After successful approval:
     * - Approval is forwarded to child AgentExecution
     * - Child agent resumes execution based on action (APPROVE/SKIP/REJECT)
     * - Child agent clears its pending_approval, which triggers signal to parent
     * - WorkflowExecution.status.pending_approval is eventually cleared
     * - Workflow task status returns from WAITING_APPROVAL to IN_PROGRESS
     * Approval Actions
     * - APPROVE: Tool executes with the provided arguments
     * - SKIP: Tool execution is skipped, agent continues with skip message
     * - REJECT: Agent execution fails with rejection error
     * Error Cases
     * - NOT_FOUND: Workflow execution doesn't exist
     * - PERMISSION_DENIED: User doesn't have can_edit permission
     * - FAILED_PRECONDITION: No pending approval, or child agent not waiting
     * - INVALID_ARGUMENT: Tool call ID mismatch, or action is UNSPECIFIED
     * - UNAVAILABLE: Failed to forward to child agent (transient error)
     * Idempotency
     * If the same approval is submitted twice (same workflow execution, tool_call_id,
     * and action), the second call is a no-op if the approval was already processed.
     * Alternative: Direct Agent Approval
     * Users can also submit approvals directly via AgentExecution.submitApproval
     * using the child_agent_execution_id. Both paths are equivalent and result
     * in the same state transitions.
     * &#64;since Phase 5.3 (Approval Forwarding)
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution submitApproval(ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSubmitApprovalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Delete a workflow execution.
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution delete(ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getDeleteMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Send a signal to a running workflow execution.
     * Delivers a signal to a workflow execution, typically to unblock a LISTEN task.
     * Delivery is race-proof: the signal is guaranteed to arrive even if sent
     * before the workflow is fully started.
     * &#64;internal
     * Uses Temporal's SignalWithStart API internally for race-proof delivery.
     * Behavior
     * 1. Validates execution exists and is in a signalable phase
     * 2. Uses Temporal SignalWithStart for atomic delivery:
     *    - If workflow exists → sends signal immediately
     *    - If workflow not started yet → starts workflow, then sends signal
     * 3. Signal is delivered to workflow's signal channel
     * 4. LISTEN task waiting for this signal will unblock and continue
     * 5. Returns the current WorkflowExecution state
     * Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot signal terminal executions (COMPLETED, FAILED, CANCELLED, TERMINATED)
     * - User must have can_edit permission on the workflow execution
     * Race-Proof Delivery (SignalWithStart)
     * This RPC uses Temporal's SignalWithStart API to handle the race condition
     * where a signal might arrive before the workflow is fully started:
     * - Traditional SignalWorkflow fails with "WorkflowNotFound" if called too early
     * - SignalWithStart atomically: starts workflow if needed, then sends signal
     * - Guarantees signal delivery even in race conditions
     * Signal Matching
     * The signal_name must match the signal ID defined in the workflow's LISTEN task:
     * Workflow YAML:
     *   - waitForPayment:
     *       listen:
     *         to:
     *           one:
     *             with:
     *               id: payment_confirmed  # &lt;-- signal_name must match this
     *               type: signal
     * API Call:
     *   { "signal_name": "payment_confirmed", "payload": {...} }
     * Error Cases
     * - NOT_FOUND: Workflow execution doesn't exist
     * - PERMISSION_DENIED: User doesn't have can_edit permission
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: execution_id or signal_name is empty
     * Example Request
     * {
     *   "execution_id": "wfx_abc123xyz456",
     *   "signal_name": "payment_confirmed",
     *   "payload": {
     *     "transaction_id": "txn_123",
     *     "amount": 99.99,
     *     "currency": "USD"
     *   }
     * }
     * Example Response
     * Returns the current WorkflowExecution state (phase may still be IN_PROGRESS
     * as the workflow continues after receiving the signal).
     * &#64;since Gap B1 (Signal-With-Start for race-proof event delivery)
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution sendSignal(ai.stigmer.agentic.workflowexecution.v1.SendSignalInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getSendSignalMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Cancel a running workflow execution gracefully.
     * Sends a cancellation signal to the workflow. The workflow code can handle
     * the cancellation signal to perform cleanup (e.g., compensation logic,
     * resource cleanup, notifications) before transitioning to the CANCELLED phase.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow cancel --workflow-id &lt;id&gt;`
     * Behavior
     * 1. Validates execution exists and is in a cancellable phase
     * 2. Sends cancellation signal to Temporal workflow
     * 3. Workflow code receives the signal and can perform cleanup
     * 4. Execution transitions to EXECUTION_CANCELLED phase
     * 5. Returns updated WorkflowExecution with new phase
     * Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot cancel already-terminal executions (COMPLETED, FAILED, CANCELLED, TERMINATED)
     * State Transitions
     * - status.phase: PENDING/IN_PROGRESS → CANCELLED
     * - status.completed_at: Set to current timestamp
     * - In-progress tasks: May complete cleanup or be interrupted
     * Idempotency
     * Cancelling an already-cancelled execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * This ensures safe retry of cancel requests.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase (COMPLETED, FAILED, TERMINATED)
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456",
     *   "reason": "Customer requested cancellation - order no longer needed"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 5,  // EXECUTION_CANCELLED
     *     "completed_at": "2026-02-07T18:30:00Z"
     *   }
     * }
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution cancel(ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getCancelMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Terminate a workflow execution immediately.
     * Force-stops the workflow without allowing cleanup. Unlike cancel,
     * the workflow code cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive workflows that don't respond to cancellation.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow terminate --workflow-id &lt;id&gt;`
     * Behavior
     * 1. Validates execution exists and is in a terminable phase
     * 2. Force-kills workflow via Temporal (no signal sent to workflow)
     * 3. Execution transitions to EXECUTION_TERMINATED phase immediately
     * 4. No cleanup callbacks or defer blocks are executed
     * 5. Returns updated WorkflowExecution with TERMINATED phase
     * Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot terminate already-terminal executions
     * State Transitions
     * - status.phase: PENDING/IN_PROGRESS → TERMINATED
     * - status.completed_at: Set to current timestamp
     * - status.error: May contain termination reason
     * - In-progress tasks: Stopped abruptly (no cleanup)
     * Terminated vs Cancelled
     * | Aspect | cancel | terminate |
     * |--------|--------|-----------|
     * | Signal to workflow | Yes (can handle) | No |
     * | Cleanup opportunity | Yes | No |
     * | Use case | Normal stop | Stuck workflows |
     * | Can recover? | No | No |
     * Idempotency
     * Terminating an already-terminated execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456",
     *   "reason": "Workflow stuck for 2 hours, not responding to cancel"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 6,  // EXECUTION_TERMINATED
     *     "completed_at": "2026-02-07T18:35:00Z",
     *     "error": "Terminated by operator: Workflow stuck for 2 hours"
     *   }
     * }
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution terminate(ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getTerminateMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Recover a failed workflow execution from the last checkpoint.
     * Resumes execution from the last successful point. Completed work is
     * preserved - successful tasks are NOT re-executed. This enables
     * "retry and resume" semantics without duplicating side effects.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow reset --workflow-id &lt;id&gt; --type LastWorkflowTask`
     * Behavior
     * 1. Validates execution is in FAILED phase (recoverable)
     * 2. Identifies the last successful checkpoint in workflow history
     * 3. Creates new Temporal run from that checkpoint via ResetWorkflow
     * 4. Execution transitions from FAILED to IN_PROGRESS phase
     * 5. Workflow continues from where it failed
     * 6. Returns updated WorkflowExecution with IN_PROGRESS phase
     * Preconditions
     * - Execution must be in EXECUTION_FAILED phase
     * - TERMINATED executions cannot be recovered (intentional hard stop)
     * - CANCELLED executions cannot be recovered (intentional user action)
     * - COMPLETED executions don't need recovery
     * State Transitions
     * - status.phase: FAILED → IN_PROGRESS
     * - status.completed_at: Cleared (execution is running again)
     * - status.error: Cleared (no longer failed)
     * - Completed tasks: Preserved (not re-executed)
     * - Failed tasks: Reset to pending, will be retried
     * Recovery vs Restart
     * | Aspect | recover | Create new execution |
     * |--------|---------|----------------------|
     * | Completed work | Preserved | Lost (re-executed) |
     * | Side effects | Not duplicated | May duplicate |
     * | Execution ID | Same | New ID |
     * | Use case | Resume after fix | Start fresh |
     * Idempotency
     * If recovery already succeeded (execution is now IN_PROGRESS from a
     * previous recover call), the call succeeds as a no-op and returns
     * the current execution state.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION:
     *   - Execution is not in FAILED phase
     *   - Execution is TERMINATED (cannot recover)
     *   - Execution is CANCELLED (cannot recover)
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456",
     *   "reason": "Stripe API recovered, resuming payment processing"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 2,  // EXECUTION_IN_PROGRESS
     *     "started_at": "2026-02-07T10:00:00Z",
     *     "tasks": [
     *       { "task_id": "task-1", "status": 3 },  // COMPLETED (preserved)
     *       { "task_id": "task-2", "status": 2 }   // IN_PROGRESS (resumed)
     *     ]
     *   }
     * }
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution recover(ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getRecoverMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Pause a running workflow execution.
     * Temporarily stops the workflow at its current checkpoint. Unlike cancel,
     * the execution is NOT terminal and can be resumed later from where it left off.
     * The workflow gracefully checkpoints and exits, preserving all progress.
     * &#64;internal
     * Behavior
     * 1. Validates execution exists and is in a pausable phase
     * 2. Sends "pause" signal to Temporal workflow
     * 3. Workflow receives signal and sets pauseRequested flag
     * 4. Running activities are gracefully cancelled (checkpoints saved)
     * 5. Execution transitions to EXECUTION_PAUSED phase
     * 6. Workflow waits for resume signal (no resources consumed)
     * 7. Returns updated WorkflowExecution with PAUSED phase
     * Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot pause already-terminal executions (COMPLETED, FAILED, CANCELLED, TERMINATED)
     * State Transitions
     * - status.phase: PENDING/IN_PROGRESS → PAUSED
     * - status.completed_at: NOT set (execution is not finished)
     * - Running activities: Gracefully cancelled, checkpoint saved
     * - LangGraph state: Preserved via thread_id checkpoint
     * Paused vs Cancelled
     * | Aspect | pause | cancel |
     * |--------|-------|--------|
     * | Terminal state? | No | Yes |
     * | Can resume? | Yes (via resume RPC) | No |
     * | Checkpoint saved? | Yes | Best-effort |
     * | Progress preserved? | Yes | No |
     * | Use case | Temporary stop, maintenance | Permanent stop |
     * Agent Activity Behavior
     * When pause is signaled to a workflow running an agent:
     * 1. Workflow cancels the running activity gracefully
     * 2. Python activity catches CancelledError
     * 3. LangGraph saves final checkpoint automatically
     * 4. Activity returns with paused status
     * 5. On resume, activity loads from checkpoint and continues
     * Idempotency
     * Pausing an already-paused execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456",
     *   "reason": "Pausing for scheduled maintenance window"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 7,  // EXECUTION_PAUSED
     *     "started_at": "2026-02-07T10:00:00Z"
     *     // Note: completed_at is NOT set (execution can be resumed)
     *   }
     * }
     * &#64;since Gap A3 (Pause/Resume Propagation)
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution pause(ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getPauseMethod(), getCallOptions(), request);
    }

    /**
     * <pre>
     * Resume a paused workflow execution.
     * Continues execution from the checkpoint where it was paused. The workflow
     * re-invokes activities with the same thread_id, which loads from checkpoint
     * and continues from where it left off.
     * &#64;internal
     * Behavior
     * 1. Validates execution is in EXECUTION_PAUSED phase
     * 2. Sends "resume" signal to Temporal workflow
     * 3. Workflow receives signal and sets resumeSignalReceived flag
     * 4. Workflow re-invokes activity with same execution context
     * 5. Activity detects resume and loads from LangGraph checkpoint
     * 6. Execution transitions back to EXECUTION_IN_PROGRESS phase
     * 7. Returns updated WorkflowExecution with IN_PROGRESS phase
     * Preconditions
     * - Execution must be in EXECUTION_PAUSED phase
     * - Cannot resume non-paused executions
     * State Transitions
     * - status.phase: PAUSED → IN_PROGRESS
     * - Activities: Re-invoked, load from checkpoint
     * - LangGraph state: Loaded from checkpoint via thread_id
     * Resume Behavior
     * When resume is signaled to a paused workflow:
     * 1. Java workflow unblocks from Workflow.await()
     * 2. Workflow re-invokes the activity with same parameters
     * 3. Python activity reads thread_id from heartbeat_details
     * 4. LangGraph loads checkpoint using thread_id
     * 5. Agent continues from exact position where it was paused
     * Idempotency
     * Resuming an already-running execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is not in PAUSED phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 2,  // EXECUTION_IN_PROGRESS
     *     "started_at": "2026-02-07T10:00:00Z"
     *   }
     * }
     * &#64;since Gap A3 (Pause/Resume Propagation)
     * </pre>
     */
    public ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution resume(ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput request) {
      return io.grpc.stub.ClientCalls.blockingUnaryCall(
          getChannel(), getResumeMethod(), getCallOptions(), request);
    }
  }

  /**
   * A stub to allow clients to do ListenableFuture-style rpc calls to service WorkflowExecutionCommandController.
   * <pre>
   * WorkflowExecutionCommandController handles write operations (Create, Update, Delete) for WorkflowExecution resources.
   * This service follows the Command-Query Separation (CQS) pattern:
   * - CommandController: Write operations (create, update, delete)
   * - QueryController: Read operations (get, list, search)
   * Authorization:
   * All RPCs use custom authorization logic implemented in middleware.
   * Custom authorization is needed because:
   * - create: Must verify user has "execute" permission on the referenced WorkflowInstance
   * - update: Only the workflow runner (system) can update execution status, not users
   * Service Options:
   * - api_resource_kind: workflow_execution - Links this service to the WorkflowExecution resource
   * </pre>
   */
  public static final class WorkflowExecutionCommandControllerFutureStub
      extends io.grpc.stub.AbstractFutureStub<WorkflowExecutionCommandControllerFutureStub> {
    private WorkflowExecutionCommandControllerFutureStub(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      super(channel, callOptions);
    }

    @java.lang.Override
    protected WorkflowExecutionCommandControllerFutureStub build(
        io.grpc.Channel channel, io.grpc.CallOptions callOptions) {
      return new WorkflowExecutionCommandControllerFutureStub(channel, callOptions);
    }

    /**
     * <pre>
     * Create and trigger a new workflow execution.
     * This RPC creates a WorkflowExecution resource and immediately triggers it for execution.
     * The workflow execution engine picks up the execution and begins processing tasks.
     * &#64;internal
     * Input Validation:
     * - metadata.org must be specified
     * - spec.workflow_instance_id is required and must reference an existing WorkflowInstance
     * - api_version must be exactly "agentic.stigmer.ai/v1"
     * - kind must be exactly "WorkflowExecution"
     * Authorization:
     * Custom authorization verifies:
     * 1. User has "execute" permission on the referenced WorkflowInstance
     * 2. User has access to all referenced Environments (from WorkflowInstance)
     * 3. User has access to all referenced Secrets (from runtime_env secret_refs)
     * Execution Flow:
     * 1. Validate input (proto validation + business rules)
     * 2. Check authorization (user can execute WorkflowInstance)
     * 3. Create WorkflowExecution resource in database
     * 4. Set initial status.phase = EXECUTION_PENDING
     * 5. Trigger workflow in execution engine (Temporal)
     * 6. Return WorkflowExecution with status.phase = EXECUTION_PENDING or EXECUTION_IN_PROGRESS
     * Status After Create:
     * - status.phase: EXECUTION_PENDING (or EXECUTION_IN_PROGRESS if already picked up)
     * - status.audit.created_at: Current timestamp
     * - status.audit.created_by: Authenticated user ID
     * - status.started_at: Not set yet (set when phase transitions to IN_PROGRESS)
     * Use Cases:
     * 1. API-Triggered Execution:
     * - User calls API to execute a workflow
     * - Input: WorkflowExecution with spec.workflow_instance_id and spec.trigger_message
     * - Output: WorkflowExecution with generated ID and PENDING status
     * 2. Webhook-Triggered Execution:
     * - External system (Stripe, GitHub, etc.) sends webhook
     * - Webhook handler creates WorkflowExecution with webhook payload in spec.trigger_message
     * - spec.trigger_metadata captures webhook source, event type, timestamp
     * 3. Scheduled Execution:
     * - Scheduler service creates WorkflowExecution at scheduled time
     * - spec.trigger_metadata includes schedule ID and cron expression
     * 4. UI-Triggered Execution:
     * - User clicks "Execute" button in web console
     * - UI creates WorkflowExecution with user-provided inputs
     * 5. Workflow Chaining (Workflow A triggers Workflow B):
     * - Workflow A completes, creates WorkflowExecution for Workflow B
     * - spec.trigger_message contains output from Workflow A
     * - spec.trigger_metadata includes parent workflow execution ID
     * Error Cases:
     * - INVALID_ARGUMENT:
     *   - workflow_instance_id is missing or invalid
     *   - org is missing
     *   - api_version or kind is incorrect
     * - PERMISSION_DENIED:
     *   - User doesn't have "execute" permission on WorkflowInstance
     *   - User doesn't have access to referenced Environments
     *   - User doesn't have access to referenced Secrets
     * - NOT_FOUND:
     *   - Referenced WorkflowInstance doesn't exist
     *   - Referenced Environment doesn't exist
     *   - Referenced Secret doesn't exist
     * - FAILED_PRECONDITION:
     *   - WorkflowInstance is in invalid state (e.g., archived, disabled)
     *   - Too many concurrent executions (quota exceeded)
     * Example Request:
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": {
     *     "name": "customer-onboarding-20250111-143022",
     *     "org": "acme"
     *   },
     *   "spec": {
     *     "workflow_instance_id": "wfi_customer-onboarding-prod",
     *     "trigger_message": "New signup: john.doe&#64;example.com",
     *     "trigger_metadata": {
     *       "source": "api",
     *       "caller_id": "usr-jane-admin",
     *       "timestamp": "2025-01-11T14:30:22Z"
     *     },
     *     "runtime_env": {
     *       "CUSTOMER_EMAIL": { "value": "john.doe&#64;example.com" }
     *     }
     *   }
     * }
     * Example Response:
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": {
     *     "id": "wfx_abc123xyz456",  // Auto-generated
     *     "name": "customer-onboarding-20250111-143022",
     *     "org": "acme"
     *   },
     *   "spec": { ... },  // Same as request
     *   "status": {
     *     "phase": 1,  // EXECUTION_PENDING
     *     "audit": {
     *       "created_at": "2025-01-11T14:30:22Z",
     *       "created_by": "usr-jane-admin"
     *     }
     *   }
     * }
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> create(
        ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCreateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update an existing workflow execution with full state.
     * &#64;internal
     * Used by users to update execution configuration (spec fields).
     * No individual field updates - always provide complete state.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> update(
        ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Update execution status during workflow execution.
     * &#64;internal
     * System-level RPC used by workflow-runner to send progressive status updates
     * (messages, task states, phase, etc.). Optimized for frequent status updates
     * and merges status fields with existing state.
     * This RPC is used by the workflow execution engine (Temporal) to update the status
     * of a running workflow execution. Users cannot call this RPC directly.
     * What Can Be Updated:
     * - status.phase (PENDING → IN_PROGRESS → COMPLETED/FAILED/CANCELLED)
     * - status.tasks (update task statuses, outputs, errors)
     * - status.output (set final workflow output when COMPLETED)
     * - status.error (set error message when FAILED)
     * - status.started_at (set when execution starts)
     * - status.completed_at (set when execution finishes)
     * What Cannot Be Updated:
     * - spec.* (user inputs are immutable after creation)
     * - metadata.id (resource ID is immutable)
     * - status.audit.created_at (creation timestamp is immutable)
     * Authorization:
     * Custom authorization verifies:
     * 1. Caller is the workflow runner service (system identity, not a user)
     * 2. Only status fields are being modified (spec and metadata unchanged)
     * Update Flow:
     * 1. Workflow runner executes a task
     * 2. Task completes/fails
     * 3. Workflow runner calls updateStatus() with:
     *    - Updated status.tasks (new task status, output/error)
     *    - Updated status.phase (if all tasks done)
     * 4. Backend validates and persists update
     * 5. Backend broadcasts update via WebSocket (for real-time UI updates)
     * Use Cases:
     * 1. Task Started:
     * - Workflow runner updates status.tasks[i].status = IN_PROGRESS
     * 2. Task Completed:
     * - Workflow runner updates status.tasks[i].status = COMPLETED
     * - Workflow runner sets status.tasks[i].output
     * 3. Task Failed:
     * - Workflow runner updates status.tasks[i].status = FAILED
     * - Workflow runner sets status.tasks[i].error
     * - Workflow runner updates status.phase = EXECUTION_FAILED
     * - Workflow runner sets status.error
     * - Workflow runner sets status.completed_at
     * 4. Workflow Completed:
     * - Workflow runner updates status.phase = EXECUTION_COMPLETED
     * - Workflow runner sets status.output
     * - Workflow runner sets status.completed_at
     * 5. Workflow Cancelled:
     * - Workflow runner receives cancellation signal
     * - Workflow runner updates status.phase = EXECUTION_CANCELLED
     * - Workflow runner sets status.completed_at
     * Error Cases:
     * - PERMISSION_DENIED:
     *   - Caller lacks can_edit permission on the workflow execution
     * - INVALID_ARGUMENT:
     *   - Trying to modify spec or metadata (only status can be updated)
     *   - Invalid phase transition (e.g., COMPLETED → IN_PROGRESS)
     * - NOT_FOUND:
     *   - WorkflowExecution with given ID doesn't exist
     * Example Request (Task Completed):
     * {
     *   "metadata": {
     *     "id": "wfx_abc123xyz456"
     *   },
     *   "status": {
     *     "phase": 2,  // EXECUTION_IN_PROGRESS
     *     "completed_tasks": 1,
     *     "tasks": [
     *       {
     *         "task_id": "task-1",
     *         "task_name": "validate_email",
     *         "status": 3,  // WORKFLOW_TASK_COMPLETED
     *         "output": { "valid": true },
     *         "completed_at": "2025-01-11T14:30:27Z"
     *       },
     *       {
     *         "task_id": "task-2",
     *         "task_name": "create_account",
     *         "status": 2,  // WORKFLOW_TASK_IN_PROGRESS
     *         "timestamp": "2025-01-11T14:30:27Z"
     *       }
     *     ]
     *   }
     * }
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> updateStatus(
        ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getUpdateStatusMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Submit an approval decision for a child agent's tool execution.
     * This RPC forwards the approval decision to the child AgentExecution that
     * is waiting for approval. The child is identified by the child_agent_execution_id
     * in status.pending_approval.
     * When a workflow invokes an agent that requires tool approval, the approval
     * request surfaces at the workflow level via status.pending_approval. Users can
     * submit their decision through this RPC, which forwards it to the child agent.
     * &#64;internal
     * The approval is forwarded to the child via AgentExecution.submitApproval RPC,
     * ensuring consistent validation and Temporal workflow signaling.
     * Preconditions:
     * - status.pending_approval must be populated
     * - tool_call_id must match status.pending_approval.tool_call_id
     * - status.pending_approval.child_agent_execution_id must not be empty
     * - User must have can_edit permission on the workflow execution
     * State Transitions
     * After successful approval:
     * - Approval is forwarded to child AgentExecution
     * - Child agent resumes execution based on action (APPROVE/SKIP/REJECT)
     * - Child agent clears its pending_approval, which triggers signal to parent
     * - WorkflowExecution.status.pending_approval is eventually cleared
     * - Workflow task status returns from WAITING_APPROVAL to IN_PROGRESS
     * Approval Actions
     * - APPROVE: Tool executes with the provided arguments
     * - SKIP: Tool execution is skipped, agent continues with skip message
     * - REJECT: Agent execution fails with rejection error
     * Error Cases
     * - NOT_FOUND: Workflow execution doesn't exist
     * - PERMISSION_DENIED: User doesn't have can_edit permission
     * - FAILED_PRECONDITION: No pending approval, or child agent not waiting
     * - INVALID_ARGUMENT: Tool call ID mismatch, or action is UNSPECIFIED
     * - UNAVAILABLE: Failed to forward to child agent (transient error)
     * Idempotency
     * If the same approval is submitted twice (same workflow execution, tool_call_id,
     * and action), the second call is a no-op if the approval was already processed.
     * Alternative: Direct Agent Approval
     * Users can also submit approvals directly via AgentExecution.submitApproval
     * using the child_agent_execution_id. Both paths are equivalent and result
     * in the same state transitions.
     * &#64;since Phase 5.3 (Approval Forwarding)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> submitApproval(
        ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSubmitApprovalMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Delete a workflow execution.
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> delete(
        ai.stigmer.commons.apiresource.ApiResourceId request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getDeleteMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Send a signal to a running workflow execution.
     * Delivers a signal to a workflow execution, typically to unblock a LISTEN task.
     * Delivery is race-proof: the signal is guaranteed to arrive even if sent
     * before the workflow is fully started.
     * &#64;internal
     * Uses Temporal's SignalWithStart API internally for race-proof delivery.
     * Behavior
     * 1. Validates execution exists and is in a signalable phase
     * 2. Uses Temporal SignalWithStart for atomic delivery:
     *    - If workflow exists → sends signal immediately
     *    - If workflow not started yet → starts workflow, then sends signal
     * 3. Signal is delivered to workflow's signal channel
     * 4. LISTEN task waiting for this signal will unblock and continue
     * 5. Returns the current WorkflowExecution state
     * Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot signal terminal executions (COMPLETED, FAILED, CANCELLED, TERMINATED)
     * - User must have can_edit permission on the workflow execution
     * Race-Proof Delivery (SignalWithStart)
     * This RPC uses Temporal's SignalWithStart API to handle the race condition
     * where a signal might arrive before the workflow is fully started:
     * - Traditional SignalWorkflow fails with "WorkflowNotFound" if called too early
     * - SignalWithStart atomically: starts workflow if needed, then sends signal
     * - Guarantees signal delivery even in race conditions
     * Signal Matching
     * The signal_name must match the signal ID defined in the workflow's LISTEN task:
     * Workflow YAML:
     *   - waitForPayment:
     *       listen:
     *         to:
     *           one:
     *             with:
     *               id: payment_confirmed  # &lt;-- signal_name must match this
     *               type: signal
     * API Call:
     *   { "signal_name": "payment_confirmed", "payload": {...} }
     * Error Cases
     * - NOT_FOUND: Workflow execution doesn't exist
     * - PERMISSION_DENIED: User doesn't have can_edit permission
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: execution_id or signal_name is empty
     * Example Request
     * {
     *   "execution_id": "wfx_abc123xyz456",
     *   "signal_name": "payment_confirmed",
     *   "payload": {
     *     "transaction_id": "txn_123",
     *     "amount": 99.99,
     *     "currency": "USD"
     *   }
     * }
     * Example Response
     * Returns the current WorkflowExecution state (phase may still be IN_PROGRESS
     * as the workflow continues after receiving the signal).
     * &#64;since Gap B1 (Signal-With-Start for race-proof event delivery)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> sendSignal(
        ai.stigmer.agentic.workflowexecution.v1.SendSignalInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getSendSignalMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Cancel a running workflow execution gracefully.
     * Sends a cancellation signal to the workflow. The workflow code can handle
     * the cancellation signal to perform cleanup (e.g., compensation logic,
     * resource cleanup, notifications) before transitioning to the CANCELLED phase.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow cancel --workflow-id &lt;id&gt;`
     * Behavior
     * 1. Validates execution exists and is in a cancellable phase
     * 2. Sends cancellation signal to Temporal workflow
     * 3. Workflow code receives the signal and can perform cleanup
     * 4. Execution transitions to EXECUTION_CANCELLED phase
     * 5. Returns updated WorkflowExecution with new phase
     * Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot cancel already-terminal executions (COMPLETED, FAILED, CANCELLED, TERMINATED)
     * State Transitions
     * - status.phase: PENDING/IN_PROGRESS → CANCELLED
     * - status.completed_at: Set to current timestamp
     * - In-progress tasks: May complete cleanup or be interrupted
     * Idempotency
     * Cancelling an already-cancelled execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * This ensures safe retry of cancel requests.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase (COMPLETED, FAILED, TERMINATED)
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456",
     *   "reason": "Customer requested cancellation - order no longer needed"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 5,  // EXECUTION_CANCELLED
     *     "completed_at": "2026-02-07T18:30:00Z"
     *   }
     * }
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> cancel(
        ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getCancelMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Terminate a workflow execution immediately.
     * Force-stops the workflow without allowing cleanup. Unlike cancel,
     * the workflow code cannot respond to termination - it is stopped immediately.
     * Use this for stuck or unresponsive workflows that don't respond to cancellation.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow terminate --workflow-id &lt;id&gt;`
     * Behavior
     * 1. Validates execution exists and is in a terminable phase
     * 2. Force-kills workflow via Temporal (no signal sent to workflow)
     * 3. Execution transitions to EXECUTION_TERMINATED phase immediately
     * 4. No cleanup callbacks or defer blocks are executed
     * 5. Returns updated WorkflowExecution with TERMINATED phase
     * Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot terminate already-terminal executions
     * State Transitions
     * - status.phase: PENDING/IN_PROGRESS → TERMINATED
     * - status.completed_at: Set to current timestamp
     * - status.error: May contain termination reason
     * - In-progress tasks: Stopped abruptly (no cleanup)
     * Terminated vs Cancelled
     * | Aspect | cancel | terminate |
     * |--------|--------|-----------|
     * | Signal to workflow | Yes (can handle) | No |
     * | Cleanup opportunity | Yes | No |
     * | Use case | Normal stop | Stuck workflows |
     * | Can recover? | No | No |
     * Idempotency
     * Terminating an already-terminated execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456",
     *   "reason": "Workflow stuck for 2 hours, not responding to cancel"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 6,  // EXECUTION_TERMINATED
     *     "completed_at": "2026-02-07T18:35:00Z",
     *     "error": "Terminated by operator: Workflow stuck for 2 hours"
     *   }
     * }
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> terminate(
        ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getTerminateMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Recover a failed workflow execution from the last checkpoint.
     * Resumes execution from the last successful point. Completed work is
     * preserved - successful tasks are NOT re-executed. This enables
     * "retry and resume" semantics without duplicating side effects.
     * &#64;internal
     * Temporal Equivalent: `temporal workflow reset --workflow-id &lt;id&gt; --type LastWorkflowTask`
     * Behavior
     * 1. Validates execution is in FAILED phase (recoverable)
     * 2. Identifies the last successful checkpoint in workflow history
     * 3. Creates new Temporal run from that checkpoint via ResetWorkflow
     * 4. Execution transitions from FAILED to IN_PROGRESS phase
     * 5. Workflow continues from where it failed
     * 6. Returns updated WorkflowExecution with IN_PROGRESS phase
     * Preconditions
     * - Execution must be in EXECUTION_FAILED phase
     * - TERMINATED executions cannot be recovered (intentional hard stop)
     * - CANCELLED executions cannot be recovered (intentional user action)
     * - COMPLETED executions don't need recovery
     * State Transitions
     * - status.phase: FAILED → IN_PROGRESS
     * - status.completed_at: Cleared (execution is running again)
     * - status.error: Cleared (no longer failed)
     * - Completed tasks: Preserved (not re-executed)
     * - Failed tasks: Reset to pending, will be retried
     * Recovery vs Restart
     * | Aspect | recover | Create new execution |
     * |--------|---------|----------------------|
     * | Completed work | Preserved | Lost (re-executed) |
     * | Side effects | Not duplicated | May duplicate |
     * | Execution ID | Same | New ID |
     * | Use case | Resume after fix | Start fresh |
     * Idempotency
     * If recovery already succeeded (execution is now IN_PROGRESS from a
     * previous recover call), the call succeeds as a no-op and returns
     * the current execution state.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION:
     *   - Execution is not in FAILED phase
     *   - Execution is TERMINATED (cannot recover)
     *   - Execution is CANCELLED (cannot recover)
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456",
     *   "reason": "Stripe API recovered, resuming payment processing"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 2,  // EXECUTION_IN_PROGRESS
     *     "started_at": "2026-02-07T10:00:00Z",
     *     "tasks": [
     *       { "task_id": "task-1", "status": 3 },  // COMPLETED (preserved)
     *       { "task_id": "task-2", "status": 2 }   // IN_PROGRESS (resumed)
     *     ]
     *   }
     * }
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> recover(
        ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getRecoverMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Pause a running workflow execution.
     * Temporarily stops the workflow at its current checkpoint. Unlike cancel,
     * the execution is NOT terminal and can be resumed later from where it left off.
     * The workflow gracefully checkpoints and exits, preserving all progress.
     * &#64;internal
     * Behavior
     * 1. Validates execution exists and is in a pausable phase
     * 2. Sends "pause" signal to Temporal workflow
     * 3. Workflow receives signal and sets pauseRequested flag
     * 4. Running activities are gracefully cancelled (checkpoints saved)
     * 5. Execution transitions to EXECUTION_PAUSED phase
     * 6. Workflow waits for resume signal (no resources consumed)
     * 7. Returns updated WorkflowExecution with PAUSED phase
     * Preconditions
     * - Execution must be in EXECUTION_PENDING or EXECUTION_IN_PROGRESS phase
     * - Cannot pause already-terminal executions (COMPLETED, FAILED, CANCELLED, TERMINATED)
     * State Transitions
     * - status.phase: PENDING/IN_PROGRESS → PAUSED
     * - status.completed_at: NOT set (execution is not finished)
     * - Running activities: Gracefully cancelled, checkpoint saved
     * - LangGraph state: Preserved via thread_id checkpoint
     * Paused vs Cancelled
     * | Aspect | pause | cancel |
     * |--------|-------|--------|
     * | Terminal state? | No | Yes |
     * | Can resume? | Yes (via resume RPC) | No |
     * | Checkpoint saved? | Yes | Best-effort |
     * | Progress preserved? | Yes | No |
     * | Use case | Temporary stop, maintenance | Permanent stop |
     * Agent Activity Behavior
     * When pause is signaled to a workflow running an agent:
     * 1. Workflow cancels the running activity gracefully
     * 2. Python activity catches CancelledError
     * 3. LangGraph saves final checkpoint automatically
     * 4. Activity returns with paused status
     * 5. On resume, activity loads from checkpoint and continues
     * Idempotency
     * Pausing an already-paused execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is in a terminal phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456",
     *   "reason": "Pausing for scheduled maintenance window"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 7,  // EXECUTION_PAUSED
     *     "started_at": "2026-02-07T10:00:00Z"
     *     // Note: completed_at is NOT set (execution can be resumed)
     *   }
     * }
     * &#64;since Gap A3 (Pause/Resume Propagation)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> pause(
        ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getPauseMethod(), getCallOptions()), request);
    }

    /**
     * <pre>
     * Resume a paused workflow execution.
     * Continues execution from the checkpoint where it was paused. The workflow
     * re-invokes activities with the same thread_id, which loads from checkpoint
     * and continues from where it left off.
     * &#64;internal
     * Behavior
     * 1. Validates execution is in EXECUTION_PAUSED phase
     * 2. Sends "resume" signal to Temporal workflow
     * 3. Workflow receives signal and sets resumeSignalReceived flag
     * 4. Workflow re-invokes activity with same execution context
     * 5. Activity detects resume and loads from LangGraph checkpoint
     * 6. Execution transitions back to EXECUTION_IN_PROGRESS phase
     * 7. Returns updated WorkflowExecution with IN_PROGRESS phase
     * Preconditions
     * - Execution must be in EXECUTION_PAUSED phase
     * - Cannot resume non-paused executions
     * State Transitions
     * - status.phase: PAUSED → IN_PROGRESS
     * - Activities: Re-invoked, load from checkpoint
     * - LangGraph state: Loaded from checkpoint via thread_id
     * Resume Behavior
     * When resume is signaled to a paused workflow:
     * 1. Java workflow unblocks from Workflow.await()
     * 2. Workflow re-invokes the activity with same parameters
     * 3. Python activity reads thread_id from heartbeat_details
     * 4. LangGraph loads checkpoint using thread_id
     * 5. Agent continues from exact position where it was paused
     * Idempotency
     * Resuming an already-running execution succeeds as a no-op.
     * The call returns the current execution state without side effects.
     * Error Cases
     * - NOT_FOUND: Execution with given ID doesn't exist
     * - PERMISSION_DENIED: User lacks can_edit permission on the execution
     * - FAILED_PRECONDITION: Execution is not in PAUSED phase
     * - INVALID_ARGUMENT: ID is empty or malformed
     * Example Request
     * {
     *   "id": "wfx_abc123xyz456"
     * }
     * Example Response
     * {
     *   "api_version": "agentic.stigmer.ai/v1",
     *   "kind": "WorkflowExecution",
     *   "metadata": { "id": "wfx_abc123xyz456" },
     *   "status": {
     *     "phase": 2,  // EXECUTION_IN_PROGRESS
     *     "started_at": "2026-02-07T10:00:00Z"
     *   }
     * }
     * &#64;since Gap A3 (Pause/Resume Propagation)
     * </pre>
     */
    public com.google.common.util.concurrent.ListenableFuture<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution> resume(
        ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput request) {
      return io.grpc.stub.ClientCalls.futureUnaryCall(
          getChannel().newCall(getResumeMethod(), getCallOptions()), request);
    }
  }

  private static final int METHODID_CREATE = 0;
  private static final int METHODID_UPDATE = 1;
  private static final int METHODID_UPDATE_STATUS = 2;
  private static final int METHODID_SUBMIT_APPROVAL = 3;
  private static final int METHODID_DELETE = 4;
  private static final int METHODID_SEND_SIGNAL = 5;
  private static final int METHODID_CANCEL = 6;
  private static final int METHODID_TERMINATE = 7;
  private static final int METHODID_RECOVER = 8;
  private static final int METHODID_PAUSE = 9;
  private static final int METHODID_RESUME = 10;

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
          serviceImpl.create((ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_UPDATE:
          serviceImpl.update((ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_UPDATE_STATUS:
          serviceImpl.updateStatus((ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_SUBMIT_APPROVAL:
          serviceImpl.submitApproval((ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_DELETE:
          serviceImpl.delete((ai.stigmer.commons.apiresource.ApiResourceId) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_SEND_SIGNAL:
          serviceImpl.sendSignal((ai.stigmer.agentic.workflowexecution.v1.SendSignalInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_CANCEL:
          serviceImpl.cancel((ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_TERMINATE:
          serviceImpl.terminate((ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_RECOVER:
          serviceImpl.recover((ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_PAUSE:
          serviceImpl.pause((ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
          break;
        case METHODID_RESUME:
          serviceImpl.resume((ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput) request,
              (io.grpc.stub.StreamObserver<ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>) responseObserver);
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
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_CREATE)))
        .addMethod(
          getUpdateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_UPDATE)))
        .addMethod(
          getUpdateStatusMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecutionUpdateStatusInput,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_UPDATE_STATUS)))
        .addMethod(
          getSubmitApprovalMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.SubmitWorkflowApprovalInput,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_SUBMIT_APPROVAL)))
        .addMethod(
          getDeleteMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.commons.apiresource.ApiResourceId,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_DELETE)))
        .addMethod(
          getSendSignalMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.SendSignalInput,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_SEND_SIGNAL)))
        .addMethod(
          getCancelMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.CancelWorkflowExecutionInput,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_CANCEL)))
        .addMethod(
          getTerminateMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.TerminateWorkflowExecutionInput,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_TERMINATE)))
        .addMethod(
          getRecoverMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.RecoverWorkflowExecutionInput,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_RECOVER)))
        .addMethod(
          getPauseMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.PauseWorkflowExecutionInput,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_PAUSE)))
        .addMethod(
          getResumeMethod(),
          io.grpc.stub.ServerCalls.asyncUnaryCall(
            new MethodHandlers<
              ai.stigmer.agentic.workflowexecution.v1.ResumeWorkflowExecutionInput,
              ai.stigmer.agentic.workflowexecution.v1.WorkflowExecution>(
                service, METHODID_RESUME)))
        .build();
  }

  private static abstract class WorkflowExecutionCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoFileDescriptorSupplier, io.grpc.protobuf.ProtoServiceDescriptorSupplier {
    WorkflowExecutionCommandControllerBaseDescriptorSupplier() {}

    @java.lang.Override
    public com.google.protobuf.Descriptors.FileDescriptor getFileDescriptor() {
      return ai.stigmer.agentic.workflowexecution.v1.CommandProto.getDescriptor();
    }

    @java.lang.Override
    public com.google.protobuf.Descriptors.ServiceDescriptor getServiceDescriptor() {
      return getFileDescriptor().findServiceByName("WorkflowExecutionCommandController");
    }
  }

  private static final class WorkflowExecutionCommandControllerFileDescriptorSupplier
      extends WorkflowExecutionCommandControllerBaseDescriptorSupplier {
    WorkflowExecutionCommandControllerFileDescriptorSupplier() {}
  }

  private static final class WorkflowExecutionCommandControllerMethodDescriptorSupplier
      extends WorkflowExecutionCommandControllerBaseDescriptorSupplier
      implements io.grpc.protobuf.ProtoMethodDescriptorSupplier {
    private final java.lang.String methodName;

    WorkflowExecutionCommandControllerMethodDescriptorSupplier(java.lang.String methodName) {
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
      synchronized (WorkflowExecutionCommandControllerGrpc.class) {
        result = serviceDescriptor;
        if (result == null) {
          serviceDescriptor = result = io.grpc.ServiceDescriptor.newBuilder(SERVICE_NAME)
              .setSchemaDescriptor(new WorkflowExecutionCommandControllerFileDescriptorSupplier())
              .addMethod(getCreateMethod())
              .addMethod(getUpdateMethod())
              .addMethod(getUpdateStatusMethod())
              .addMethod(getSubmitApprovalMethod())
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
