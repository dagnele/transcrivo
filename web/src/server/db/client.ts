import { drizzle } from "drizzle-orm/postgres-js";

import { getPostgresClient } from "@/server/db/postgres-client";
import * as schema from "@/server/db/schema";

function createDb() {
  return drizzle(getPostgresClient(), { schema });
}

type Database = ReturnType<typeof createDb>;

let dbInstance: Database | null = null;

export function getDb(): Database {
  dbInstance ??= createDb();
  return dbInstance;
}

export const db = new Proxy({} as Database, {
  get(_target, property, receiver) {
    return Reflect.get(getDb(), property, receiver);
  },
});
