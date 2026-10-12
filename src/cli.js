// 요금제(구독) 방식: 사용자가 로그인해 둔 Claude Code / Codex CLI를 한 번씩 실행해 답을 받는다. API 키 없음.
// CLI는 대화 상태를 들고 있지 않으므로 매번 지금까지의 대화를 한 프롬프트로 펼쳐 보낸다.
// 사용자 설정·훅·플러그인 MCP가 끼어들지 않게 빈 임시 폴더에서, 도구를 전부 끈 채로 띄운다(contest-scout와 같은 방식).
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CLI = {
  'claude-cli': { exe: 'claude', label: 'Claude Code', install: 'npm install -g @anthropic-ai/claude-code', login: '터미널에서 claude 실행 후 /login' },
  'codex-cli': { exe: 'codex', label: 'Codex', install: 'npm install -g @openai/codex', login: '터미널에서 codex login' },
};
const MODELS = { 'claude-cli': ['opus', 'sonnet', 'haiku', 'fable'], 'codex-cli': ['gpt-5.6-luna'] };

// PATH + 흔한 설치 위치. Windows는 .exe를 .cmd보다 먼저(.cmd는 셸을 거쳐야 해서).
function find(name) {
  const env = process.env;
  const dirs = [
    ...(env.PATH || '').split(path.delimiter),
    path.join(os.homedir(), '.local', 'bin'),
    env.APPDATA && path.join(env.APPDATA, 'npm'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin'),
  ].filter(Boolean);
  for (const ext of process.platform === 'win32' ? ['.exe', '.cmd'] : ['']) {
    for (const d of dirs) {
      const f = path.join(d, name + ext);
      if (fs.existsSync(f)) return f;
    }
  }
  return null;
}

function need(provider) {
  const c = CLI[provider];
  const f = find(c.exe);
  if (!f) throw new Error(`${c.label} CLI를 찾을 수 없어요. 설치: ${c.install}`);
  return f;
}

// stdout을 줄 단위 JSON으로 읽어 onLine에 넘긴다. 프롬프트는 stdin으로(명령줄 길이 제한 회피).
function exec(file, args, { input = '', cwd, onLine, timeoutMs = 10 * 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    // .cmd는 셸 없이 못 띄운다. 인자는 모두 우리가 만든 값(모델명은 run에서 검사)이라 큰따옴표로 감싸면 충분.
    const shell = file.endsWith('.cmd');
    const p = spawn(shell ? `"${file}"` : file, shell ? args.map(a => `"${a}"`) : args, { cwd, shell, windowsHide: true });
    let out = '', buf = '', err = '';
    const timer = setTimeout(() => { p.kill(); reject(new Error('응답 시간이 초과됐어요.')); }, timeoutMs);
    p.stdout.setEncoding('utf8').on('data', d => {
      out += d;
      if (!onLine) return;
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        let ev;
        try { ev = JSON.parse(line); } catch { continue; }
        onLine(ev);
      }
    });
    p.stderr.setEncoding('utf8').on('data', d => { err += d; });
    p.on('error', e => { clearTimeout(timer); reject(e); });
    p.on('close', code => { clearTimeout(timer); resolve({ code, out, err }); });
    p.stdin.on('error', () => {}); // 시작하자마자 죽으면 EPIPE. 종료코드와 stderr로 보고한다
    p.stdin.end(input, 'utf8');
  });
}

// 대화 기록을 한 프롬프트로. chat이 아니면(페르소나 분석) 마지막 메시지만.
// 단체방(group)은 페르소나 답이 이미 "[이름] 메시지" 줄이라 그대로 두고, 사용자 줄에만 [사용자]를 붙인다.
function flatten(messages, chat, group = false) {
  const last = messages.at(-1).content;
  if (!chat) return last;
  const prior = messages.slice(0, -1).map(m => (m.role === 'user' ? `[${group ? '사용자' : '상대'}] ${m.content}` : group ? m.content : `[나] ${m.content}`)).join('\n\n');
  const ask = group
    ? '위 메시지 다음에 이어질 단체방 메시지들을 형식대로([이름] 메시지, 한 줄에 하나)만 출력해라. 설명, 생각 과정, 내부·시스템용 XML 태그는 쓰지 않는다.'
    : '위 메시지에 보낼 너의 답장만 출력해라. 여러 말풍선으로 나눠 보낼 땐 줄바꿈으로 구분한다. 이름표나 따옴표, 설명, 생각 과정은 붙이지 않고 내부·시스템용 XML 태그도 쓰지 않는다.';
  return `${prior ? `지금까지의 대화:\n${prior}\n\n` : ''}${group ? '사용자' : '상대'}의 새 메시지:\n${last}\n\n${ask}`;
}

// Claude Code가 끼워 넣는 <system-reminder>나 생각 과정 태그를 모델이 가끔 답에 그대로 쓴다. 최종 텍스트에서 걷어낸다
const stripTags = t => t.replace(/<(system-reminder|reasoning|thinking)>[\s\S]*?<\/\1>/g, '').trim();

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'persona-chat-'));

async function claude({ model, system, messages, chat, group, onText }) {
  const file = need('claude-cli');
  const dir = tmp();
  try {
    fs.writeFileSync(path.join(dir, 'system.txt'), system);
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
      '--system-prompt-file', 'system.txt', '--tools', '', '--setting-sources', 'project,local',
      '--strict-mcp-config', '--no-session-persistence', '--disable-slash-commands', ...(model ? ['--model', model] : [])];
    let result = null;
    const { code, err } = await exec(file, args, {
      input: flatten(messages, chat, group), cwd: dir,
      onLine: ev => {
        if (ev.type === 'stream_event' && ev.event?.delta?.type === 'text_delta') onText(ev.event.delta.text);
        else if (ev.type === 'result') result = ev;
      },
    });
    if (!result) throw new Error(`Claude Code 실행 실패(종료코드 ${code}): ${err.trim().slice(0, 300) || '결과 없음'}`);
    if (result.is_error) {
      const msg = String(result.result ?? '').slice(0, 300);
      throw new Error(/log ?in|auth/i.test(msg) ? `Claude Code 로그인이 필요해요. ${CLI['claude-cli'].login}\n(${msg})` : `Claude Code 오류: ${msg}`);
    }
    return { text: stripTags(String(result.result ?? '')) };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function codex({ model, system, messages, chat, group, onText }) {
  const file = need('codex-cli');
  const dir = tmp();
  try {
    const out = path.join(dir, 'last.txt');
    // effort 값은 TOML 따옴표 없이 쓴다(문자열로 해석됨). .cmd 셸 인용과 충돌하지 않게.
    const args = ['exec', '--skip-git-repo-check', '--json', '--ephemeral', '-s', 'read-only', '-C', dir, '-o', out,
      ...(model ? ['-m', model] : []), ...(chat ? ['-c', 'model_reasoning_effort=low'] : []), '-'];
    let reply = '', failure = '';
    const { code, err } = await exec(file, args, {
      input: `${system}\n\n---\n\n${flatten(messages, chat, group)}`, cwd: dir,
      onLine: ev => {
        if (ev.type === 'item.completed' && ev.item?.type === 'agent_message') reply = ev.item.text ?? '';
        else if (ev.type === 'error' || ev.type === 'turn.failed') failure = ev.message ?? ev.error?.message ?? '';
      },
    });
    const text = (fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : reply).trim();
    if (!text) {
      let msg = failure || err.trim() || `종료코드 ${code}`;
      try { msg = JSON.parse(msg).error?.message ?? msg; } catch {}
      throw new Error(/log ?in|auth|401/i.test(msg) ? `Codex 로그인이 필요해요. ${CLI['codex-cli'].login}\n(${msg.slice(0, 300)})` : `Codex 오류: ${msg.slice(0, 300)}`);
    }
    onText(text); // codex는 다 끝난 뒤 한 번에 준다
    return { text };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function run(args) {
  if (args.model && !/^[\w.:\-\[\]]+$/.test(args.model)) throw new Error('모델 이름에 쓸 수 없는 문자가 있어요.');
  return args.provider === 'claude-cli' ? claude(args) : codex(args);
}

// 설정 화면의 "연결 확인": 설치 위치, 버전, 로그인 상태
async function check(provider) {
  const c = CLI[provider];
  const file = find(c.exe);
  if (!file) return { ok: false, detail: `설치되지 않았어요. ${c.install}` };
  const ver = (await exec(file, ['--version'], { timeoutMs: 30_000 })).out.trim().split('\n')[0];
  const st = await exec(file, provider === 'claude-cli' ? ['auth', 'status'] : ['login', 'status'], { timeoutMs: 30_000 });
  let loggedIn = st.code === 0;
  let who = (st.out || st.err).trim().split('\n')[0];
  if (provider === 'claude-cli') {
    try { const j = JSON.parse(st.out); loggedIn = !!j.loggedIn; who = [j.authMethod, j.subscriptionType].filter(Boolean).join(' · '); } catch {}
  }
  return { ok: loggedIn, detail: `${ver} — ${loggedIn ? `로그인됨 (${who})` : `로그인 필요: ${c.login}`}\n${file}` };
}

module.exports = { CLI, MODELS, run, check, flatten, stripTags };
