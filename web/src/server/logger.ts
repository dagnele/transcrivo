import pino from "pino";
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";

const isDevelopment = process.env.NODE_ENV !== "production";

function isEnabled(value: string | undefined) {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

const transcriptionDebugFileEnabled = isEnabled(process.env.TRANSCRIPTION_DEBUG_FILE);
const websocketDebugLoggingEnabled = isEnabled(process.env.WEBSOCKET_DEBUG_LOGS);

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDevelopment ? "debug" : "info"),
  base: undefined,
  transport: isDevelopment
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          ignore: "pid,hostname",
          translateTime: "SYS:standard",
        },
      }
    : undefined,
});

export function createLogger(service: string) {
  return logger.child({ service });
}

const transcriptionLogPath = resolve(process.cwd(), "logs", "transcription.ndjson");

function createFileDestination(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
  return pino.destination({ dest: filePath, mkdir: true, sync: false });
}

export const transcriptionLogger = transcriptionDebugFileEnabled
  ? pino(
      {
        level: "debug",
        base: undefined,
      },
      createFileDestination(transcriptionLogPath),
    ).child({ service: "transcription-debug" })
  : null;

export {
  transcriptionDebugFileEnabled,
  transcriptionLogPath,
  websocketDebugLoggingEnabled,
};
