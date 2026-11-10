import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./hermes-fake-gateway.mjs', import.meta.url));

test('fake gateway authenticates and completes a streamed run', async (t) => {
  const key = 'test-gateway-key';
  const child = spawn(process.execPath, [script, '--port', '0', '--key', key], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill();
      await once(child, 'exit');
    }
  });
  let logs = '';
  child.stdout.on('data', (chunk) => { logs += chunk; });
  const port = await new Promise((resolve, reject) => {
    child.stdout.on('data', () => {
      const match = logs.match(/listening on 127\.0\.0\.1:(\d+)/);
      if (match) resolve(match[1]);
    });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`gateway exited: ${code}`)));
  });
  const base = `http://127.0.0.1:${port}/api`;
  const headers = { authorization: `Bearer ${key}` };
  assert.deepEqual(await (await fetch(`${base}/health`, { headers })).json(), { ok: true });
  assert.equal((await fetch(`${base}/health`)).status, 401);
  assert.equal((await fetch(`${base}/health`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  const prompt = 'Example prompt '.repeat(10);
  const created = await (await fetch(`${base}/v1/runs`, {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ input: prompt }),
  })).json();
  assert.equal(created.status, 'started');
  assert.ok(created.run_id);
  const status = await (await fetch(`${base}/v1/runs/${created.run_id}`, { headers })).json();
  assert.equal(status.status, 'completed');
  assert.equal(status.output, `[fake-hermes] Reply to prompt: ${JSON.stringify(prompt.slice(0, 80))}`);
  const stream = await fetch(`${base}/v1/runs/${created.run_id}/events`, { headers });
  assert.match(stream.headers.get('content-type'), /^text\/event-stream/);
  assert.equal(await stream.text(), `event: message.delta\ndata: ${JSON.stringify({ delta: status.output })}\n\nevent: run.completed\ndata: ${JSON.stringify({ status: 'completed', output: status.output })}\n\n`);
  assert.ok(!logs.includes(key));
});
