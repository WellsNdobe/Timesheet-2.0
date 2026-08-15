import { config as loadEnv } from "dotenv";
import { z } from "zod";

if (process.env.NODE_ENV !== "production") loadEnv();

const developmentSecret = "local-development-secret-change-me-1234567890";
const optionalEmail = z.preprocess((value) => value === "" ? undefined : value, z.string().email().optional());

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().url().default("postgresql://postgres:postgres@localhost:5432/timesheet"),
  JWT_ACCESS_SECRET: z.string().min(32).default(developmentSecret),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  EMAIL_PROVIDER: z.enum(["disabled", "cloudflare"]).default("disabled"),
  EMAIL_FROM_ADDRESS: optionalEmail,
  EMAIL_FROM_NAME: z.string().trim().min(1).max(100).default("TempoLedger"),
  EMAIL_REPLY_TO: optionalEmail,
});

const parsedEnvironment = environmentSchema.parse(process.env);

if (parsedEnvironment.NODE_ENV === "production" && parsedEnvironment.JWT_ACCESS_SECRET === developmentSecret) {
  throw new Error("JWT_ACCESS_SECRET must be configured in production");
}

if (parsedEnvironment.EMAIL_PROVIDER === "cloudflare" && !parsedEnvironment.EMAIL_FROM_ADDRESS) {
  throw new Error("EMAIL_FROM_ADDRESS is required when EMAIL_PROVIDER=cloudflare");
}

export const env = {
  nodeEnv: parsedEnvironment.NODE_ENV,
  port: parsedEnvironment.API_PORT,
  databaseUrl: parsedEnvironment.DATABASE_URL,
  jwtAccessSecret: parsedEnvironment.JWT_ACCESS_SECRET,
  webOrigin: parsedEnvironment.WEB_ORIGIN,
  email: {
    provider: parsedEnvironment.EMAIL_PROVIDER,
    fromAddress: parsedEnvironment.EMAIL_FROM_ADDRESS,
    fromName: parsedEnvironment.EMAIL_FROM_NAME,
    replyTo: parsedEnvironment.EMAIL_REPLY_TO,
  },
};
