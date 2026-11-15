const { app, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { Agent, fetch } = require("undici");

// Keep Pulse’s self-signed certificate support scoped to its direct requests.
const dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
const directFetch = (url, options) => fetch(url, { ...options, dispatcher });

module.exports = function registerPulseServices(ownsPulseFrame) {
  const workspaceDirectory = path.join(app.getPath("userData"), "pulse", "workspace");
  const workspaceFile = path.join(workspaceDirectory, "data.json");
  const legacyWorkspaceFile = path.join(app.getPath("appData"), "Pulse API Studio", "workspace", "data.json");

  const HOP_BY_HOP = new Set([
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
  ]);

  // IPC Handler for Health Check
  ipcMain.handle("pulse:health-check", async (event) => {
    if (!ownsPulseFrame(event)) throw new Error("Pulse access denied.");
    return {
      ok: true,
      service: "pulse-desktop-native",
      platform: process.platform,
      timestamp: new Date().toISOString(),
    };
  });

  const activeProxyRequests = new Map();
  ipcMain.on("pulse:cancel-proxy-request", (event, id) => {
    if (ownsPulseFrame(event) && typeof id === "string") {
      activeProxyRequests.get(`${event.sender.id}:${id}`)?.abort(new Error("Request cancelled"));
    }
  });

  // IPC Handler for Native Request Execution (Bypasses CORS, local ports & firewall blocks)
  ipcMain.handle("pulse:proxy-request", async (event, reqData) => {
    if (!ownsPulseFrame(event)) throw new Error("Pulse access denied.");
    const started = Date.now();
    let {
      method = "GET",
      url,
      headers = {},
      body,
      timeout = 0,
      cancellationId,
    } = reqData ?? {};

    if (!url || typeof url !== "string") {
      return {
        ok: false,
        error: true,
        status: 0,
        statusText: "Bad Request",
        headers: {},
        body: "Missing request URL",
        time: Date.now() - started,
        size: 0,
      };
    }

    let targetUrl = url.trim();
    // Auto-prefix relative mock endpoints or bare local hostnames
    if (targetUrl.startsWith("/")) {
      targetUrl = `http://127.0.0.1:3001${targetUrl}`;
    } else if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/.*)?$/i.test(targetUrl)) {
      targetUrl = `http://${targetUrl}`;
    }

    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return {
        ok: false,
        error: true,
        status: 0,
        statusText: "Invalid URL",
        headers: {},
        body: `Invalid URL: ${targetUrl}`,
        time: Date.now() - started,
        size: 0,
      };
    }

    // Handle local mock endpoints in-memory so sample requests work immediately offline
    const pathname = parsed.pathname;
    if (pathname === "/api/health") {
      const data = JSON.stringify(
        { ok: true, service: "pulse-desktop-native", platform: process.platform, timestamp: new Date().toISOString() },
        null,
        2
      );
      return {
        ok: true,
        error: false,
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        body: data,
        time: Date.now() - started,
        size: Buffer.byteLength(data),
      };
    }

    if (pathname === "/api/mock/echo") {
      let parsedBody = body;
      if (typeof body === "string") {
        try {
          parsedBody = JSON.parse(body);
        } catch {
          parsedBody = body;
        }
      }
      const data = JSON.stringify(
        {
          ok: true,
          method: String(method || "GET").toUpperCase(),
          headers,
          query: Object.fromEntries(parsed.searchParams.entries()),
          body: parsedBody,
          timestamp: new Date().toISOString(),
        },
        null,
        2
      );
      return {
        ok: true,
        error: false,
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        body: data,
        time: Date.now() - started,
        size: Buffer.byteLength(data),
      };
    }

    if (pathname === "/api/mock/users") {
      const data = JSON.stringify(
        {
          ok: true,
          users: [
            { id: 1, name: "Alice Jha", role: "admin", status: "active" },
            { id: 2, name: "Bob Smith", role: "developer", status: "active" },
            { id: 3, name: "Charlie Davis", role: "tester", status: "pending" },
          ],
        },
        null,
        2
      );
      return {
        ok: true,
        error: false,
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        body: data,
        time: Date.now() - started,
        size: Buffer.byteLength(data),
      };
    }

    if (pathname === "/api/mock/auth-check") {
      let authHeader = "";
      if (headers && typeof headers === "object") {
        for (const [k, v] of Object.entries(headers)) {
          if (k.toLowerCase() === "authorization") {
            authHeader = String(v);
            break;
          }
        }
      }
      if (!authHeader) {
        const data = JSON.stringify({ ok: false, error: "Missing Authorization header" }, null, 2);
        return {
          ok: false,
          error: true,
          status: 401,
          statusText: "Unauthorized",
          headers: { "content-type": "application/json" },
          body: data,
          time: Date.now() - started,
          size: Buffer.byteLength(data),
        };
      }
      const data = JSON.stringify({ ok: true, authorized: true, authHeader }, null, 2);
      return {
        ok: true,
        error: false,
        status: 200,
        statusText: "OK",
        headers: { "content-type": "application/json" },
        body: data,
        time: Date.now() - started,
        size: Buffer.byteLength(data),
      };
    }

    // Outbound HTTP/HTTPS request execution
    const controller = new AbortController();
    const requestKey = typeof cancellationId === "string" ? `${event.sender.id}:${cancellationId}` : null;
    if (requestKey) activeProxyRequests.set(requestKey, controller);
    const parsedTimeout = Math.max(0, Number(timeout) || 0);
    const timer = parsedTimeout > 0 ? setTimeout(() => controller.abort(), parsedTimeout) : null;

    try {
      const outboundHeaders = new Headers();
      if (headers && typeof headers === "object") {
        for (const [key, value] of Object.entries(headers)) {
          if (!key || value == null) continue;
          if (HOP_BY_HOP.has(key.toLowerCase())) continue;
          try {
            outboundHeaders.set(key, String(value));
          } catch {
            // Skip invalid header format
          }
        }
      }

      const verb = String(method || "GET").toUpperCase();
      const init = {
        method: verb,
        headers: outboundHeaders,
        signal: controller.signal,
        redirect: "follow",
      };

      if (body != null && body !== "" && !["GET", "HEAD"].includes(verb)) {
        init.body = typeof body === "string" ? body : JSON.stringify(body);
      }

      let response;
      // Node fetch does not use Electron's system proxy configuration.
      const session = event.sender.session;
      const proxy = ["http:", "https:"].includes(parsed.protocol)
        ? await session.resolveProxy(targetUrl)
        : "DIRECT";
      controller.signal.throwIfAborted();

      try {
        response = proxy && proxy !== "DIRECT"
          ? await session.fetch(targetUrl, { ...init, credentials: "omit", bypassCustomProtocolHandlers: true })
          : await directFetch(targetUrl, init);
      } catch (fetchErr) {
        // If localhost failed with ECONNREFUSED (due to Node IPv6 ::1 default), retry with IPv4 127.0.0.1
        if (
          (!proxy || proxy === "DIRECT") &&
          parsed.hostname === "localhost" &&
          !controller.signal.aborted &&
          (fetchErr?.message?.includes("ECONNREFUSED") || fetchErr?.cause?.code === "ECONNREFUSED")
        ) {
          const ipv4Url = targetUrl.replace("://localhost", "://127.0.0.1");
          response = await directFetch(ipv4Url, init);
        } else {
          throw fetchErr;
        }
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const respHeaders = {};
      response.headers.forEach((value, key) => {
        respHeaders[key] = value;
      });

      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      const isBinary =
        contentType.startsWith("image/") ||
        contentType.startsWith("audio/") ||
        contentType.startsWith("video/") ||
        contentType.includes("octet-stream") ||
        contentType.includes("application/pdf");

      const bodyText = isBinary
        ? `[binary ${contentType || "data"} — ${buffer.length} bytes]`
        : buffer.toString("utf8");

      return {
        ok: response.ok,
        error: false,
        status: response.status,
        statusText: response.statusText,
        headers: respHeaders,
        body: bodyText,
        time: Date.now() - started,
        size: buffer.length,
      };
    } catch (err) {
      const timedOut = controller.signal.aborted && controller.signal.reason?.name === "AbortError";
      const code = err?.cause?.code || err?.code;
      const detail = err instanceof Error ? err.message : String(err);
      const message = timedOut
        ? `Request timed out after ${parsedTimeout}ms`
        : code ? `${detail} (${code})` : detail;

      return {
        ok: false,
        error: true,
        status: 0,
        statusText: timedOut ? "Timeout" : "Network Error",
        headers: {},
        body: message,
        time: Date.now() - started,
        size: 0,
      };
    } finally {
      if (timer) clearTimeout(timer);
      if (requestKey && activeProxyRequests.get(requestKey) === controller) activeProxyRequests.delete(requestKey);
    }
  });

  function handleWorkspaceRequest(channel, action) {
    ipcMain.on(channel, (event, ...args) => {
      if (!ownsPulseFrame(event)) {
        event.returnValue = { ok: false, error: "Workspace access denied." };
        return;
      }
      try {
        event.returnValue = { ok: true, data: action(...args) };
      } catch (error) {
        console.error(`Workspace operation failed (${channel}): ${error.code || error.name}`);
        event.returnValue = { ok: false, error: "Could not access the saved workspace." };
      }
    });
  }

  handleWorkspaceRequest("pulse:read-workspace", () => {
    try {
      return fs.readFileSync(workspaceFile, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") {
        try {
          return fs.readFileSync(legacyWorkspaceFile, "utf8");
        } catch (legacyError) {
          if (legacyError.code === "ENOENT") return null;
          throw legacyError;
        }
      }
      throw error;
    }
  });

  handleWorkspaceRequest("pulse:write-workspace", (data) => {
    if (typeof data !== "string") throw new TypeError("Expected serialized workspace data.");
    fs.mkdirSync(workspaceDirectory, { recursive: true });
    const temporaryFile = path.join(workspaceDirectory, "data.tmp");
    fs.writeFileSync(temporaryFile, data, { mode: 0o600 });
    fs.renameSync(temporaryFile, workspaceFile);
  });
};
