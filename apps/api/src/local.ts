Object.assign(process.env, {
  NODE_ENV: "development",
  API_PORT: "3001",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/timesheet",
  WEB_ORIGIN: "http://localhost:5173",
  EMAIL_PROVIDER: "disabled",
});

await import("./index.js");
