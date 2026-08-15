import { drizzle } from "drizzle-orm/node-postgres";
import { AsyncLocalStorage } from "node:async_hooks";
import { Client, Pool } from "pg";
import { env } from "../config.js";
import * as schema from "./schema.js";

const createDatabase = (client: Client | Pool) => drizzle(client, { schema });
type AppDatabase = ReturnType<typeof createDatabase>;

let localPool: Pool | undefined;
let localDatabase: AppDatabase | undefined;
export const getPool = () => {
  localPool ??= new Pool({
    connectionString: env.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  return localPool;
};
const getLocalDatabase = () => {
  localDatabase ??= createDatabase(getPool());
  return localDatabase;
};
const requestDatabase = new AsyncLocalStorage<AppDatabase>();

export const db = new Proxy({} as AppDatabase, {
  get(_target, property) {
    const current = requestDatabase.getStore() ?? getLocalDatabase();
    const value = Reflect.get(current, property, current) as unknown;
    return typeof value === "function" ? value.bind(current) : value;
  },
});

export const withRequestDatabase = async <T>(connectionString: string, task: () => Promise<T>) => {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await requestDatabase.run(createDatabase(client), task);
  } finally {
    await client.end();
  }
};
