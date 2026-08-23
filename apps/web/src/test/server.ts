import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";

// Commercial project management loads clients alongside projects for admins.
// Keep a harmless default so focused page tests only need to override it when
// their assertion depends on client data.
export const server = setupServer(
  http.get("/api/workspaces/:workspaceId/clients", () => HttpResponse.json({ clients: [] })),
);
