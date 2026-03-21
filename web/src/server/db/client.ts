import { drizzle } from "drizzle-orm/postgres-js";

import { postgresClient } from "@/server/db/postgres-client";
import * as schema from "@/server/db/schema";

export const db = drizzle(postgresClient, { schema });
