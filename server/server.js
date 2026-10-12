// Persona Chat 공유 서버: 페르소나 파일을 올리면 8자리 코드를 주고, 코드로 내려받게 한다.
// 서버의 Node가 v10이라 ?. ?? matchAll 같은 최신 문법을 쓰지 않는다. 표준 라이브러리만 쓴다.
//
// POST   /v1/personas          본문: .persona.json  → { code, deleteToken, expiresAt }
// GET    /v1/personas/:code                         → .persona.json
// DELETE /v1/personas/:code    헤더 x-delete-token  → 204
// GET    /health
//
// 환경변수: PORT(8788) DATA_DIR(./data) TLS_KEY TLS_CERT(없으면 http)
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const PORT = Number(process.env.PORT) || 8788;
const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MAX_BYTES = 20 * 1024 * 1024;
const TTL_MS = 30 * 24 * 3600 * 1000;
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // 헷갈리는 0 O 1 I L 제외
const CODE = /^[2-9A-HJKMNP-Z]{8}$/;

fs.mkdirSync(DIR, { recursive: true });

function newCode() {
  // 거부 샘플링으로 치우침 없이 뽑는다
  let s = '';
  while (s.length < 8) {
    const b = crypto.randomBytes(16);
    for (let i = 0; i < b.length && s.length < 8; i++) if (b[i] < 248) s += ALPHABET[b[i] % 31];
  }
  return s;
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const file = code => path.join(DIR, code + '.json');

// IP별 시간당 횟수 제한. 업로드 남용과 코드 무차별 대입을 막는다(코드 공간 31^8 ≈ 8.5e11).
// ponytail: 메모리 맵이라 재시작하면 초기화된다. 서버 여러 대가 되면 공유 저장소로.
const LIMITS = { upload: 30, download: 300 };
const hits = new Map();
function limited(ip, kind) {
  const k = kind + ' ' + ip, now = Date.now();
  let h = hits.get(k);
  if (!h || h.reset < now) { h = { n: 0, reset: now + 3600 * 1000 }; hits.set(k, h); }
  return ++h.n > LIMITS[kind];
}

function send(res, status, body, headers) {
  const data = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({ 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(data) }, headers || {}));
  res.end(data);
}

function readBody(req, cb) {
  const chunks = [];
  let size = 0, done = false;
  req.on('data', c => {
    size += c.length;
    if (size > MAX_BYTES && !done) { done = true; cb(new Error('too_large')); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => { if (!done) { done = true; cb(null, Buffer.concat(chunks)); } });
  req.on('error', e => { if (!done) { done = true; cb(e); } });
}

function load(code) {
  try {
    const rec = JSON.parse(fs.readFileSync(file(code), 'utf8'));
    if (rec.expiresAt < Date.now()) { fs.unlinkSync(file(code)); return null; }
    return rec;
  } catch (e) { return null; }
}

function handler(req, res) {
  const ip = req.socket.remoteAddress || '';
  const url = req.url.split('?')[0];
  const m = url.match(/^\/v1\/personas\/([^/]+)$/);
  const code = m ? decodeURIComponent(m[1]).toUpperCase().replace(/[\s-]/g, '') : null;

  if (req.method === 'GET' && url === '/health') return send(res, 200, { ok: true });

  if (req.method === 'POST' && url === '/v1/personas') {
    if (limited(ip, 'upload')) return send(res, 429, { error: 'rate_limited' });
    return readBody(req, (err, buf) => {
      if (err) return send(res, err.message === 'too_large' ? 413 : 400, { error: err.message });
      let payload;
      try { payload = JSON.parse(buf.toString('utf8')); } catch (e) { return send(res, 400, { error: 'bad_json' }); }
      if (!payload || payload.format !== 'persona-chat/persona' || !payload.persona) return send(res, 400, { error: 'not_persona' });
      let c = newCode();
      while (fs.existsSync(file(c))) c = newCode();
      const deleteToken = crypto.randomBytes(18).toString('base64').replace(/[+/=]/g, '');
      const rec = { createdAt: Date.now(), expiresAt: Date.now() + TTL_MS, deleteHash: sha(deleteToken), payload: payload };
      fs.writeFileSync(file(c) + '.tmp', JSON.stringify(rec));
      fs.renameSync(file(c) + '.tmp', file(c));
      console.log(new Date().toISOString(), 'upload', c, buf.length, 'bytes');
      send(res, 201, { code: c, deleteToken: deleteToken, expiresAt: rec.expiresAt });
    });
  }

  if (code !== null && (req.method === 'GET' || req.method === 'DELETE')) {
    if (limited(ip, 'download')) return send(res, 429, { error: 'rate_limited' });
    if (!CODE.test(code)) return send(res, 404, { error: 'not_found' });
    const rec = load(code);
    if (!rec) return send(res, 404, { error: 'not_found' });
    if (req.method === 'GET') return send(res, 200, rec.payload);
    const token = String(req.headers['x-delete-token'] || '');
    if (!token || sha(token) !== rec.deleteHash) return send(res, 403, { error: 'forbidden' });
    fs.unlinkSync(file(code));
    console.log(new Date().toISOString(), 'delete', code);
    return send(res, 204);
  }

  send(res, 404, { error: 'not_found' });
}

// 만료된 파일 정리(시작 시 + 1시간마다)
function sweep() {
  for (const f of fs.readdirSync(DIR)) if (/^[2-9A-Z]{8}\.json$/.test(f)) load(f.slice(0, 8));
}
sweep();
setInterval(sweep, 3600 * 1000).unref();
setInterval(() => { const now = Date.now(); hits.forEach((h, k) => { if (h.reset < now) hits.delete(k); }); }, 600 * 1000).unref();

const server = process.env.TLS_KEY
  ? https.createServer({ key: fs.readFileSync(process.env.TLS_KEY), cert: fs.readFileSync(process.env.TLS_CERT) }, handler)
  : http.createServer(handler);
server.listen(PORT, () => console.log('persona-share listening on', PORT, process.env.TLS_KEY ? '(https)' : '(http)'));
