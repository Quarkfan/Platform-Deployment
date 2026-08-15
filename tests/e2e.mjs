import assert from "node:assert/strict";

const token = process.env.INTERNAL_SERVICE_TOKEN;
const headers = {
  authorization: `Bearer ${token}`,
  "content-type": "application/json",
};
const call = async (base, path, init = {}) => {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${path}: ${JSON.stringify(body)}`);
  return body.data;
};
const post = (base, path, body) =>
  call(base, path, { method: "POST", body: JSON.stringify(body) });
const waitFor = async (read, match, timeout = 30000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = await read();
    if (match(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Timed out waiting for state");
};

const mh = "http://model-hub:4103";
const mg = "http://message-gateway:4101";
const ch = "http://context-hub:4102";
const cr = "http://capability-registry:4104";
const runtime = "http://runtime-center:4105";
const scheduler = "http://scheduler-center:4106";
const browser = "http://browser-worker:4110";
const resource = "http://resource-center:4107";
const governance = "http://governance-center:4108";

const builtinCapabilities = await call(cr, "/v1/capabilities");
for (const id of [
  "builtin.browser.playwright-workflow",
  "builtin.browser.agent-task",
  "builtin.media.ffmpeg-job",
  "builtin.lark.sheets-read",
  "builtin.lark.sheets-batch-update",
  "builtin.lark.bitable-query",
  "builtin.lark.bitable-batch-update",
])
  assert.ok(
    builtinCapabilities.some((item) => item.id === id),
    `Missing built-in capability ${id}`,
  );

const provider = await post(mh, "/v1/providers", {
  name: `acceptance-${Date.now()}`,
  protocol: "openai",
  baseUrl: "http://mock-model:8090",
});
const model = await post(mh, "/v1/models", {
  providerId: provider.id,
  modelId: "acceptance-chat",
  name: "Acceptance Chat",
  kind: "chat",
});
const policy = await post(mh, "/v1/routing-policies", {
  name: `acceptance-${Date.now()}`,
  mode: "round-robin",
  deploymentIds: [model.id],
  failoverOnFailure: true,
});
const inference = await post(mh, "/v1/invoke", {
  policyId: policy.id,
  kind: "chat",
  messages: [{ role: "user", content: "model-route" }],
  correlationId: crypto.randomUUID(),
});
assert.equal(inference.output, "accepted: model-route");

await post(runtime, "/v1/bots", {
  id: "acceptance-bot",
  tenantId: "acceptance",
  name: "Acceptance Bot",
  enabled: true,
  runtime: "model-tool-loop",
  modelPolicyId: policy.id,
  maxConcurrentExecutions: 1,
  autonomousReplyBeta: true,
  historyBackfillBeta: true,
  maxBackfillMessages: 25,
});
await post(runtime, "/v1/bots", {
  id: "acceptance-openai-agents-bot",
  tenantId: "acceptance",
  name: "Acceptance OpenAI Agents Bot",
  enabled: true,
  runtime: "openai-agents",
  modelPolicyId: policy.id,
  maxConcurrentExecutions: 1,
  autonomousReplyBeta: false,
  historyBackfillBeta: false,
  maxBackfillMessages: 25,
});

const capabilitySuffix = Date.now();
const workflowId = `workflow.acceptance.${capabilitySuffix}`;
const commandId = `command.acceptance.${capabilitySuffix}`;
const deterministicPackage = {
  pkg: {
    name: `acceptance-deterministic-${capabilitySuffix}`,
    version: "1.0.0",
    source: { type: "directory", ref: "acceptance://deterministic" },
    contentHash: crypto.randomUUID(),
    metadata: { acceptance: true },
  },
  manifests: [
    {
      id: workflowId,
      name: "Acceptance Workflow",
      description: "Deterministic acceptance workflow",
      kind: "workflow",
      version: "1.0.0",
      inputSchema: { type: "object" },
      outputSchema: { type: "string" },
      runtime: { type: "workflow", requirements: [] },
      permissions: [],
      risk: "low",
      enabled: true,
      tags: ["acceptance"],
      raw: {
        workflow: {
          version: 1,
          steps: [
            {
              id: "reply",
              type: "template",
              template: "workflow accepted: {{input.arguments}}",
            },
          ],
          output: "{{steps.reply}}",
        },
      },
    },
    {
      id: commandId,
      name: "Acceptance Command",
      description: "Runs the acceptance workflow",
      kind: "command",
      version: "1.0.0",
      inputSchema: { type: "object" },
      outputSchema: { type: "string" },
      runtime: { type: "prompt", requirements: [] },
      permissions: [],
      risk: "low",
      enabled: true,
      tags: ["acceptance"],
      raw: {
        command: {
          command: `/accept-${capabilitySuffix}`,
          aliases: [],
          priority: 100,
          action: { type: "workflow", workflowId },
        },
      },
    },
  ],
};
const capabilityPreview = await post(
  cr,
  "/v1/import/preview",
  deterministicPackage,
);
assert.equal(capabilityPreview.valid, true, JSON.stringify(capabilityPreview));
assert.deepEqual(capabilityPreview.diff.added.sort(), [commandId, workflowId].sort());
await post(cr, "/v1/import", deterministicPackage);
await post(cr, "/v1/bindings", {
  capabilityId: workflowId,
  botId: "acceptance-bot",
  allowedTriggers: ["command", "scheduled", "manual"],
});
await post(cr, "/v1/bindings", {
  capabilityId: commandId,
  botId: "acceptance-bot",
  allowedTriggers: ["command"],
});
const commandExecution = await post(runtime, "/v1/executions", {
  tenantId: "acceptance",
  botId: "acceptance-bot",
  prompt: `/accept-${capabilitySuffix} hello`,
});
const commandFinished = await waitFor(
  () => call(runtime, `/v1/executions/${commandExecution.id}`),
  (value) => ["succeeded", "failed"].includes(value.status),
);
assert.equal(commandFinished.status, "succeeded", commandFinished.error);
assert.equal(commandFinished.response, "workflow accepted: hello");

const appArchive =
  "UEsDBBQAAAAIADgPEF2epCv09QAAAJMBAAAIAAAAYXBwLmpzb25lj81Ow0AMhF8l8jlUhWNuFcqZEyfUg7txki37x9rbEkV9d7y0VAiOns+eGa9gB+gAjaEkGAw9kJkjtBDQk4LdHTT9FQzEJtskNgbl/VPfTPFEOdDQmMISfYMp6Z5qfN153Gw3W1UoSF6gW0GWVL1DHEhlE73HUFvcBMwTQ/cGNgz0ufFHhv2l1Ukoj2j0UkuHVEQvjqwJLcQiv2ZdNpjwYJ0VS2q1Ak4a/ozO4cGpgeRC9+C/MpuZhuLoH5iRXy10IzomzUiUveX643dEIDnH/H7jLYzWES8s5OsvFXGq7fctZPooNhO/nAPlXUo5ntD9GF++AFBLAwQUAAAACAA4DxBdfx1OtqoAAADZAAAACQAAAGluZGV4Lm1qc03NywrCMBCF4VcJrhKUPEBLFypdeKGCFrcS4rQGSyZkpq0ivrvBC7j952NOByyomEzyBqMwo3EsLXpiYQU2IkS0QKSJz84rmhY2/1xDsT7sKh1MJJCk8j+IPesxOgb5JsTR+dY1d/nAa8axhxnYC2ZBOx8SHUyXUkJtCzHV9J/hxvpbZhdDNV7BZwvEDoyXvynwg15Vdbmv5tvTodwfV8vyVO82ZaWeSuUvUEsBAhQAFAAAAAgAOA8QXZ6kK/T1AAAAkwEAAAgAAAAAAAAAAAAAAAAAAAAAAGFwcC5qc29uUEsBAhQAFAAAAAgAOA8QXX8dTraqAAAA2QAAAAkAAAAAAAAAAAAAAAAAGwEAAGluZGV4Lm1qc1BLBQYAAAAAAgACAG0AAADsAQAAAAA=";
const appImport = await post(cr, "/v1/apps/import-json", {
  name: "acceptance-echo.zip",
  data: appArchive,
  strategy: "new",
});
assert.ok(
  ["installed", "unchanged"].includes(appImport.status),
  JSON.stringify(appImport),
);
await post(cr, "/v1/bindings", {
  capabilityId: "app.acceptance-echo",
  botId: "acceptance-bot",
  allowedTriggers: ["manual", "command", "scheduled", "agent"],
});
const appProbe = await post(
  cr,
  "/v1/capabilities/app.acceptance-echo/probe?botId=acceptance-bot",
  {},
);
assert.equal(appProbe.status, "healthy", JSON.stringify(appProbe));
const appInvocation = await post(cr, "/v1/invoke", {
  tenantId: "acceptance",
  botId: "acceptance-bot",
  capabilityId: "app.acceptance-echo",
  input: { value: "worker-route" },
  trigger: "manual",
  correlationId: crypto.randomUUID(),
});
assert.deepEqual(appInvocation.output.output, {
  ok: true,
  echo: "worker-route",
  trigger: "manual",
  hasToken: false,
});

const gatewayChannel = await post(mg, "/v1/channels", {
  tenantId: "acceptance",
  channel: "webhook",
  accountId: `acceptance-${Date.now()}`,
  botId: "acceptance-bot",
  name: "Acceptance Webhook",
});
const gatewaySink = await post(mg, "/v1/sinks", {
  name: `Acceptance Runtime ${Date.now()}`,
  kind: "runtime",
  endpoint: "http://runtime-center:4105/v1/executions",
  authTokenRef: "env:QFT_RUNTIME_SINK",
  maxAttempts: 3,
});
await post(mg, "/v1/routes", {
  name: `Acceptance route ${Date.now()}`,
  botId: "acceptance-bot",
  channelAccountId: gatewayChannel.id,
  sinkId: gatewaySink.id,
  requireMention: false,
  conversationTypes: ["dm", "group", "channel", "thread"],
});
const inbound = async (messageId, prompt) =>
  post(mg, "/v1/messages/inbound", {
    tenantId: "acceptance",
    messageId,
    channel: "webhook",
    accountId: gatewayChannel.accountId,
    channelInstanceId: gatewayChannel.id,
    botId: "acceptance-bot",
    conversationId: "acceptance-conversation",
    conversationType: "dm",
    senderId: "acceptance-user",
    senderType: "user",
    mentionedBotIds: [],
    text: prompt,
    attachments: [],
    timestamp: Date.now(),
  });
const firstInbound = await inbound(`acceptance-message-${Date.now()}`, "gateway-one");
const firstGatewayExecution = await waitFor(
  async () =>
    (await call(runtime, "/v1/executions?tenantId=acceptance")).find(
      (value) => value.source?.gatewayMessageId === firstInbound.message.id,
    ),
  (value) => value && ["succeeded", "failed"].includes(value.status),
);
assert.equal(firstGatewayExecution.status, "succeeded", firstGatewayExecution.error);
const secondInbound = await inbound(`acceptance-message-${Date.now()}-2`, "gateway-two");
const secondGatewayExecution = await waitFor(
  async () =>
    (await call(runtime, "/v1/executions?tenantId=acceptance")).find(
      (value) => value.source?.gatewayMessageId === secondInbound.message.id,
    ),
  (value) => value && ["succeeded", "failed"].includes(value.status),
);
assert.equal(secondGatewayExecution.status, "succeeded", secondGatewayExecution.error);
assert.equal(secondGatewayExecution.sessionId, firstGatewayExecution.sessionId);
assert.equal(secondGatewayExecution.workspaceId, firstGatewayExecution.workspaceId);
const gatewayEvent = await waitFor(
  async () =>
    (await call(mg, "/v1/sink-events?botId=acceptance-bot&limit=100")).find(
      (value) => value.messageId === secondInbound.message.id,
    ),
  (value) => value?.status === "delivered",
);

const execution = await post(runtime, "/v1/executions", {
  tenantId: "acceptance",
  botId: "acceptance-bot",
  prompt: "runtime-route",
});
const finished = await waitFor(
  () => call(runtime, `/v1/executions/${execution.id}`),
  (value) => ["succeeded", "failed"].includes(value.status),
);
assert.equal(finished.status, "succeeded", finished.error);
assert.equal(finished.response, "accepted: runtime-route");
const openAIAgentsExecution = await post(runtime, "/v1/executions", {
  tenantId: "acceptance",
  botId: "acceptance-openai-agents-bot",
  prompt: "openai-agents-runtime-route",
});
const openAIAgentsFinished = await waitFor(
  () => call(runtime, `/v1/executions/${openAIAgentsExecution.id}`),
  (value) => ["succeeded", "failed"].includes(value.status),
);
assert.equal(
  openAIAgentsFinished.status,
  "succeeded",
  openAIAgentsFinished.error,
);
assert.equal(
  openAIAgentsFinished.response,
  "accepted: openai-agents-runtime-route",
);
const transcript = await waitFor(
  async () =>
    (
      await call(
        ch,
        "/v1/transcripts?tenantId=acceptance&botId=acceptance-bot&limit=100",
      )
    ).find((item) => item.metadata?.executionId === finished.id),
  (value) => Boolean(value),
);
assert.equal(transcript.metadata.sessionId, finished.sessionId);

const continuationExecution = await post(runtime, "/v1/executions", {
  tenantId: "acceptance",
  botId: "acceptance-bot",
  conversationId: `continuation-${Date.now()}`,
  prompt: "/continue 10s continuation-route",
});
const continuationScheduled = await waitFor(
  () => call(runtime, `/v1/executions/${continuationExecution.id}`),
  (value) => ["succeeded", "failed"].includes(value.status),
);
assert.equal(
  continuationScheduled.status,
  "succeeded",
  continuationScheduled.error,
);
const continuationEvents = await call(
  runtime,
  `/v1/executions/${continuationExecution.id}/events`,
);
const continuationToken = continuationEvents.find(
  (event) => event.type === "result" && event.data?.continuation,
)?.data?.continuationToken;
assert.ok(continuationToken);
const continuationRun = await waitFor(
  async () =>
    (await call(scheduler, `/v1/runs?taskId=${continuationToken}`))[0],
  (value) => value && ["succeeded", "failed"].includes(value.status),
  30000,
);
assert.equal(continuationRun.status, "succeeded", continuationRun.error);
const continuedExecution = await call(
  runtime,
  `/v1/executions/${continuationRun.executionId}`,
);
assert.equal(continuedExecution.response, "accepted: continuation-route");
assert.equal(continuedExecution.sessionId, continuationScheduled.sessionId);

const toolExecution = await post(runtime, "/v1/executions", {
  tenantId: "acceptance",
  botId: "acceptance-bot",
  prompt: "tool-browser",
});
const toolFinished = await waitFor(
  () => call(runtime, `/v1/executions/${toolExecution.id}`),
  (value) => ["succeeded", "failed"].includes(value.status),
  60000,
);
assert.equal(toolFinished.status, "succeeded", toolFinished.error);
assert.equal(toolFinished.response, "accepted: browser tool result");
const toolEvents = await call(
  runtime,
  `/v1/executions/${toolExecution.id}/events`,
);
assert.ok(toolEvents.some((event) => event.type === "tool_call"));
assert.ok(toolEvents.some((event) => event.type === "tool_result"));

const task = await post(scheduler, "/v1/tasks", {
  tenantId: "acceptance",
  botId: "acceptance-bot",
  name: `manual-${Date.now()}`,
  enabled: true,
  schedule: { type: "daily", time: "23:59" },
  timezone: "Asia/Shanghai",
  target: {
    type: "runtime",
    payload: { prompt: "scheduled-route", modelPolicyId: policy.id },
  },
  retry: { maxAttempts: 2, delaySeconds: 1 },
  misfire: "run-once",
  maxBackfill: 10,
});
const beforeNext = task.nextRunAt;
const run = await post(scheduler, `/v1/tasks/${task.id}/run`, {});
const scheduled = await waitFor(
  async () =>
    (await call(scheduler, `/v1/runs?taskId=${task.id}`)).find(
      (value) => value.id === run.id,
    ),
  (value) => value && ["succeeded", "failed"].includes(value.status),
);
assert.equal(scheduled.status, "succeeded", scheduled.error);
const taskAfter = (await call(scheduler, "/v1/tasks")).find(
  (value) => value.id === task.id,
);
assert.equal(taskAfter.nextRunAt, beforeNext);

const workflowTask = await post(scheduler, "/v1/tasks", {
  tenantId: "acceptance",
  botId: "acceptance-bot",
  name: `workflow-${Date.now()}`,
  enabled: true,
  schedule: { type: "daily", time: "23:58" },
  timezone: "Asia/Shanghai",
  target: {
    type: "workflow",
    payload: {
      workflowId,
      prompt: "scheduled workflow",
      input: { arguments: "scheduled" },
    },
  },
  retry: { maxAttempts: 2, delaySeconds: 1 },
  misfire: "run-once",
  maxBackfill: 10,
});
const workflowRun = await post(
  scheduler,
  `/v1/tasks/${workflowTask.id}/run`,
  {},
);
const scheduledWorkflow = await waitFor(
  async () =>
    (await call(scheduler, `/v1/runs?taskId=${workflowTask.id}`)).find(
      (value) => value.id === workflowRun.id,
    ),
  (value) => value && ["succeeded", "failed"].includes(value.status),
);
assert.equal(
  scheduledWorkflow.status,
  "succeeded",
  scheduledWorkflow.error,
);

const backfill = await post(scheduler, "/v1/history-backfills", {
  tenantId: "acceptance",
  botId: "acceptance-bot",
  lookbackSeconds: 3600,
  maxMessages: 25,
});
const completedBackfill = await waitFor(
  () => call(scheduler, `/v1/history-backfills/${backfill.id}`),
  (value) => ["succeeded", "partial", "failed", "cancelled"].includes(value.status),
);
assert.equal(completedBackfill.status, "succeeded", completedBackfill.error);

const browserRequest = {
  tenantId: "acceptance",
  botId: "acceptance-bot",
  sessionKey: `acceptance-${Date.now()}`,
  startUrl: "http://mock-model:8090/browser-test",
  allowedDomains: ["mock-model"],
  actions: [
    { type: "extract", selector: "body" },
    { type: "download", selector: "#download", name: "acceptance.txt" },
    { type: "pdf", name: "acceptance.pdf", format: "A4" },
    { type: "screenshot", name: "acceptance.png" },
  ],
  keepAlive: false,
  recordVideo: true,
  correlationId: crypto.randomUUID(),
};
let browserRun = await post(browser, "/v1/browser/workflows", browserRequest);
assert.equal(
  browserRun.status,
  "waiting_approval",
  `Browser download must stop at an approval checkpoint: ${JSON.stringify(browserRun)}`,
);
const browserApprovalId = browserRun.steps.at(-1)?.output?.approvalId;
assert.ok(browserApprovalId);
await post(governance, `/v1/approvals/${browserApprovalId}/resolve`, {
  approverId: "acceptance-owner",
  status: "approved",
  reason: "End-to-end governed download verification",
});
browserRun = await post(browser, "/v1/browser/workflows", {
  ...browserRequest,
  approvalId: browserApprovalId,
});
assert.equal(browserRun.status, "succeeded", JSON.stringify(browserRun));
const browserArtifacts = browserRun.steps
  .map((step) => step.artifactId)
  .filter(Boolean);
assert.ok(browserArtifacts.length >= 3);
assert.ok(browserRun.artifactIds.length >= 2);

const wav = (() => {
  const samples = 8000;
  const buffer = Buffer.alloc(44 + samples * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24);
  buffer.writeUInt32LE(16000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(samples * 2, 40);
  return buffer;
})();
const form = new FormData();
form.append("tenantId", "acceptance");
form.append("kind", "object");
form.append("file", new Blob([wav], { type: "audio/wav" }), "silence.wav");
const uploadResponse = await fetch(`${resource}/v1/resources`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}` },
  body: form,
});
const uploadBody = await uploadResponse.json();
assert.equal(uploadResponse.status, 201, JSON.stringify(uploadBody));
const inputResource = uploadBody.data.item;
await call(resource, `/v1/resources/${inputResource.id}/acl`, {
  method: "PATCH",
  body: JSON.stringify({
    tenantId: "acceptance",
    allowedBotIds: ["acceptance-bot"],
  }),
});
const allowedResource = await fetch(
  `${resource}/v1/resources/${inputResource.id}/content?tenantId=acceptance&botId=acceptance-bot`,
  { headers: { authorization: `Bearer ${token}` } },
);
assert.equal(allowedResource.status, 200);
const deniedResource = await fetch(
  `${resource}/v1/resources/${inputResource.id}/content?tenantId=acceptance&botId=other-bot`,
  { headers: { authorization: `Bearer ${token}` } },
);
assert.equal(deniedResource.status, 404);
const resourceStats = await call(resource, "/v1/stats?tenantId=acceptance");
assert.ok(resourceStats.count >= 1);
const integrity = await post(resource, "/v1/integrity/check", {
  tenantId: "acceptance",
  dryRun: true,
  removeMissing: false,
});
assert.equal(integrity.missing, 0);
const probe = await post(resource, "/v1/media/jobs", {
  tenantId: "acceptance",
  operation: "info",
  inputIds: [inputResource.id],
  outputName: "silence-info.json",
  mediaType: "application/json",
  params: {},
});
assert.equal(probe.status, "queued");
const completedProbe = await waitFor(
  () => call(resource, `/v1/media/jobs/${probe.id}?tenantId=acceptance`),
  (value) => ["succeeded", "failed", "cancelled"].includes(value.status),
);
assert.equal(completedProbe.status, "succeeded", completedProbe.error);
assert.ok(Array.isArray(completedProbe.result.streams));
const normalized = await post(resource, "/v1/media/jobs", {
  tenantId: "acceptance",
  operation: "normalize",
  inputIds: [inputResource.id],
  outputName: "silence-normalized.wav",
  mediaType: "audio/wav",
  params: {},
});
assert.equal(normalized.status, "queued");
const completedMedia = await waitFor(
  () => call(resource, `/v1/media/jobs/${normalized.id}?tenantId=acceptance`),
  (value) => ["succeeded", "failed", "cancelled"].includes(value.status),
);
assert.equal(completedMedia.status, "succeeded", completedMedia.error);
assert.equal(completedMedia.progress, 100);
const normalizedOutput = (
  await call(resource, "/v1/resources?tenantId=acceptance")
).find((value) => value.id === completedMedia.outputId);
assert.ok(normalizedOutput?.size > 44);

const documentForm = new FormData();
documentForm.append("tenantId", "acceptance");
documentForm.append("kind", "object");
documentForm.append(
  "file",
  new Blob(
    ["# Store handbook\n\nMorning snapshots are retained for ninety days."],
    { type: "text/markdown" },
  ),
  "handbook.md",
);
const documentUploadResponse = await fetch(`${resource}/v1/resources`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}` },
  body: documentForm,
});
const documentUpload = await documentUploadResponse.json();
assert.equal(documentUploadResponse.status, 201, JSON.stringify(documentUpload));
const contextSource = await post(ch, "/v1/sources", {
  name: `Acceptance handbook ${Date.now()}`,
  kind: "file",
  scope: { tenantId: "acceptance" },
});
await post(ch, "/v1/bindings", {
  sourceId: contextSource.id,
  botId: "acceptance-bot",
});
const documentIngest = await post(
  ch,
  `/v1/sources/${contextSource.id}/resources`,
  {
    tenantId: "acceptance",
    resourceId: documentUpload.data.item.id,
    name: "handbook.md",
    mimeType: "text/markdown",
    scope: { botIds: ["acceptance-bot"] },
  },
);
assert.ok(documentIngest.chunkCount >= 1);
assert.equal(documentIngest.parser, "officeparser");
const retrievedDocument = await post(ch, "/v1/retrieve", {
  botId: "acceptance-bot",
  query: "Morning snapshots",
  limit: 5,
  includeMemory: false,
  correlationId: crypto.randomUUID(),
});
assert.ok(retrievedDocument.items.length >= 1);
assert.equal(
  retrievedDocument.items[0].metadata.resourceRef,
  `resource:${documentUpload.data.item.id}`,
);

const diagnostic = await post(resource, "/v1/diagnostics", {
  tenantId: "acceptance",
  sections: { health: "ok", credential: { password: "must-redact" } },
  logs: [{ name: "acceptance.log", content: "healthy" }],
});
assert.equal(diagnostic.item.mediaType, "application/zip");

console.log(
  JSON.stringify(
    {
      ok: true,
      model: inference.invocationId,
      execution: finished.id,
      openAIAgentsExecution: openAIAgentsFinished.id,
      transcript: transcript.id,
      continuationRun: continuationRun.id,
      gatewayExecution: secondGatewayExecution.id,
      gatewayEvent: gatewayEvent.id,
      toolExecution: toolFinished.id,
      commandExecution: commandFinished.id,
      customAppExecution: appInvocation.capabilityId,
      scheduledRun: scheduled.id,
      scheduledWorkflow: scheduledWorkflow.id,
      historyBackfill: completedBackfill.id,
      browserArtifacts,
      mediaJob: completedMedia.id,
      resourceIntegrityChecked: integrity.checked,
      contextResource: documentUpload.data.item.id,
      diagnostic: diagnostic.item.id,
    },
    null,
    2,
  ),
);
