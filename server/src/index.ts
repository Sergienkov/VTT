import { app } from './app';

const port = Number(Bun.env.PORT ?? 8787);

Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`Task Manager API listening on http://localhost:${port}`);
