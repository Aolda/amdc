import { type Router, Router as createRouter } from "express";

export const healthRouter: Router = createRouter();

healthRouter.get("/", (_req, res) => {
  res.json({
    status: "ok",
    service: "amdc-server",
    timestamp: new Date().toISOString(),
  });
});
