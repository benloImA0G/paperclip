// Fake Hermes gateway for local end-to-end testing.
// Start: node scripts/hermes-fake-gateway.mjs --port 18642 --key <secret>
// Alternatively set API_SERVER_KEY and omit --key.
// Set the adapter's apiBaseUrl to http://127.0.0.1:18642/api.
// Set the adapter's apiKey to the same secret.
// Stop the gateway with Ctrl+C; runs exist only in memory.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
let port = 18642;
let key = process.env.API_SERVER_KEY;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1] !== undefined) port = Number(args[++i]);
  else if (args[i] === '--key' && args[i + 1] !== undefined) key = args[++i];
  else throw new Error('Usage: node scripts/hermes-fake-gateway.mjs [--port PORT] [--key KEY]');
}
if (!key || !Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('A nonempty key and a valid port are required');
}

const runs = new Map();
const json = (res, status, data) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
};
createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const match = path.match(/^\/api\/v1\/runs\/([^/]+)(?:\/(events|stop))?$/);
  const route = path === '/api/health' ? '/api/health' : path === '/api/v1/runs' ? '/api/v1/runs' : match ? `/api/v1/runs/:id${match[2] ? `/${match[2]}` : ''}` : 'unknown';
  console.log(`${req.method} ${route}`);
  if (req.headers.authorization !== `Bearer ${key}`) return json(res, 401, { error: 'Unauthorized' });
  if (req.method === 'GET' && path === '/api/health') return json(res, 200, { ok: true });
  if (req.method === 'POST' && path === '/api/v1/runs') {
    let body;
    try {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      body = JSON.parse(raw);
      if (typeof body?.input !== 'string') throw new Error('input required');
    } catch {
      return json(res, 400, { error: 'Expected JSON with string input' });
    }
    const id = randomUUID();
    const output = `[fake-hermes] Reply to prompt: ${JSON.stringify(body.input.slice(0, 80))}`;
    runs.set(id, { run_id: id, status: 'completed', output });
    return json(res, 200, { run_id: id, status: 'started' });
  }
  const run = match && runs.get(match[1]);
  if (!run) return json(res, 404, { error: 'Not found' });
  if (req.method === 'GET' && !match[2]) return json(res, 200, run);
  if (req.method === 'GET' && match[2] === 'events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.end(`event: message.delta\ndata: ${JSON.stringify({ delta: run.output })}\n\nevent: run.completed\ndata: ${JSON.stringify({ status: run.status, output: run.output })}\n\n`);
    return;
  }
  if (req.method === 'POST' && match[2] === 'stop') return json(res, 200, run);
  return json(res, 404, { error: 'Not found' });
}).listen(port, '127.0.0.1', function () {
  console.log(`Fake Hermes gateway listening on 127.0.0.1:${this.address().port}`);
});
