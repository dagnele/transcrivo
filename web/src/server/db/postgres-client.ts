import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set.");
}

const globalForDatabase = globalThis as typeof globalThis & {
  postgresClient?: ReturnType<typeof postgres>;
};

export const postgresClient =
  globalForDatabase.postgresClient ??
  postgres(databaseUrl, {
    max: 1,
    prepare: false,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDatabase.postgresClient = postgresClient;
}
