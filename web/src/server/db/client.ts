import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/server/db/schema";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set.");
}

const globalForDatabase = globalThis as typeof globalThis & {
  postgresClient?: ReturnType<typeof postgres>;
};

const client =
  globalForDatabase.postgresClient ??
  postgres(databaseUrl, {
    max: 1,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.postgresClient = client;
}

export const db = drizzle(client, { schema });
