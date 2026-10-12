// 대화 내보내기 파일 파서. 파일 내용을 보고 형식을 알아낸다. 모두 시간순 [{ name, text, ts? }]를 돌려준다.
//   카카오톡: txt(PC·안드로이드·iOS), csv(Date,User,Message)
//   인스타그램: "내 정보 다운로드"의 message_N.html(기본) / message_N.json
//   디스코드: DiscordChatExporter JSON/CSV, 공식 데이터 패키지 messages.json/csv(내가 보낸 메시지만 있음)
//   인스타·디스코드 패키지는 zip째로 열 수 있다(readZip: 안의 대화방 목록 → 골라서 불러오기)
const path = require('node:path');

// ---------- 카카오톡 txt ----------
const PC = /^\[(.+?)\] \[(?:오전|오후) \d{1,2}:\d{2}\] (.*)$/;
const MOBILE = /^\d{4}(?:년 \d{1,2}월 \d{1,2}일|\. \d{1,2}\. \d{1,2}\.) (?:오전|오후) \d{1,2}:\d{2}, (.+?) : (.*)$/;
const SKIP = /^-{5,} .* -{5,}$|^\d{4}(?:년 \d{1,2}월 \d{1,2}일|\. \d{1,2}\. \d{1,2}\.)( (?:오전|오후) \d{1,2}:\d{2})?(,.*)?$|^저장한 날짜|카카오톡 대화$/;

// 매칭 안 되는 줄은 앞 메시지의 줄바꿈 이어쓰기로 본다.
function parseKakao(text) {
  const msgs = [];
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const m = line.match(PC) || line.match(MOBILE);
    if (m) msgs.push({ name: m[1], text: m[2] });
    else if (line.trim() && !SKIP.test(line.trim()) && msgs.length) msgs[msgs.length - 1].text += '\n' + line;
  }
  return msgs;
}

// ---------- CSV (RFC 4180: 따옴표 안의 쉼표·줄바꿈·"" 처리) ----------
function parseCsv(text) {
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c !== '"') f += c;
      else if (text[i + 1] === '"') { f += '"'; i++; }
      else q = false;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else if (c !== '\r') f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}

function fromCsv(text) {
  const [head = [], ...rows] = parseCsv(text);
  const col = name => head.findIndex(h => h.trim().toLowerCase() === name);
  const ts = s => Date.parse(s) || undefined;
  if (col('author') >= 0 && col('content') >= 0) { // DiscordChatExporter
    const [a, d, c] = [col('author'), col('date'), col('content')];
    return { platform: 'discord', msgs: rows.filter(r => r[c]).map(r => ({ name: r[a].replace(/#0$/, ''), text: r[c], ts: ts(r[d]) })) };
  }
  if (col('contents') >= 0 && col('timestamp') >= 0) { // 디스코드 공식 데이터 패키지(옛 형식)
    const [d, c] = [col('timestamp'), col('contents')];
    return { platform: 'discord', msgs: rows.filter(r => r[c]).map(r => ({ name: '나', text: r[c], ts: ts(r[d]) })).sort((x, y) => x.ts - y.ts) };
  }
  if (col('user') >= 0 && col('message') >= 0) { // 카카오톡 CSV
    const [d, u, c] = [col('date'), col('user'), col('message')];
    return { platform: 'kakao', msgs: rows.filter(r => r[u] && r[c]).map(r => ({ name: r[u], text: r[c], ts: ts(r[d]) })) };
  }
  throw new Error('알 수 없는 CSV 형식이에요.');
}

// ---------- 인스타그램 ----------
// 인스타 JSON은 UTF-8 바이트를 한 글자씩(ì\u0095...) 적어 둬서 한글이 깨져 보인다. 바이트로 되돌려 다시 읽는다.
const fixIg = s => (/^[\u0000-ÿ]*$/.test(s) ? Buffer.from(s, 'latin1').toString('utf8') : s);
const IG_NOISE = /^(Liked a message|Reacted .* to your message|.* sent an attachment\.|.*메시지에 공감했습니다\.?|.*첨부 파일을 보냈습니다\.?)$/;

function fromInstagram(j) {
  return {
    platform: 'instagram',
    msgs: j.messages
      .filter(m => typeof m.content === 'string' && m.sender_name)
      .map(m => ({ name: fixIg(m.sender_name), text: fixIg(m.content), ts: m.timestamp_ms }))
      .filter(m => !IG_NOISE.test(m.text))
      .sort((a, b) => a.ts - b.ts), // 파일 안은 최신순
  };
}

// ---------- 디스코드 ----------
function fromDiscordExporter(j) {
  return {
    platform: 'discord',
    msgs: j.messages
      .filter(m => m.content && m.author)
      .map(m => ({ name: m.author.nickname || m.author.name, text: m.content, ts: Date.parse(m.timestamp) || undefined })),
  };
}

function fromDiscordPackage(arr) {
  return {
    platform: 'discord',
    msgs: arr.filter(m => m.Contents).map(m => ({ name: '나', text: m.Contents, ts: Date.parse(m.Timestamp) || undefined })).sort((a, b) => a.ts - b.ts),
  };
}

// 파일 하나 → { platform, msgs }
function parseFile(fileName, raw) {
  const text = raw.replace(/^﻿/, '');
  const ext = path.extname(fileName).toLowerCase();
  if (ext === '.json') {
    let j;
    try { j = JSON.parse(text); } catch { throw new Error(`${fileName}: JSON을 읽지 못했어요.`); }
    if (Array.isArray(j?.messages) && j.messages.some(m => 'sender_name' in m)) return fromInstagram(j);
    if (Array.isArray(j?.messages) && j.messages.some(m => m?.author)) return fromDiscordExporter(j);
    if (Array.isArray(j) && j.some(m => m && 'Contents' in m)) return fromDiscordPackage(j);
    throw new Error(`${fileName}: 지원하지 않는 JSON 형식이에요. 내보내기 가이드를 확인해 주세요.`);
  }
  if (ext === '.csv') return fromCsv(text);
  if (ext === '.html') {
    const r = parseInstagramHtml(text);
    if (!r.msgs.length) throw new Error(`${fileName}: 인스타그램 메시지 HTML이 아니에요.`);
    return { platform: 'instagram', msgs: r.msgs };
  }
  return { platform: 'kakao', msgs: parseKakao(text) };
}

// ---------- 인스타그램 HTML (기본 내보내기 형식) ----------
// 메시지 블록: <h2 class="… _2pim …">보낸 사람</h2> 본문 <div class="… _a6-o …">날짜</div>. 파일 안은 최신순.
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = s => s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e] ?? m));

function igDate(s) {
  const m = s.match(/(\d{1,2})월 (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}) (오전|오후)/);
  if (m) return new Date(+m[3], m[1] - 1, +m[2], (+m[4] % 12) + (m[6] === '오후' ? 12 : 0), +m[5]).getTime();
  return Date.parse(s) || undefined; // 영어판 "Oct 09, 2026 5:47 am"
}

function parseInstagramHtml(html) {
  const title = decode((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '').trim();
  const msgs = [];
  // 본문이 다음 <h2>를 넘지 못하게 한다: 날짜 없는 알림 블록("그룹 초대 링크: 설정", "그룹 사진")이 다음 메시지를 삼키지 않게
  for (const [, who, body, date] of html.matchAll(/<h2 class="[^"]*_2pim[^"]*">([^<]*)<\/h2>((?:(?!<h2)[\s\S])*?)<div class="[^"]*_a6-o[^"]*">([^<]*)<\/div>/g)) {
    // 본문의 첫 "잎" div(안에 div가 없는 것) 중 글자가 있는 것이 메시지. 공유·첨부는 안내 문구가 먼저 나와 아래에서 걸러진다
    const leaf = [...body.matchAll(/<div>((?:(?!<\/?div)[\s\S])*)<\/div>/g)].map(m => decode(m[1]).trim()).find(Boolean);
    if (leaf && !IG_NOISE.test(leaf)) msgs.push({ name: decode(who).trim(), text: leaf, ts: igDate(date) });
  }
  return { title, msgs: msgs.every(m => m.ts) ? msgs.sort((a, b) => a.ts - b.ts) : msgs.reverse() };
}

// ---------- zip 통째로 열기: 안의 대화방 목록을 만들어 고르게 한다 ----------
const IG_FILE = /(?:^|\/)messages\/inbox\/([^/]+)\/message_(\d+)\.(html|json)$/;
const DC_FILE = /(?:^|\/)(?:메시지|messages)\/c?(\d+)\/(messages\.(?:json|csv)|channel\.json)$/;
const DC_INDEX = /(?:^|\/)(?:메시지|messages)\/index\.json$/;
const DC_USER = /(?:^|\/)(?:계정|account)\/user\.json$/;

// 반환: { platform, conversations: [{ key, title, count, people }], pick(keys) → msgs }
function readZip(buf) {
  const { unzipSync, strFromU8 } = require('fflate');
  const files = unzipSync(buf, { filter: f => IG_FILE.test(f.name) || DC_FILE.test(f.name) || DC_INDEX.test(f.name) || DC_USER.test(f.name) });
  const text = name => strFromU8(files[name]);
  const convs = new Map(); // key → { title, msgs }
  const conv = key => convs.get(key) ?? convs.set(key, { title: key, msgs: [] }).get(key);
  let platform = null;

  const names = Object.keys(files).sort(); // message_1, message_2 … 순서 고정
  for (const name of names) {
    const ig = name.match(IG_FILE);
    if (!ig) continue;
    platform = 'instagram';
    const c = conv(ig[1]);
    const r = ig[3] === 'html' ? parseInstagramHtml(text(name)) : (j => ({ title: fixIg(j.title || ''), msgs: fromInstagram(j).msgs }))(JSON.parse(text(name)));
    if (r.title) c.title = r.title;
    c.msgs.push(...r.msgs);
  }

  const dcNames = names.filter(n => DC_FILE.test(n));
  if (dcNames.length) {
    platform = 'discord';
    const index = (n => (n ? JSON.parse(text(n)) : {}))(names.find(n => DC_INDEX.test(n)));
    const user = (n => (n ? JSON.parse(text(n)) : {}))(names.find(n => DC_USER.test(n)));
    const me = user.global_name || user.username || '나'; // 데이터 패키지에는 내 메시지만 있다
    for (const name of dcNames) {
      const [, id, file] = name.match(DC_FILE);
      const c = conv(id);
      if (file === 'channel.json') {
        const ch = JSON.parse(text(name));
        c.title = index[id] || [ch.guild?.name, ch.name].filter(Boolean).join(' · ') || id;
      } else {
        const raw = file.endsWith('.json') ? fromDiscordPackage(JSON.parse(text(name))) : fromCsv(text(name));
        c.msgs.push(...raw.msgs.map(m => ({ ...m, name: me })));
      }
      if (index[id]) c.title = index[id];
    }
  }

  for (const c of convs.values()) if (c.msgs.every(m => m.ts)) c.msgs.sort((a, b) => a.ts - b.ts);
  const list = [...convs.entries()].filter(([, c]) => c.msgs.length)
    .map(([key, c]) => ({ key, title: c.title, count: c.msgs.length, people: participants(c.msgs).slice(0, 6).map(p => p.name) }))
    .sort((a, b) => b.count - a.count);
  return {
    platform,
    conversations: list,
    pick: keys => {
      const msgs = keys.flatMap(k => convs.get(k)?.msgs ?? []);
      return msgs.every(m => m.ts) ? msgs.sort((a, b) => a.ts - b.ts) : msgs;
    },
  };
}

// 여러 파일(인스타 message_1·2.json 등)을 합친다. 모든 메시지에 시각이 있으면 시간순으로 정렬.
function parseFiles(files) {
  const parsed = files.map(f => parseFile(f.name, f.text));
  const msgs = parsed.flatMap(p => p.msgs);
  if (msgs.length && msgs.every(m => m.ts)) msgs.sort((a, b) => a.ts - b.ts);
  return { platforms: [...new Set(parsed.map(p => p.platform))], msgs };
}

function participants(msgs) {
  const by = new Map();
  for (const m of msgs) {
    const p = by.get(m.name) ?? by.set(m.name, { name: m.name, count: 0, sample: '' }).get(m.name);
    p.count++;
    if (m.text.trim()) p.sample = m.text.replace(/\s+/g, ' ').slice(0, 60); // 마지막 메시지: 누군지 알아보기용
  }
  return [...by.values()].sort((a, b) => b.count - a.count);
}

// 분석용 기록: name의 메시지와 그 직전 메시지(맥락)만, 최근 것부터 maxChars까지.
// ponytail: 한 번의 LLM 호출에 넣는 상한. 이보다 긴 대화는 오래된 부분이 빠진다. 다 넣으려면 청크로 나눠 여러 번 추출 후 병합.
function analysisLog(msgs, name, maxChars = 200_000) {
  const keep = new Set();
  msgs.forEach((m, i) => { if (m.name === name) { keep.add(i); if (i) keep.add(i - 1); } });
  const out = [];
  let size = 0;
  for (const i of [...keep].sort((a, b) => b - a)) {
    const l = `${msgs[i].name}: ${msgs[i].text}`;
    if (size + l.length > maxChars) break;
    out.push(l); size += l.length + 1;
  }
  return out.reverse().join('\n');
}

// 말투 예시: name의 메시지와 직전 상대 메시지 쌍. 최근 max개.
function examples(msgs, name, max = 5000) {
  const out = [];
  msgs.forEach((m, i) => {
    if (m.name === name && m.text.trim() && !/^(사진|동영상|이모티콘|삭제된 메시지입니다\.?)$/.test(m.text.trim()))
      out.push({ c: i && msgs[i - 1].name !== name ? msgs[i - 1].text.slice(0, 200) : '', t: m.text.slice(0, 500) });
  });
  return out.slice(-max);
}

module.exports = { parseKakao, parseCsv, parseFile, parseFiles, parseInstagramHtml, readZip, participants, analysisLog, examples };
