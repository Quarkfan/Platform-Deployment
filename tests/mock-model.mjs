import { createServer } from "node:http";

createServer((request, response) => {
  if (request.url === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    return response.end('{"ok":true}');
  }
  if (request.url === "/browser-test") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return response.end(
      '<!doctype html><title>Browser Acceptance</title><body><a id="download" href="/file.txt" download>Download</a><main>browser-ready</main></body>',
    );
  }
  if (request.url === "/file.txt") {
    response.writeHead(200, {
      "content-type": "text/plain",
      "content-disposition": 'attachment; filename="acceptance.txt"',
    });
    return response.end("download-ready");
  }
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    const input = body ? JSON.parse(body) : {};
    const last = input.messages?.at(-1);
    const prompt = last?.content ?? input.prompt ?? "ready";
    let message = { content: `accepted: ${prompt}` };
    let finishReason = "stop";
    if (last?.role === "tool") {
      message = { content: "accepted: browser tool result" };
    } else if (prompt === "tool-browser" && input.tools?.length) {
      const tool = input.tools.find((item) =>
        item.function?.name?.includes("browser"),
      );
      message = {
        content: null,
        tool_calls: [
          {
            id: "acceptance-browser-call",
            type: "function",
            function: {
              name: tool.function.name,
              arguments: JSON.stringify({
                sessionKey: `tool-${Date.now()}`,
                startUrl: "http://mock-model:8090/healthz",
                allowedDomains: ["mock-model"],
                actions: [{ type: "extract", selector: "body" }],
                keepAlive: false,
              }),
            },
          },
        ],
      };
      finishReason = "tool_calls";
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [{ message, finish_reason: finishReason }],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      }),
    );
  });
}).listen(8090, "0.0.0.0");
