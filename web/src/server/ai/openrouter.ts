import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";

export const openRouterProviderName = "openrouter" as const;

const openRouterEnvSchema = z.object({
  OPENROUTER_API_KEY: z.string().trim().min(1),
  OPENROUTER_MODEL: z.string().trim().min(1).optional(),
  OPENROUTER_BASE_URL: z.string().trim().url().optional(),
  OPENROUTER_HTTP_REFERER: z.string().trim().url().optional(),
  OPENROUTER_APP_TITLE: z.string().trim().min(1).optional(),
});

export type OpenRouterRuntimeConfig = {
  provider: typeof openRouterProviderName;
  modelId: string;
  baseURL?: string;
  httpReferer?: string;
  appTitle?: string;
};

function readOpenRouterEnv() {
  return openRouterEnvSchema.parse(process.env);
}

export function getOpenRouterRuntimeConfig(
  modelIdOverride?: string,
): OpenRouterRuntimeConfig {
  const env = readOpenRouterEnv();
  const modelId = modelIdOverride ?? env.OPENROUTER_MODEL;

  if (!modelId) {
    throw new Error(
      "OPENROUTER_MODEL is required until a default interview solution model is chosen.",
    );
  }

  return {
    provider: openRouterProviderName,
    modelId,
    baseURL: env.OPENROUTER_BASE_URL,
    httpReferer: env.OPENROUTER_HTTP_REFERER,
    appTitle: env.OPENROUTER_APP_TITLE,
  };
}

export function createOpenRouterClient(modelIdOverride?: string) {
  const env = readOpenRouterEnv();
  const runtime = getOpenRouterRuntimeConfig(modelIdOverride);

  const headers: Record<string, string> = {};

  if (runtime.httpReferer) {
    headers["HTTP-Referer"] = runtime.httpReferer;
  }

  if (runtime.appTitle) {
    headers["X-Title"] = runtime.appTitle;
  }

  const openrouter = createOpenRouter({
    apiKey: env.OPENROUTER_API_KEY,
    baseURL: runtime.baseURL,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    compatibility: "strict",
  });

  return {
    provider: openrouter,
    model: openrouter.chat(runtime.modelId),
    config: runtime,
  };
}
