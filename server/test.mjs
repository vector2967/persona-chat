// node server/test.mjs — 공유 서버를 임시 폴더·http로 띄워 올리기/받기/지우기/검증을 확인한다
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'persona-share-'));
const port = 18788;
const srv = spawn(process.execPath, [new URL('./server.js', import.meta.url).pathname.replace(/^\/(\w:)/, '$1')], { env: { ...process.env, PORT: port, DATA_DIR: dir }, stdio: 'pipe' });
await new Promise(r => srv.stdout.once('data', r));
const base = `http://127.0.0.1:${port}`;
try {
  const share = { format: 'persona-chat/persona', version: 1, persona: { name: '민지', nodes: {}, edges: [], examples: [] } };
  const up = await fetch(`${base}/v1/personas`, { method: 'POST', body: JSON.stringify(share) });
  assert.equal(up.status, 201);
  const { code, deleteToken, expiresAt } = await up.json();
  assert.match(code, /^[2-9A-HJKMNP-Z]{8}$/);
  assert.ok(expiresAt > Date.now() + 29 * 86400e3);

  const pretty = `${code.slice(0, 4).toLowerCase()}-${code.slice(4)}`; // 소문자·하이픈 입력도 받는다
  assert.deepEqual(await (await fetch(`${base}/v1/personas/${pretty}`)).json(), share);

  assert.equal((await fetch(`${base}/v1/personas`, { method: 'POST', body: '{"format":"x"}' })).status, 400);
  assert.equal((await fetch(`${base}/v1/personas`, { method: 'POST', body: 'nope' })).status, 400);
  assert.equal((await fetch(`${base}/v1/personas/AAAAAAAA`)).status, 404);
  assert.equal((await fetch(`${base}/v1/personas/../../etc`)).status, 404);

  assert.equal((await fetch(`${base}/v1/personas/${code}`, { method: 'DELETE', headers: { 'x-delete-token': 'wrong' } })).status, 403);
  assert.equal((await fetch(`${base}/v1/personas/${code}`, { method: 'DELETE', headers: { 'x-delete-token': deleteToken } })).status, 204);
  assert.equal((await fetch(`${base}/v1/personas/${code}`)).status, 404);

  const big = await fetch(`${base}/v1/personas`, { method: 'POST', body: 'x'.repeat(21 * 1024 * 1024) }).catch(e => e);
  assert.ok(big instanceof Error || big.status === 413, '20MB 초과는 거절');
  console.log('ok (server)');
} finally {
  srv.kill();
  rmSync(dir, { recursive: true, force: true });
}
