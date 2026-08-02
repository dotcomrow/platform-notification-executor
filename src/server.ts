import express, { NextFunction, Request, Response } from "express";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import { ZodError } from "zod";
import { config } from "./config.js";
import { enforceInternalAuth } from "./auth/internal-auth.js";
import { resolveInternalToken } from "./lib/vault.js";
import { asRecord, redactJsonRecord, truncate } from "./lib/json.js";
import { executeDelivery } from "./delivery/execute-delivery.js";
import { parseDeliveryRequest } from "./delivery/validation.js";
import { openApiSpec } from "./openapi.js";

const app = express();
app.set("trust proxy", config.trustProxyHops);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "2mb" }));
app.use(morgan("combined"));
app.use(rateLimit({ windowMs: config.rateWindowMs, limit: config.rateMax, standardHeaders: "draft-7", legacyHeaders: false }));

app.get("/healthz", (_req, res) => {
  res.status(200).json({ ok: true, service: "platform-notification-executor", version: "1.0.0" });
});

app.get("/readyz", async (_req, res) => {
  try {
    if (config.authRequired) {
      await resolveInternalToken();
    }
    res.status(200).json({
      ok: true,
      service: "platform-notification-executor",
      mode: config.executorMode,
      auth_required: config.authRequired
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      service: "platform-notification-executor",
      reason: "executor_dependency_failed",
      error: error instanceof Error ? truncate(error.message, 500) : "Unknown readiness error"
    });
  }
});

app.get("/openapi.json", (_req, res) => {
  res.status(200).json(openApiSpec);
});

app.post("/internal/notifications/:id/deliveries", async (req, res, next) => {
  try {
    await enforceInternalAuth(req);
    const input = parseDeliveryRequest(req.body);
    const result = await executeDelivery(req.params.id, input);
    res.status(result.ok ? 200 : 501).json(result);
  } catch (error) {
    next(error);
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: { message: "Not found", status: 404 } });
});

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof ZodError
    ? 422
    : Math.max(400, Math.min(599, Number((err as { status?: number }).status) || 500));
  const message = err instanceof ZodError
    ? err.errors.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`).join("; ")
    : err instanceof Error ? err.message : "Internal server error";

  if (status >= 500) {
    const body = asRecord(req.body) ? redactJsonRecord(asRecord(req.body) ?? {}) : {};
    console.error(`[platform-notification-executor] request failed status=${status}: ${truncate(message, 1000)} body=${truncate(JSON.stringify(body), 1000)}`);
  }

  res.status(status).json({
    error: {
      message,
      status
    }
  });
});

app.listen(config.port, () => {
  console.log(`[platform-notification-executor] listening on :${config.port} mode=${config.executorMode}`);
});
