// 공유 서버(server/server.js) 클라이언트. 서버에 도메인이 없어 자체 서명 인증서를 쓰고,
// 그 인증서를 앱에 넣어(share-server.pem) 이 서버만 믿는다(인증서 고정). 대화 원문이 오가므로 http로 내리지 않는다.
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

let server = { host: '193.233.198.126', port: 8788, ca: fs.readFileSync(path.join(__dirname, 'share-server.pem')) };
const configure = s => { server = { ...server, ...s }; }; // 테스트용

const ERR = {
  not_found: '코드에 해당하는 페르소나가 없어요. 코드가 맞는지, 만료(30일)되거나 삭제되지 않았는지 확인해 주세요.',
  rate_limited: '요청이 너무 많아요. 잠시 후 다시 시도해 주세요.',
  too_large: '페르소나가 너무 커서 올릴 수 없어요(20MB 초과). 실제 메시지 예시를 빼고 올려 보세요.',
  forbidden: '이 코드를 지울 권한이 없어요.',
};

function request(method, p, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = https.request({
      host: server.host, port: server.port, path: p, method, ca: server.ca, timeout: 60_000,
      headers: { ...headers, ...(data && { 'content-type': 'application/json', 'content-length': data.length }) },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch {}
        if (res.statusCode >= 400) reject(new Error(ERR[json?.error] ?? `공유 서버 오류 (${res.statusCode})`));
        else resolve(json);
      });
    });
    req.on('timeout', () => req.destroy(new Error('공유 서버 응답이 없어요.')));
    req.on('error', e => reject(/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH|응답이 없어요/.test(e.code || e.message)
      ? new Error('공유 서버에 연결할 수 없어요. 인터넷 연결을 확인하거나 잠시 후 다시 시도해 주세요.') : e));
    req.end(data);
  });
}

const normalize = code => String(code).toUpperCase().replace(/[^0-9A-Z]/g, '');

module.exports = {
  configure,
  normalize,
  upload: share => request('POST', '/v1/personas', { body: share }),
  download: code => request('GET', `/v1/personas/${normalize(code)}`),
  remove: (code, deleteToken) => request('DELETE', `/v1/personas/${normalize(code)}`, { headers: { 'x-delete-token': deleteToken } }),
};
