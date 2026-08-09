import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { authRouter } from "./auth/routes.js";
import { env } from "./config.js";
import { errorHandler, notFoundHandler } from "./errors.js";

export const app = express();

app.disable("x-powered-by");
app.use(cors({ origin: env.webOrigin, credentials: true }));
app.use(express.json({ limit: "16kb" }));
app.use(cookieParser());

app.get("/", (_request, response) => {
  response.send("Hello from the backend");
});

app.get("/api/hello", (_request, response) => {
  response.json({ message: "Hello from the backend" });
});

app.use("/api/auth", authRouter);
app.use(notFoundHandler);
app.use(errorHandler);
