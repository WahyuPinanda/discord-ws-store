import http from 'node:http';

export function startHealthServer(client) {
  const port = Number(process.env.PORT || 8080);

  const server = http.createServer((request, response) => {
    if (request.url === '/healthz') {
      const ready = client?.isReady?.() || false;
      response.writeHead(ready ? 200 : 503, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        ok: ready,
        service: 'ws-store-official-bot',
        uptime: process.uptime()
      }));
      return;
    }

    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('WS Store Official bot is running.\n');
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Health server listening on port ${port}.`);
  });

  return server;
}
