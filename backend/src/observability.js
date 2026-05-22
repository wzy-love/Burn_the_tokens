import * as Sentry from "@sentry/node";

const LEVEL_WEIGHT = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const LOG_LEVEL = (process.env.LOG_LEVEL || "info").toLowerCase();
let sentryEnabled = false;

const levelAllowed = (level) =>
  (LEVEL_WEIGHT[level] ?? LEVEL_WEIGHT.info) >=
  (LEVEL_WEIGHT[LOG_LEVEL] ?? LEVEL_WEIGHT.info);

const formatMeta = (meta) => {
  if (!meta || typeof meta !== "object") return "";
  const pairs = Object.entries(meta).filter(([, value]) => value !== undefined);
  return pairs.length ? ` ${JSON.stringify(Object.fromEntries(pairs))}` : "";
};

const log = {
  debug(message, meta) {
    if (!levelAllowed("debug")) return;
    console.debug(`[DEBUG] ${message}${formatMeta(meta)}`);
  },
  info(message, meta) {
    if (!levelAllowed("info")) return;
    console.info(`[INFO] ${message}${formatMeta(meta)}`);
  },
  warn(message, meta) {
    if (!levelAllowed("warn")) return;
    console.warn(`[WARN] ${message}${formatMeta(meta)}`);
  },
  error(message, meta) {
    if (!levelAllowed("error")) return;
    console.error(`[ERROR] ${message}${formatMeta(meta)}`);
  }
};

const initObservability = () => {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    log.info("Sentry disabled (SENTRY_DSN not set).");
    return;
  }

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.2)
  });
  sentryEnabled = true;
  log.info("Sentry initialized.");
};

const captureException = (error, context) => {
  if (!error) return;
  log.error("Captured exception", {
    message: String(error?.message || error),
    ...context
  });
  if (sentryEnabled) {
    Sentry.captureException(error, { extra: context });
  }
};

const requestMetricsMiddleware = (req, res, next) => {
  const requestId = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const start = process.hrtime.bigint();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  res.on("finish", () => {
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1_000_000;
    const level =
      res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    log[level]("HTTP request", {
      requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Number(elapsedMs.toFixed(2))
    });
  });

  next();
};

export { captureException, initObservability, log, requestMetricsMiddleware };
