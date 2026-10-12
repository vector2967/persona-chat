const { app, BrowserWindow, ipcMain, safeStorage, dialog, shell, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const parsers = require('./parsers');
const graph = require('./graph');
const llm = require('./llm');
const cloud = require('./cloud');

// 테스트는 반드시 PERSONA_CHAT_DATA로 다른 폴더를 써야 한다(사용자가 같은 PC에서 실제로 쓰는 데이터와 섞이지 않게)
if (process.env.PERSONA_CHAT_DATA) app.setPath('userData', path.resolve(process.env.PERSONA_CHAT_DATA));

// 저장 위치: %APPDATA%/Persona Chat/{settings.json, personas/<id>.json, chats/<id>.json}
const data = (...p) => path.join(app.getPath('userData'), ...p);
const readJSON = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
function writeJSON(f, v) { // 임시 파일에 쓰고 rename: 쓰다가 꺼져도 기존 파일이 깨지지 않는다
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.tmp', JSON.stringify(v));
  fs.renameSync(f + '.tmp', f);
}

// ---------- 설정 (API 키는 OS 자격 증명으로 암호화) ----------
const PROVIDERS = ['anthropic', 'openai', 'gemini', 'claude-cli', 'codex-cli'];
let settings;
function loadSettings() {
  settings = readJSON(data('settings.json'), { provider: 'anthropic', models: {}, keys: {} });
  settings.models = { ...llm.DEFAULT_MODELS, ...settings.models }; // 나중에 추가된 제공자의 기본 모델 채우기
}
const keyOf = p => (settings.keys[p] ? safeStorage.decryptString(Buffer.from(settings.keys[p], 'base64')) : '');
const current = () => ({ provider: settings.provider, model: settings.models[settings.provider], key: keyOf(settings.provider) });

// ---------- 페르소나 (시작 시 전부 메모리에 올려 두고, 그래프 색인은 graph.js가 캐시) ----------
const personas = new Map();
const isId = id => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id);
const personaFile = id => data('personas', `${id}.json`);
const chatFile = id => data('chats', `${id}.json`);
function loadPersonas() {
  fs.mkdirSync(data('personas'), { recursive: true });
  for (const f of fs.readdirSync(data('personas')).filter(f => f.endsWith('.json'))) {
    const p = readJSON(data('personas', f));
    if (p?.id) personas.set(p.id, p);
  }
}
const savePersona = p => { personas.set(p.id, p); writeJSON(personaFile(p.id), p); };
const getPersona = id => { const p = personas.get(id); if (!p) throw new Error('페르소나를 찾을 수 없어요.'); return p; };
const summaryOf = p => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, nodes: Object.keys(p.nodes).length, edges: p.edges.length, examples: p.examples.length });

let lastImport = null; // 마지막으로 연 대화 파일(들)의 파싱 결과

function createWindow() {
  const win = new BrowserWindow({
    width: 1120, height: 780, minWidth: 760, minHeight: 520,
    title: 'Persona Chat', autoHideMenuBar: true, icon: path.join(__dirname, '..', 'renderer', 'icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#191919' : '#ffffff',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

const handle = (ch, fn) => ipcMain.handle(ch, (e, ...a) => fn(e, ...a));

handle('settings:get', () => ({
  provider: settings.provider, models: settings.models, myName: settings.myName || '',
  hasKey: Object.fromEntries(PROVIDERS.map(p => [p, llm.isCli(p) || !!settings.keys[p]])), // CLI는 키 대신 로그인
}));

handle('settings:set', (e, { provider, models, keys, myName }) => {
  if (PROVIDERS.includes(provider)) settings.provider = provider;
  if (typeof myName === 'string') settings.myName = myName.trim().slice(0, 30); // 페르소나가 부를 내 이름
  for (const p of PROVIDERS) {
    if (typeof models?.[p] === 'string') settings.models[p] = models[p].trim();
    if (keys?.[p] === null) delete settings.keys[p];
    else if (typeof keys?.[p] === 'string' && keys[p].trim()) settings.keys[p] = safeStorage.encryptString(keys[p].trim()).toString('base64');
  }
  writeJSON(data('settings.json'), settings);
});

handle('models:list', (e, provider) => llm.listModels(provider, keyOf(provider)));
handle('cli:check', (e, provider) => llm.checkCli(provider));

// append: 고급 옵션 "다른 대화 더 추가". 앞서 연 대화 뒤에 이어 붙여 여러 플랫폼의 같은 사람을 한 페르소나로 묶을 수 있게
function imported(file, platforms, msgs, append = false) {
  if (!parsers.participants(msgs).length) throw new Error('메시지를 찾지 못했어요. 내보내기 가이드대로 받은 파일인지 확인해 주세요.');
  const combined = append && !!lastImport;
  if (combined) {
    file = `${lastImport.file} + ${file}`;
    platforms = [...new Set([...lastImport.platforms, ...platforms])];
    msgs = [...lastImport.msgs, ...msgs];
  }
  const people = parsers.participants(msgs);
  lastImport = { file, platforms, msgs };
  // 합친 대화는 플랫폼마다 내 이름("나", "me")이 따로 잡혀 사람 수로 단체 대화를 가릴 수 없다
  return { file, platforms, total: msgs.length, people, isGroup: !combined && people.length > 2 };
}

let lastZip = null; // zip을 열었을 때: 안의 대화방 목록과 고르기 함수

handle('import:open', async (e, append) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: '대화 내보내기 파일 (zip 또는 txt·json·csv·html, 여러 개 선택 가능)',
    filters: [{ name: '대화 파일', extensions: ['zip', 'txt', 'json', 'csv', 'html'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (r.canceled) return null;
  const zip = r.filePaths.find(f => f.toLowerCase().endsWith('.zip'));
  if (zip) {
    if (r.filePaths.length > 1) throw new Error('zip 파일은 하나만 따로 열어 주세요.');
    lastZip = { file: path.basename(zip), append: !!append, ...parsers.readZip(fs.readFileSync(zip)) };
    if (!lastZip.conversations.length) throw new Error('zip 안에서 대화를 찾지 못했어요. 인스타그램 "내 정보 다운로드"나 디스코드 데이터 패키지 zip인지 확인해 주세요.');
    return { zip: true, file: lastZip.file, platform: lastZip.platform, conversations: lastZip.conversations };
  }
  const { platforms, msgs } = parsers.parseFiles(r.filePaths.map(f => ({ name: path.basename(f), text: fs.readFileSync(f, 'utf8') })));
  return imported(r.filePaths.map(f => path.basename(f)).join(', '), platforms, msgs, !!append);
});

// zip 안에서 고른 대화방들을 합쳐 일반 파일을 연 것과 같은 결과로
handle('import:pick', (e, keys) => {
  if (!lastZip) throw new Error('먼저 zip 파일을 열어 주세요.');
  if (!Array.isArray(keys) || !keys.length) throw new Error('대화를 하나 이상 골라 주세요.');
  const titles = lastZip.conversations.filter(c => keys.includes(c.key)).map(c => c.title);
  return imported(`${lastZip.file} · ${titles.length > 2 ? `${titles.slice(0, 2).join(', ')} 외 ${titles.length - 2}개` : titles.join(', ')}`, [lastZip.platform], lastZip.pick(keys), lastZip.append);
});

// 공유 코드: 서버에 올리고 8자리 코드를 받는다. 지울 수 있게 deleteToken은 이 PC의 페르소나 파일에만 둔다(공유 파일에는 안 들어감)
const codesOf = p => (p.shareCodes ?? []).filter(c => c.expiresAt > Date.now());
const publicCodes = p => codesOf(p).map(({ code, expiresAt, withExamples }) => ({ code, expiresAt, withExamples }));

handle('persona:upload', async (e, { id, withExamples }) => {
  const p = getPersona(id);
  const r = await cloud.upload(graph.toShare(p, !!withExamples));
  p.shareCodes = [...codesOf(p), { code: r.code, deleteToken: r.deleteToken, expiresAt: r.expiresAt, withExamples: !!withExamples }];
  savePersona(p);
  return publicCodes(p);
});

handle('persona:unshare', async (e, { id, code }) => {
  const p = getPersona(id);
  const c = codesOf(p).find(c => c.code === code);
  if (!c) throw new Error('이 PC에서 만든 코드가 아니에요.');
  try { await cloud.remove(c.code, c.deleteToken); }
  catch (err) { if (!/해당하는 페르소나가 없어요/.test(err.message)) throw err; } // 이미 만료·삭제됐으면 목록에서만 뺀다
  p.shareCodes = codesOf(p).filter(x => x.code !== code);
  savePersona(p);
  return publicCodes(p);
});

handle('persona:download', async (e, code) => {
  if (cloud.normalize(code).length !== 8) throw new Error('코드는 8자리예요. 예: ABCD-2345');
  const p = graph.fromShare(await cloud.download(code));
  savePersona(p);
  return summaryOf(p);
});

// 공유: 페르소나를 .persona.json 파일로 내보내고, 남이 준 파일을 새 페르소나로 들인다
handle('persona:export', async (e, { id, withExamples }) => {
  const p = getPersona(id);
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
    title: '페르소나 공유 파일 저장', defaultPath: `${p.name.replace(/[\\/:*?"<>|]/g, '_')}.persona.json`,
    filters: [{ name: '페르소나 파일', extensions: ['json'] }],
  });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, JSON.stringify(graph.toShare(p, !!withExamples)));
  return r.filePath;
});

handle('persona:importShared', async e => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    title: '페르소나 파일 가져오기', filters: [{ name: '페르소나 파일', extensions: ['json'] }], properties: ['openFile'],
  });
  if (r.canceled) return null;
  if (fs.statSync(r.filePaths[0]).size > 50 * 1024 * 1024) throw new Error('파일이 너무 커요(50MB 초과).');
  let obj;
  try { obj = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8').replace(/^﻿/, '')); } catch { throw new Error('JSON 파일을 읽지 못했어요.'); }
  const p = graph.fromShare(obj);
  savePersona(p);
  return summaryOf(p);
});

// names: 페르소나로 만들 사람들. into: 기존 페르소나 id(한 사람만 고른 경우 거기에 내용 추가)
handle('persona:build', async (e, { names, into, merge }) => {
  if (!lastImport) throw new Error('먼저 대화 파일을 열어 주세요.');
  let msgs = lastImport.msgs;
  // 플랫폼마다 이름이 다른 같은 사람(카톡 "홍길동" = 인스타 "gildong"): 고른 이름을 모두 첫 이름으로 바꿔 한 사람으로 분석
  if (merge && names.length > 1) {
    const same = new Set(names);
    msgs = msgs.map(m => same.has(m.name) ? { ...m, name: names[0] } : m);
    names = [names[0]];
  }
  if (into && names.length !== 1) throw new Error('기존 페르소나에 추가할 때는 한 사람만 고를 수 있어요.');
  const { provider, model, key } = current();
  const done = [];
  for (const [i, name] of names.entries()) {
    const progress = msg => e.sender.send('progress', `(${i + 1}/${names.length}) ${name}: ${msg}`);
    progress('대화 분석 중…');
    let chars = 0;
    const r = await llm.run({
      provider, model, key, json: true,
      system: '너는 대화 기록을 분석해 인물 프로필을 JSON으로 정리하는 도우미다.',
      messages: [{ role: 'user', content: graph.extractionPrompt(name, parsers.analysisLog(msgs, name)) }],
      onText: t => { chars += t.length; progress(`분석 결과 작성 중… ${chars}자`); },
    });
    const p = into ? getPersona(into) : graph.emptyPersona(name);
    graph.mergeExtraction(p, graph.parseJSON(r.text));
    p.examples = [...p.examples, ...parsers.examples(msgs, name)].slice(-5000);
    savePersona(p);
    done.push(summaryOf(p));
  }
  return done;
});

handle('persona:list', () => [...personas.values()].map(summaryOf).sort((a, b) => b.updatedAt - a.updatedAt));
handle('persona:get', (e, id) => { const p = getPersona(id); return { ...summaryOf(p), items: graph.toFlat(p), shareCodes: publicCodes(p) }; });

handle('persona:save', (e, { id, name, items }) => {
  const p = getPersona(id);
  if (typeof name === 'string' && name.trim()) p.name = name.trim();
  graph.fromFlat(p, Array.isArray(items) ? items : []);
  savePersona(p);
  return summaryOf(p);
});

handle('persona:delete', (e, id) => {
  if (!isId(id)) return;
  personas.delete(id);
  fs.rmSync(personaFile(id), { force: true });
  for (const c of [...chats.values()].filter(c => c.personaIds.includes(id))) { // 1:1은 지우고, 단체방에서는 빼기만
    c.personaIds = c.personaIds.filter(x => x !== id);
    if (c.type === 'direct' || !c.personaIds.length) deleteChat(c.id);
    else saveChat(c);
  }
});

// ---------- 대화방: chats/<id>.json = { id, type: 'direct'|'group', personaIds, title, createdAt, updatedAt, messages } ----------
// 페르소나마다 1:1 대화를 여러 개 둘 수 있고, 단체방은 페르소나 여러 명을 초대한 방이다. 시작 시 전부 메모리에 올린다.
// 메시지: { role, text(보이는 원문), content(LLM에 보낸 원문: 기억 포함), at, raw? }. 히스토리는 덧붙이기만 한다(CLAUDE.md).
const chats = new Map();
const saveChat = c => { chats.set(c.id, c); writeJSON(chatFile(c.id), c); };
const deleteChat = id => { chats.delete(id); fs.rmSync(chatFile(id), { force: true }); };
const getChat = id => { const c = chats.get(id); if (!c) throw new Error('대화방을 찾을 수 없어요.'); return c; };
const membersOf = c => c.personaIds.map(id => personas.get(id)).filter(Boolean);
const titleOf = c => c.title || membersOf(c).map(p => p.name).join(', ') || '빈 대화방';

function loadChats() {
  fs.mkdirSync(data('chats'), { recursive: true });
  for (const f of fs.readdirSync(data('chats')).filter(f => f.endsWith('.json'))) {
    const v = readJSON(data('chats', f));
    if (Array.isArray(v)) { // 예전 형식: chats/<페르소나id>.json = 메시지 배열 → 1:1 대화방으로 옮긴다
      const pid = f.slice(0, -5);
      if (personas.has(pid) && v.length) saveChat({ id: crypto.randomUUID(), type: 'direct', personaIds: [pid], title: '', createdAt: Date.now(), updatedAt: Date.now(), messages: v.map(m => ({ ...m, at: Date.now() })) });
      fs.rmSync(data('chats', f), { force: true });
    } else if (v?.id) chats.set(v.id, v);
  }
}

// 화면에 보일 말풍선: 페르소나 답은 줄마다 나누고, 단체방이면 보낸 사람을 붙인다
const namesOf = c => (c.type === 'group' ? membersOf(c).map(p => p.name) : null);
const bubblesOf = (c, text) => graph.splitReply(text, namesOf(c));

function chatSummary(c) {
  const last = c.messages.at(-1);
  const lastBubble = last && (last.role === 'user' ? { text: last.text, mine: true } : bubblesOf(c, last.text).at(-1));
  return { id: c.id, type: c.type, title: titleOf(c), custom: !!c.title, personaIds: c.personaIds, names: membersOf(c).map(p => p.name), updatedAt: c.updatedAt, count: c.messages.length, last: lastBubble ?? null };
}

handle('chat:list', (e, personaId) => [...chats.values()]
  .filter(c => !personaId || c.personaIds.includes(personaId))
  .sort((a, b) => b.updatedAt - a.updatedAt).map(chatSummary));

handle('chat:create', (e, { personaIds, title }) => {
  const ids = [...new Set(Array.isArray(personaIds) ? personaIds : [])].filter(id => personas.has(id));
  if (!ids.length) throw new Error('대화할 페르소나를 골라 주세요.');
  const c = { id: crypto.randomUUID(), type: ids.length > 1 ? 'group' : 'direct', personaIds: ids, title: ids.length > 1 ? String(title ?? '').trim().slice(0, 60) : '', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
  saveChat(c);
  return chatSummary(c);
});

handle('chat:get', (e, id) => {
  const c = getChat(id);
  return {
    ...chatSummary(c),
    members: membersOf(c).map(summaryOf),
    messages: c.messages.map(m => (m.role === 'user' ? { role: 'user', text: m.text, at: m.at } : { role: 'assistant', at: m.at, bubbles: bubblesOf(c, m.text) })),
  };
});

handle('chat:invite', (e, { id, personaIds }) => {
  const c = getChat(id);
  const add = (Array.isArray(personaIds) ? personaIds : []).filter(p => personas.has(p) && !c.personaIds.includes(p));
  if (!add.length) throw new Error('초대할 페르소나를 골라 주세요.');
  c.personaIds = [...c.personaIds, ...add];
  c.type = 'group';
  c.updatedAt = Date.now();
  saveChat(c);
  return chatSummary(c);
});

handle('chat:rename', (e, { id, title }) => { const c = getChat(id); c.title = String(title ?? '').trim().slice(0, 60); saveChat(c); return chatSummary(c); });
handle('chat:delete', (e, id) => { if (chats.has(id)) deleteChat(id); });

handle('chat:send', async (e, { id, text }) => {
  const c = getChat(id);
  const ps = membersOf(c);
  if (!ps.length) throw new Error('대화방에 페르소나가 없어요.');
  const group = c.type === 'group';
  const names = namesOf(c);
  const me = settings.myName || '나';
  const { provider, model, key } = current();
  const user = { role: 'user', text, content: group ? graph.withGroupMemory(ps, text) : graph.withMemory(ps[0], text), at: Date.now() };
  // Claude 원본 응답(thinking 블록 포함)은 같은 모델·같은 페르소나 구성/버전일 때만 그대로 되돌려 보낸다. 나머지는 텍스트로.
  const v = ps.map(p => `${p.id}@${p.updatedAt}`).join(',');
  const messages = [...c.messages, user].map(m => ({
    role: m.role, content: m.content,
    raw: provider === 'anthropic' && m.raw?.model === model && m.raw.v === v ? m.raw.content : undefined,
  }));
  let acc = '';
  const r = await llm.run({
    provider, model, key, chat: true, group, messages,
    system: group ? graph.groupSystemPrompt(ps, me) : graph.systemPrompt(ps[0], me),
    onText: t => { acc += t; e.sender.send('chat:bubbles', { id, bubbles: graph.splitReply(acc, names, { partial: true }) }); },
  });
  const bubbles = graph.splitReply(r.text, names);
  if (!bubbles.length) throw new Error('응답이 비어 있어요. 다시 시도해 주세요.');
  c.messages.push(user, { role: 'assistant', text: r.text, content: r.text, at: Date.now(), ...(r.raw && { raw: { model, v, content: r.raw } }) });
  c.updatedAt = Date.now();
  saveChat(c);
  return { bubbles };
});

app.whenReady().then(() => {
  loadSettings();
  loadPersonas();
  loadChats();
  createWindow();
});
app.on('window-all-closed', () => app.quit());
