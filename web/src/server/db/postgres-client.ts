import postgres from "postgres";

const globalForDatabase = globalThis as typeof globalThis & {
  postgresClient?: ReturnType<typeof postgres>;
};

function createPostgresClient() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set.");
  }

  return postgres(databaseUrl, {
    max: 1,
    prepare: false,
  });
}

export function getPostgresClient() {
  const postgresClient = globalForDatabase.postgresClient ?? createPostgresClient();

  if (process.env.NODE_ENV !== "production") {
    globalForDatabase.postgresClient = postgresClient;
  }

  return postgresClient;
}

export const postgresClient = new Proxy({} as ReturnType<typeof postgres>, {
  get(_target, property, receiver) {
    return Reflect.get(getPostgresClient(), property, receiver);
  },
});
