import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type RequestHandler } from "express";
import { authRouter } from "./auth/routes.js";
import { env } from "./config.js";
import { errorHandler, notFoundHandler } from "./errors.js";
import { timesheetRouter } from "./timesheets/routes.js";
import { workspaceRouter } from "./workspaces/routes.js";
import { workflowRouter } from "./workflow/routes.js";
import { withRequestDatabase } from "./db/client.js";

type AppOptions = { databaseConnectionString?: string | (() => string) };

const requestDatabaseMiddleware = (connectionString: string | (() => string)): RequestHandler => (_request, response, next) => {
  const resolvedConnectionString = typeof connectionString === "function" ? connectionString() : connectionString;
  void withRequestDatabase(resolvedConnectionString, async () => {
    await new Promise<void>((resolve, reject) => {
      const complete = () => { cleanup(); resolve(); };
      const fail = (error: unknown) => { cleanup(); reject(error); };
      const cleanup = () => { response.off("finish", complete); response.off("close", complete); };
      response.once("finish", complete);
      response.once("close", complete);
      try { next(); } catch (error) { fail(error); }
    });
  }).catch(next);
};

export const createApp = (options: AppOptions = {}) => {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: env.webOrigin, credentials: true }));
  app.use(express.json({ limit: "16kb" }));
  app.use(cookieParser());
  if (options.databaseConnectionString) app.use(requestDatabaseMiddleware(options.databaseConnectionString));

  app.get("/", (_request, response) => {
    response.send("Hello from the backend");
  });

  app.get("/api/hello", (_request, response) => {
    response.json({ message: "Hello from the backend" });
  });

  app.use("/api/auth", authRouter);
  app.use("/api/workspaces", workspaceRouter);
  app.use("/api", timesheetRouter);
  app.use("/api", workflowRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};

export const app = createApp();
