import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
loadEnv({ path: resolve(projectRoot, ".env") });

const developmentSecret = "local-development-secret-change-me-1234567890";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url().default("postgresql://postgres:postgres@localhost:5432/timesheet"),
  JWT_ACCESS_SECRET: z.string().min(32).default(developmentSecret),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
});

const parsedEnvironment = environmentSchema.parse(process.env);

if (parsedEnvironment.NODE_ENV === "production" && parsedEnvironment.JWT_ACCESS_SECRET === developmentSecret) {
  throw new Error("JWT_ACCESS_SECRET must be configured in production");
}

export const env = {
  nodeEnv: parsedEnvironment.NODE_ENV,
  port: parsedEnvironment.API_PORT,
  databaseUrl: parsedEnvironment.DATABASE_URL,
  jwtAccessSecret: parsedEnvironment.JWT_ACCESS_SECRET,
  webOrigin: parsedEnvironment.WEB_ORIGIN,
};
