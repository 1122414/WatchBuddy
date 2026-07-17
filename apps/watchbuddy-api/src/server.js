import http from "node:http";
import { pathToFileURL } from "node:url";

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;

function sendJson(response, statusCode, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);

  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
    "content-type": "application/json; charset=utf-8",
    ...extraHeaders
  });
  response.end(payload);
}

export function createWatchBuddyServer({
  now = () => new Date(),
  serviceVersion = "0.1.0"
} = {}) {
  return http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://watchbuddy.local");

    if (url.pathname !== "/health") {
      sendJson(response, 404, {
        error: "not_found"
      });
      return;
    }

    if (request.method !== "GET") {
      sendJson(response, 405, {
        error: "method_not_allowed"
      }, {
        allow: "GET"
      });
      return;
    }

    sendJson(response, 200, {
      ok: true,
      service: "watchbuddy-api",
      version: serviceVersion,
      time: now().toISOString()
    });
  });
}

export async function startWatchBuddyServer({
  host = process.env.HOST ?? DEFAULT_HOST,
  port = Number.parseInt(process.env.PORT ?? `${DEFAULT_PORT}`, 10)
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError("PORT 必须是 0 到 65535 之间的整数");
  }

  const server = createWatchBuddyServer();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });

  return server;
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  const server = await startWatchBuddyServer();
  const address = server.address();
  const displayHost = typeof address === "object" && address ? address.address : DEFAULT_HOST;
  const displayPort = typeof address === "object" && address ? address.port : DEFAULT_PORT;

  console.log(`WatchBuddy API listening on http://${displayHost}:${displayPort}`);
}
