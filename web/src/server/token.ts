import { z } from "zod";

export const CLI_TOKEN_LIFETIME_MS = 90 * 60 * 1000;

const tokenPayloadSchema = z.object({
  sid: z.string().min(1),
  uid: z.string().nullable(),
  iat: z.number().int(),
  exp: z.number().int(),
});

export type TokenPayload = z.infer<typeof tokenPayloadSchema>;

function getSecret(): string {
  const secret = process.env.TOKEN_SECRET;
  if (!secret) {
    throw new Error("TOKEN_SECRET environment variable is required");
  }
  return secret;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

const encoder = new TextEncoder();

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function hmacSign(data: string, secret: string): Promise<string> {
  const key = await importKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return base64url(new Uint8Array(signature));
}

async function hmacVerify(
  data: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const key = await importKey(secret);
  const sigBytes = base64urlDecode(signature);
  const signatureBuffer = new Uint8Array(sigBytes.byteLength);
  signatureBuffer.set(sigBytes);
  return crypto.subtle.verify(
    "HMAC",
    key,
    signatureBuffer,
    encoder.encode(data),
  );
}

export async function signSessionToken(
  sessionId: string,
  expiresAt: Date,
  userId: string | null = null,
): Promise<string> {
  const secret = getSecret();
  const now = Math.floor(Date.now() / 1000);
  const expiresAtSeconds = Math.floor(expiresAt.getTime() / 1000);

  if (expiresAtSeconds <= now) {
    throw new Error("Token expiration must be in the future");
  }

  const header = base64url(encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const payload = base64url(
    encoder.encode(
      JSON.stringify({
        sid: sessionId,
        uid: userId,
        iat: now,
        exp: expiresAtSeconds,
      }),
    ),
  );

  const signingInput = `${header}.${payload}`;
  const signature = await hmacSign(signingInput, secret);

  return `${signingInput}.${signature}`;
}

export async function verifySessionToken(token: string): Promise<TokenPayload> {
  const secret = getSecret();
  const parts = token.split(".");

  if (parts.length !== 3) {
    throw new TokenError("Malformed token");
  }

  const [header, payload, signature] = parts;
  const signingInput = `${header}.${payload}`;
  const valid = await hmacVerify(signingInput, signature, secret);

  if (!valid) {
    throw new TokenError("Invalid token signature");
  }

  let decoded: unknown;
  try {
    const bytes = base64urlDecode(payload);
    decoded = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new TokenError("Invalid token payload");
  }

  const parsed = tokenPayloadSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new TokenError("Invalid token claims");
  }

  const now = Math.floor(Date.now() / 1000);
  if (parsed.data.exp <= now) {
    throw new TokenError("Token has expired");
  }

  return parsed.data;
}

export class TokenError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "TokenError";
  }
}
