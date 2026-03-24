const DEFAULT_SITE_URL = "https://transcrivo.live";

export function getSiteUrl(): URL {
  const rawUrl = process.env.APP_BASE_URL ?? process.env.BETTER_AUTH_URL ?? DEFAULT_SITE_URL;

  try {
    return new URL(rawUrl);
  } catch {
    return new URL(DEFAULT_SITE_URL);
  }
}

export function getSiteUrlString(): string {
  return getSiteUrl().toString().replace(/\/$/, "");
}
