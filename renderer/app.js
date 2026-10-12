// 화면: 사이드바(채팅·페르소나 탭) + 본문(대화방 / 페르소나 프로필 / 편집 / 새 페르소나 / 받기 / 설정) + 모달.
// 프레임워크 없이 DOM 직접 조립. window.api는 preload.js가 노출한다. 움직임 값은 style.css의 모션 토큰(transitions.dev)을 쓴다.
const $ = id => document.getElementById(id);
const view = $('view');

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'data') Object.assign(el.dataset, v);
    else if (k === 'role' || k.includes('-')) el.setAttribute(k, v);
    else if (v !== false && v != null) el[k] = v;
  }
  el.append(...kids.flat().filter(k => k != null && k !== false));
  return el;
}
const errorBox = () => h('div', { class: 'error' });

// 본문 교체 + 페이지 전환(page side-by-side: 8px 밀림 + 3px 블러, 250ms)
function show(...els) {
  view.replaceChildren(...els);
  view.classList.remove('enter');
  void view.offsetWidth;
  view.classList.add('enter');
}

// ---------- 아이콘(24px 그리드, 선 2px) ----------
const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  invite: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M19 8v6M16 11h6"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/>',
  share: '<path d="M12 15V3M7 8l5-5 5 5M5 14v6h14v-6"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  inbox: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
  settings: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  back: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chat: '<path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>',
  file: '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4z"/><path d="M14 3v4h4"/>',
};
function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'icon');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = ICONS[name];
  return s;
}
const iconBtn = (name, label, onclick, cls = '') => h('button', { class: `icon-btn ${cls}`, title: label, 'aria-label': label, onclick }, icon(name));

// ---------- 아바타: 이름으로 정해지는 파스텔 틴트 ----------
const TINTS = ['peach', 'rose', 'mint', 'lavender', 'sky', 'yellow'];
function tintOf(name) {
  let hash = 0;
  for (const c of name) hash = (hash * 31 + c.codePointAt(0)) >>> 0;
  return TINTS[hash % TINTS.length];
}
const avatar = (name, size = '') => h('span', { class: `avatar ${size} tint-${tintOf(name)}`, textContent: [...(name || '?')][0] });
const avatarStack = (names, size = 'sm') => h('span', { class: `avatar-stack ${size}` }, names.slice(0, 3).map(n => avatar(n, size)));

// ---------- 시간 ----------
const clock = ts => new Date(ts).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
function when(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (day(now) - day(d)) / 86400e3;
  return diff === 0 ? clock(ts) : diff === 1 ? '어제' : `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

const PROVIDERS = {
  anthropic: 'Anthropic (Claude)', openai: 'OpenAI', gemini: 'Google Gemini',
  'claude-cli': 'Claude Code (Claude 요금제)', 'codex-cli': 'Codex (ChatGPT 요금제)',
};
const CLI_HELP = {
  'claude-cli': '이 PC에 로그인된 Claude Code로 Pro/Max 요금제 사용량을 씁니다. 설치: npm install -g @anthropic-ai/claude-code → 터미널에서 claude 실행 후 /login. 모델: opus · sonnet · haiku 또는 전체 모델 ID.',
  'codex-cli': '이 PC에 로그인된 Codex CLI로 ChatGPT 요금제 사용량을 씁니다. 설치: npm install -g @openai/codex → 터미널에서 codex login. 모델을 비우면 Codex 설정의 기본 모델을 씁니다.',
};
const KEY_URL = {
  anthropic: 'https://console.anthropic.com/settings/keys',
  openai: 'https://platform.openai.com/api-keys',
  gemini: 'https://aistudio.google.com/apikey',
};
const PLATFORMS = { kakao: '카카오톡', instagram: '인스타그램', discord: '디스코드' };
const GUIDES = [
  { title: '카카오톡 (휴대폰)', file: '.txt', steps: [
    '대화방에 들어가 오른쪽 위 ≡(메뉴)를 누릅니다.',
    '아래쪽 ⚙(채팅방 설정) → "대화 내용 내보내기"를 누릅니다.',
    '"텍스트 메시지만 보내기"를 고르고, 이메일·드라이브·"나와의 채팅" 등으로 PC에 옮깁니다.',
    '받은 .txt 파일을 이 앱에서 엽니다. (압축 파일로 왔다면 압축을 풀고 .txt만 고르세요)',
  ] },
  { title: '카카오톡 (PC)', file: '.txt / .csv', steps: [
    '대화방을 열고 오른쪽 위 ≡(메뉴)를 누릅니다.',
    '"대화 내용" → "대화 내보내기"(또는 "대화 내용 저장")로 파일을 저장합니다.',
    '저장한 파일을 이 앱에서 엽니다.',
  ] },
  { title: '인스타그램 DM', file: '받은 .zip 그대로', steps: [
    '인스타그램 앱 → 프로필 → ≡ → "계정 센터" → "내 정보 및 권한" → "내 정보 내보내기"로 갑니다.',
    '"내보내기 만들기" → 계정 선택 → "기기로 내보내기"를 고릅니다.',
    '"정보 맞춤 설정"에서 "메시지"만 남기면 빨리 끝납니다. 형식은 HTML·JSON 둘 다 됩니다. 미디어 화질은 "낮음"이면 충분해요.',
    '내보내기를 시작하면 준비되는 데 몇 분~며칠 걸립니다. 알림·이메일이 오면 .zip 파일을 내려받습니다.',
    '압축을 풀지 말고 .zip을 그대로 이 앱에서 열면 대화방 목록이 나옵니다. 페르소나로 만들 사람이 있는 방을 고르세요.',
  ] },
  { title: '디스코드 서버 채널', file: '.json / .csv', steps: [
    'DiscordChatExporter(github.com/Tyrrrz/DiscordChatExporter)를 내려받습니다.',
    '서버에 초대된 봇의 토큰으로 로그인하고, 원하는 채널을 JSON 형식으로 내보냅니다. (서버 관리자가 봇을 넣어야 합니다)',
    '저장된 .json 파일을 이 앱에서 엽니다.',
  ], note: '내 계정(사용자) 토큰으로 내보내는 방법은 디스코드 약관 위반이라 계정이 정지될 수 있어요. 봇 토큰을 쓰세요.' },
  { title: '디스코드 DM·채널 (나 자신의 페르소나)', file: '받은 package.zip 그대로', steps: [
    '디스코드 설정 → "데이터 및 개인정보 보호" → "내 데이터 요청"으로 데이터 패키지를 신청합니다. (며칠 걸릴 수 있어요)',
    '이메일로 온 package.zip을 압축 풀지 말고 그대로 이 앱에서 엽니다.',
    '채널·DM 목록에서 내 말투가 잘 드러나는 대화를 고르세요. 여러 개를 합쳐도 됩니다.',
  ], note: '데이터 패키지에는 내가 보낸 메시지만 들어 있어서 "나"의 페르소나만 만들 수 있어요. 상대 페르소나는 위의 "디스코드 DM 바로 가져오기"를 쓰세요.' },
];
const DISCORD_TOKEN_STEPS = [
  'PC 브라우저에서 discord.com/app에 로그인하고 F12(개발자 도구)를 엽니다.',
  '"네트워크(Network)" 탭에서 필터에 api를 입력하고, 아무 채널이나 클릭해 요청이 생기게 합니다.',
  '목록의 요청 하나를 눌러 "요청 헤더(Request Headers)"의 authorization 값을 복사해 아래에 붙여 넣습니다.',
];
const SECTIONS = [
  ['summary', '요약', '어떤 사람인지'],
  ['style', '말투', '문장 길이, 반말/존댓말, ㅋㅋ·이모티콘 습관 등'],
  ['trait', '성격', '성격, 가치관, 감정 표현'],
  ['phrase', '말버릇', '자주 쓰는 표현 그대로'],
  ['relation', '주변 사람', '"이름: 관계와 대하는 태도" 형식'],
  ['fact', '기억', '사실 한 문장 + 키워드(쉼표로 구분). 키워드로 그래프가 연결돼 대화 중 관련 기억을 꺼냅니다'],
];
const fmtCode = c => `${c.slice(0, 4)}-${c.slice(4)}`;

// ---------- 사이드바 ----------
const state = { tab: 'chats', route: {} };
const route = (name, id = null) => { state.route = { name, id }; };

async function renderSide(animate = false) {
  $('tabs').dataset.tab = state.tab;
  for (const b of $('tabs').querySelectorAll('button')) b.setAttribute('aria-selected', b.dataset.tab === state.tab);
  const active = id => (state.route.id === id ? ' active' : '');
  const stagger = (el, i) => { if (animate) { el.classList.add('enter'); el.style.setProperty('--i', Math.min(i, 10)); } return el; };
  let items;
  if (state.tab === 'chats') {
    $('side-action').replaceChildren(icon('plus'), '새 채팅');
    $('side-action').onclick = () => openNewChat();
    const list = await api.listChats();
    items = list.map((c, i) => stagger(h('button', { class: 'item' + active(c.id), onclick: () => openChat(c.id) },
      c.type === 'group' ? avatarStack(c.names) : avatar(c.title),
      h('span', { class: 'item-main' },
        h('span', { class: 'item-top' }, h('b', { textContent: c.title }), h('time', { textContent: when(c.updatedAt) })),
        h('small', { textContent: c.last ? `${c.last.mine ? '나: ' : c.type === 'group' && c.last.speaker ? `${c.last.speaker}: ` : ''}${c.last.text}` : '아직 대화가 없어요' }))), i));
    if (!list.length) items = [h('div', { class: 'empty-side' }, '아직 대화가 없어요.', h('br'), '페르소나를 만들거나 "새 채팅"을 눌러 보세요.')];
  } else {
    $('side-action').replaceChildren(icon('plus'), '새 페르소나');
    $('side-action').onclick = () => openImport();
    const list = await api.listPersonas();
    items = list.map((p, i) => stagger(h('button', { class: 'item' + active(p.id), onclick: () => openPersona(p.id) },
      avatar(p.name), h('span', { class: 'item-main' }, h('b', { textContent: p.name }), h('small', { textContent: `기억 ${p.nodes}개 · 예시 ${p.examples}개` }))), i));
    if (!list.length) items = [h('div', { class: 'empty-side', textContent: '아직 페르소나가 없어요.' })];
  }
  $('list').replaceChildren(...items);
}
for (const b of $('tabs').querySelectorAll('button')) b.onclick = () => { if (state.tab !== b.dataset.tab) { state.tab = b.dataset.tab; renderSide(true); } };
$('import').onclick = () => openReceive();
$('settings').onclick = () => openSettings();

// ---------- 모달(modal open/close: 0.96 → 1, 열기 250ms·닫기 150ms) ----------
function openModal(title, body, actions) {
  const root = $('modal-root');
  const dialog = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h3', { textContent: title }), iconBtn('close', '닫기', () => close())),
    h('div', { class: 'modal-body' }, body),
    h('div', { class: 'modal-foot' }, actions));
  const overlay = h('div', { class: 'overlay', onmousedown: e => { if (e.target === overlay) close(); } }, dialog);
  const onKey = e => { if (e.key === 'Escape') close(); };
  function close() {
    document.removeEventListener('keydown', onKey);
    overlay.classList.remove('is-open');
    overlay.classList.add('is-closing');
    setTimeout(() => overlay.remove(), 160);
  }
  document.addEventListener('keydown', onKey);
  root.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-open'));
  return close;
}

// 새 채팅 / 초대: 페르소나 여러 명을 고르면 단체방
async function openNewChat({ preselect = [], inviteTo = null, exclude = [] } = {}) {
  const list = (await api.listPersonas()).filter(p => !exclude.includes(p.id));
  if (!list.length) {
    if (inviteTo) return alert('초대할 수 있는 페르소나가 더 없어요.');
    state.tab = 'personas';
    return openImport();
  }
  const err = errorBox();
  const title = h('input', { type: 'text', placeholder: '단체방 이름 (비우면 참여자 이름)', maxLength: 60 });
  const titleRow = h('div', { class: 'field', hidden: true }, h('label', { textContent: '단체방 이름' }), title);
  const go = h('button', { class: 'primary' });
  const tiles = list.map(p => {
    const input = h('input', { type: 'checkbox', value: p.id, checked: preselect.includes(p.id) });
    const tile = h('label', { class: 'pick-tile' }, input, avatar(p.name, 'lg'), h('b', { textContent: p.name }), h('small', { textContent: `기억 ${p.nodes}개` }));
    input.onchange = update;
    return tile;
  });
  const picked = () => tiles.map(t => t.querySelector('input')).filter(i => i.checked).map(i => i.value);
  function update() {
    const n = picked().length;
    titleRow.hidden = !!inviteTo || n < 2;
    go.disabled = !n;
    go.textContent = inviteTo ? (n ? `${n}명 초대하기` : '초대할 페르소나를 고르세요') : n > 1 ? `단체방 만들기 (${n}명)` : n ? '대화 시작' : '페르소나를 고르세요';
  }
  update();
  const close = openModal(inviteTo ? '단체방에 초대하기' : '새 채팅',
    [h('p', { class: 'hint', textContent: inviteTo ? '초대하면 1:1 대화도 단체방이 돼요.' : '한 명을 고르면 1:1, 여러 명을 고르면 단체방이 만들어져요.' }),
      h('div', { class: 'pick-grid' }, tiles), titleRow, err],
    [h('button', { class: 'ghost', textContent: '취소', onclick: () => close() }), go]);
  go.onclick = async () => {
    try {
      const c = inviteTo ? await api.inviteToChat({ id: inviteTo, personaIds: picked() }) : await api.createChat({ personaIds: picked(), title: title.value });
      close();
      state.tab = 'chats';
      openChat(c.id);
    } catch (e) { err.textContent = e.message; }
  };
}

// ---------- 대화방 ----------
async function openChat(id, { draft = '', error = '' } = {}) {
  route('chat', id);
  renderSide();
  let c;
  try { c = await api.getChat(id); } catch { return home(); }
  const group = c.type === 'group';
  const solo = c.members[0];
  const inner = h('div', { class: 'log-inner' });
  const log = h('div', { class: 'log' }, inner);
  const err = h('div', { class: 'error chat-error', textContent: error });
  const input = h('textarea', { rows: 1, value: draft, placeholder: `${group ? c.title : solo?.name ?? ''}에게 메시지 보내기`, 'aria-label': '메시지' });
  const sendBtn = h('button', { class: 'send-btn', title: '보내기', 'aria-label': '보내기' }, icon('send'));
  const toBottom = () => { log.scrollTop = log.scrollHeight; };

  // 같은 사람이 연달아 보낸 말풍선은 한 묶음(run): 첫 줄에 아바타·이름, 끝에 시간
  let lastRun = null;
  function addBubble(item, animate) {
    const key = item.mine ? '\u0000me' : item.speaker;
    if (!lastRun || lastRun.key !== key) {
      const list = h('div', { class: 'bubbles' });
      const time = h('time', { class: 'run-time' });
      const run = h('div', { class: 'run ' + (item.mine ? 'mine' : 'them') },
        item.mine ? null : avatar(item.speaker),
        h('div', { class: 'run-body' }, group && !item.mine ? h('div', { class: 'run-name', textContent: item.speaker }) : null, list, time));
      if (animate) run.classList.add('enter');
      inner.append(run);
      lastRun = { key, list, time };
    }
    const b = h('div', { class: 'bubble' + (animate ? ' enter' : ''), textContent: item.text });
    lastRun.list.append(b);
    if (item.at) lastRun.time.textContent = clock(item.at);
    return b;
  }
  const theirs = (b, at) => ({ speaker: b.speaker || solo?.name || '?', text: b.text, at });

  for (const m of c.messages) {
    if (m.role === 'user') addBubble({ mine: true, text: m.text, at: m.at });
    else for (const b of m.bubbles) addBubble(theirs(b, m.at));
  }
  if (!c.messages.length) inner.append(h('div', { class: 'chat-empty' },
    group ? avatarStack(c.members.map(p => p.name), 'lg') : avatar(solo?.name ?? '?', 'xl'),
    h('b', { textContent: c.title }),
    h('p', { class: 'hint', textContent: group ? `${c.members.map(p => p.name).join(', ')}이(가) 있는 단체방이에요. 먼저 말을 걸어 보세요.` : '먼저 말을 걸어 보세요.' })));

  async function send() {
    const text = input.value.trim();
    if (!text || sendBtn.disabled) return;
    err.textContent = '';
    input.value = '';
    grow();
    sendBtn.disabled = true;
    inner.querySelector('.chat-empty')?.remove();
    addBubble({ mine: true, text, at: Date.now() }, true);
    const typing = h('div', { class: 'run them typing enter' }, group ? h('span', { class: 'avatar placeholder' }) : avatar(solo?.name ?? '?'),
      h('div', { class: 'run-body' }, h('div', { class: 'bubble' }, h('span', { class: 'shimmer', textContent: '입력 중…', data: { text: '입력 중…' } }))));
    inner.append(typing);
    toBottom();
    const live = [];
    const at = Date.now();
    const render = (bubbles, animate) => {
      if (bubbles.length) typing.remove();
      bubbles.forEach((b, i) => {
        if (i < live.length) { if (live[i].textContent !== b.text) live[i].textContent = b.text; }
        else live.push(addBubble(theirs(b, at), animate));
      });
      toBottom();
    };
    const off = api.onBubbles(d => { if (d.id === id) render(d.bubbles, true); });
    try {
      const r = await api.send({ id, text });
      off();
      const same = r.bubbles.length === live.length && r.bubbles.every((b, i) => b.text === live[i].textContent);
      if (!same) return openChat(id); // 스트리밍 중 보인 것과 최종 답이 다르면(태그 제거 등) 저장된 대로 다시 그린다
      sendBtn.disabled = false;
      renderSide();
      input.focus();
    } catch (e) {
      off();
      openChat(id, { draft: text, error: e.message });
    }
  }
  const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 160)}px`; };
  input.oninput = grow;
  sendBtn.onclick = send;
  input.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } };

  const actions = [
    iconBtn('invite', '초대하기', () => openNewChat({ inviteTo: id, exclude: c.personaIds })),
    group ? iconBtn('edit', '단체방 이름 바꾸기', () => renameChat(c)) : iconBtn('user', '프로필 보기', () => openPersona(solo.id)),
    iconBtn('trash', '대화 삭제', async () => {
      if (!confirm(`"${c.title}" 대화를 지울까요? 되돌릴 수 없어요.`)) return;
      await api.deleteChat(id);
      home();
    }, 'danger'),
  ];
  show(
    h('header', { class: 'chat-head' },
      group ? avatarStack(c.members.map(p => p.name), 'md') : avatar(solo?.name ?? '?', 'md'),
      h('div', { class: 'head-title' }, h('h2', { textContent: c.title }), h('small', { textContent: group ? `${c.members.length}명 · ${c.members.map(p => p.name).join(', ')}` : '1:1 대화' })),
      h('div', { class: 'head-actions' }, actions)),
    log,
    h('div', { class: 'composer' }, err, h('div', { class: 'composer-box' }, input, sendBtn)),
  );
  grow();
  toBottom();
  input.focus();
}

function renameChat(c) {
  const input = h('input', { type: 'text', value: c.custom ? c.title : '', placeholder: c.title, maxLength: 60 });
  const save = h('button', { class: 'primary', textContent: '저장' });
  const close = openModal('단체방 이름', [h('p', { class: 'hint', textContent: '비우면 참여자 이름으로 보여요.' }), input],
    [h('button', { class: 'ghost', textContent: '취소', onclick: () => close() }), save]);
  save.onclick = async () => { await api.renameChat({ id: c.id, title: input.value }); close(); openChat(c.id); };
  input.onkeydown = e => { if (e.key === 'Enter') save.click(); };
  setTimeout(() => input.focus(), 50);
}

async function startChat(personaId) {
  const c = await api.createChat({ personaIds: [personaId] });
  state.tab = 'chats';
  openChat(c.id);
}

// ---------- 페르소나 프로필: 요약 + 이 페르소나와의 대화 목록 ----------
async function openPersona(id) {
  route('persona', id);
  renderSide();
  let p;
  try { p = await api.getPersona(id); } catch { return home(); }
  const chats = await api.listChats(id);
  const of = t => p.items.filter(i => i.type === t).map(i => i.text);
  const chips = [...of('style').slice(0, 3), ...of('trait').slice(0, 3)];
  show(
    h('header', {}, h('h2', { textContent: '페르소나' }),
      h('div', { class: 'head-actions' },
        h('button', { onclick: () => openEditor(id, { share: true }) }, icon('share'), '공유'),
        h('button', { onclick: () => openEditor(id) }, icon('edit'), '편집'),
        h('button', { class: 'primary', onclick: () => startChat(id) }, icon('chat'), '새 대화'))),
    h('div', { class: 'page' }, h('div', { class: 'stack' },
      h('section', { class: `profile-hero tint-bg-${tintOf(p.name)}` },
        avatar(p.name, 'xl'),
        h('div', {}, h('h1', { textContent: p.name }),
          h('p', { class: 'hint', textContent: `기억 ${p.nodes}개 · 연결 ${p.edges}개 · 말투 예시 ${p.examples}개` }))),
      of('summary').length ? h('p', { class: 'profile-summary', textContent: of('summary').join(' ') }) : null,
      chips.length ? h('div', { class: 'chips' }, chips.map(t => h('span', { class: 'chip', textContent: t }))) : null,
      h('div', { class: 'section-head' }, h('h3', { textContent: `대화 ${chats.length}개` }),
        h('button', { class: 'small', onclick: () => openNewChat({ preselect: [id] }) }, icon('invite'), '단체방 만들기')),
      chats.length
        ? h('div', { class: 'card list-card' }, chats.map(c => h('button', { class: 'row-item', onclick: () => { state.tab = 'chats'; openChat(c.id); } },
          c.type === 'group' ? avatarStack(c.names) : icon('chat'),
          h('span', { class: 'item-main' }, h('span', { class: 'item-top' }, h('b', { textContent: c.type === 'group' ? c.title : `1:1 대화` }), h('time', { textContent: when(c.updatedAt) })),
            h('small', { textContent: c.last ? `${c.last.mine ? '나: ' : c.last.speaker ? `${c.last.speaker}: ` : ''}${c.last.text}` : '아직 대화가 없어요' })))))
        : h('div', { class: 'card empty-card' }, h('p', { class: 'hint', textContent: '아직 대화가 없어요. "새 대화"로 시작해 보세요.' })))),
  );
}

// ---------- 페르소나 편집 ----------
async function openEditor(id, { share: openShare = false } = {}) {
  route('persona', id);
  renderSide();
  const p = await api.getPersona(id);
  const name = h('input', { type: 'text', value: p.name });
  const err = errorBox();
  const lists = {};

  const row = it => {
    const text = h('textarea', { value: it.text, rows: Math.min(6, Math.ceil(it.text.length / 60) || 1) });
    const topics = it.type === 'fact' ? h('input', { type: 'text', class: 'topics', placeholder: '키워드 (쉼표로 구분)', value: (it.topics ?? []).join(', ') }) : null;
    const el = h('div', { class: 'node' }, text, iconBtn('trash', '삭제', () => el.remove(), 'danger'), topics);
    el.read = () => ({ id: it.id, type: it.type, text: text.value, ...(topics && { topics: topics.value.split(',').map(s => s.trim()).filter(Boolean) }) });
    return el;
  };

  const sections = SECTIONS.map(([type, title, hint]) => {
    const items = p.items.filter(i => i.type === type);
    lists[type] = h('div', {}, items.map(row));
    return h('div', { class: 'card section' },
      h('h3', {}, title, h('span', { class: 'badge', textContent: items.length })),
      h('p', { class: 'hint', textContent: hint }),
      lists[type],
      h('button', { class: 'small ghost', onclick: () => { const r = row({ type, text: '' }); lists[type].append(r); r.querySelector('textarea').focus(); } }, icon('plus'), '추가'),
    );
  });

  // 공유: 저장된 상태 기준. 편집 중인 내용은 먼저 저장해야 반영된다
  const withEx = h('input', { type: 'checkbox', checked: true });
  const shareMsg = h('p', { class: 'hint' });
  const codes = h('div');
  const renderCodes = list => codes.replaceChildren(...list.map(c => h('div', { class: 'row code-row' },
    h('b', { class: 'code', textContent: fmtCode(c.code) }),
    h('span', { class: 'hint', textContent: `${new Date(c.expiresAt).toLocaleDateString()}까지 · 예시 ${c.withExamples ? '포함' : '제외'}` }),
    h('button', { class: 'small', textContent: '복사', onclick: () => { navigator.clipboard.writeText(fmtCode(c.code)); shareMsg.textContent = '코드를 복사했어요.'; } }),
    h('button', { class: 'small danger', textContent: '코드 삭제', onclick: async () => {
      try { renderCodes(await api.unsharePersona({ id, code: c.code })); shareMsg.textContent = '서버에서 지웠어요. 이 코드로는 더 받을 수 없어요.'; }
      catch (e) { shareMsg.textContent = e.message; }
    } }))));
  renderCodes(p.shareCodes);
  const share = h('div', { class: 'card share-card', hidden: !openShare },
    h('h3', { textContent: '페르소나 공유' }),
    h('p', { class: 'hint', textContent: '공유 코드를 알려 주거나 파일로 보내면, 친구는 사이드바의 "받기"로 바로 쓸 수 있어요. 대화 기록과 API 키는 들어가지 않습니다. 저장된 내용 기준이니 편집 중이면 먼저 저장하세요.' }),
    h('label', { class: 'check' }, withEx, `실제 메시지 예시 ${p.examples}개 포함 (말투가 훨씬 비슷해지지만, 그 사람과 주변 사람의 실제 메시지 원문이 들어갑니다)`),
    h('div', { class: 'row' },
      h('button', { class: 'primary', textContent: '공유 코드 만들기', onclick: async ev => {
        ev.currentTarget.disabled = true;
        const btn = ev.currentTarget;
        try { renderCodes(await api.uploadPersona({ id, withExamples: withEx.checked })); shareMsg.textContent = '코드를 만들었어요. 30일 동안 쓸 수 있고, 언제든 지울 수 있어요.'; }
        catch (e) { shareMsg.textContent = e.message; }
        btn.disabled = false;
      } }),
      h('button', { textContent: '파일로 저장', onclick: async () => {
        try {
          const f = await api.exportPersona({ id, withExamples: withEx.checked });
          if (f) shareMsg.textContent = `저장했어요: ${f}`;
        } catch (e) { shareMsg.textContent = e.message; }
      } })),
    codes,
    shareMsg,
    h('p', { class: 'hint', textContent: '공유 코드를 만들면 페르소나가 공유 서버(193.233.198.126)에 30일 동안 보관됩니다. 코드를 아는 사람은 누구나 받을 수 있어요.' }),
  );

  async function save() {
    err.textContent = '';
    try {
      const items = Object.values(lists).flatMap(l => [...l.children].map(el => el.read())).filter(i => i.text.trim());
      await api.savePersona({ id, name: name.value, items });
      openPersona(id);
    } catch (e) { err.textContent = e.message; }
  }

  show(
    h('header', {}, iconBtn('back', '프로필로', () => openPersona(id)), h('h2', { textContent: `${p.name} 편집` }),
      h('div', { class: 'head-actions' },
        h('button', { onclick: () => { share.hidden = !share.hidden; } }, icon('share'), '공유'),
        h('button', { onclick: () => openImport({ id, name: p.name }) }, icon('file'), '대화로 내용 추가'),
        h('button', { class: 'primary', textContent: '저장', onclick: save }))),
    h('div', { class: 'page' },
      h('div', { class: 'stack' },
        share,
        h('p', { class: 'hint', textContent: `그래프: 노드 ${p.nodes}개 · 연결 ${p.edges}개 · 말투 예시 메시지 ${p.examples}개` }),
        h('div', { class: 'card' }, h('div', { class: 'field' }, h('label', { textContent: '이름' }), name)),
        sections,
        err,
        h('div', { class: 'row spread' },
          h('button', { class: 'danger', onclick: async () => {
            if (!confirm(`${p.name} 페르소나와 1:1 대화를 모두 지울까요? 단체방에서는 빠집니다.`)) return;
            await api.deletePersona(id);
            home();
          } }, icon('trash'), '페르소나 삭제'),
          h('button', { class: 'primary', textContent: '저장', onclick: save })))),
  );
}

// ---------- 새 페르소나 / 내용 추가 ----------
async function openImport(into = null) {
  route('import', into?.id ?? null);
  state.tab = 'personas';
  renderSide();
  const s = await api.getSettings();
  const err = errorBox();
  const progress = h('div', { class: 'progress' });
  const result = h('div');
  const offProgress = api.onProgress(t => { progress.textContent = t; progress.dataset.text = t; });

  let advOpen = false; // 고급 옵션을 한 번 펼쳤으면 목록을 다시 그려도 열어 둔다

  // append: 고급 옵션에서 다른 대화를 앞서 연 대화에 이어 붙인다
  async function pick(append = false) {
    err.textContent = '';
    try {
      const r = await api.openImport(append);
      if (!r) return;
      if (r.zip) showConversations(r);
      else showPeople(r);
    } catch (e) { err.textContent = e.message; }
  }

  // zip 안의 대화방 목록 → 골라서 불러오기
  function showConversations(r) {
    const rows = r.conversations.map(c => {
      const input = h('input', { type: 'checkbox', value: c.key });
      const el = h('label', { class: 'check person' }, input,
        h('span', {}, c.title, ' ', c.count ? h('span', { class: 'badge', textContent: `${c.count}개` }) : null, h('small', { textContent: c.people.join(', ') })));
      el.input = input;
      el.search = `${c.title} ${c.people.join(' ')}`.toLowerCase();
      return el;
    });
    const filter = h('input', { type: 'text', placeholder: '대화방·사람 이름으로 찾기' });
    filter.oninput = () => { const q = filter.value.trim().toLowerCase(); for (const el of rows) el.hidden = !!q && !el.search.includes(q); };
    const next = h('button', { class: 'primary', textContent: '선택한 대화 불러오기', onclick: async () => {
      const keys = rows.filter(el => el.input.checked).map(el => el.input.value);
      if (!keys.length) { err.textContent = '대화를 하나 이상 골라 주세요.'; return; }
      err.textContent = '';
      next.disabled = true;
      try { showPeople(await api.pickConversations(keys)); } catch (e) { err.textContent = e.message; next.disabled = false; }
    } });
    result.replaceChildren(h('div', { class: 'card reveal' },
      h('div', { class: 'row wrap' }, h('b', { textContent: r.file }),
        h('span', { class: 'badge', textContent: PLATFORMS[r.platform] }), h('span', { class: 'badge', textContent: `대화 ${r.conversations.length}개` })),
      h('p', { class: 'hint', textContent: r.dce
        ? '페르소나로 만들 사람과의 DM을 고르세요. 고른 DM만 내보내요(길면 몇 분 걸려요).'
        : r.platform === 'discord'
        ? '디스코드 데이터 패키지에는 내가 보낸 메시지만 있어요. 내 페르소나에 쓸 채널을 고르세요(여러 개를 합치면 말투가 더 풍부해집니다).'
        : '페르소나로 만들 사람이 있는 대화방을 고르세요. 여러 개를 고르면 합쳐서 분석합니다(같은 사람이 여러 방에 있을 때 좋아요).' }),
      h('div', { class: 'row' }, filter,
        h('button', { class: 'small', textContent: '보이는 것 모두 선택', onclick: () => { for (const el of rows) if (!el.hidden) el.input.checked = true; } })),
      h('div', { class: 'conv-list' }, rows),
      h('div', { class: 'row', style: 'margin-top:12px' }, next, progress),
    ));
  }

  // 디스코드 DM: 토큰을 받아 DiscordChatExporter로 DM 목록을 가져온다. 토큰은 저장하지 않는다
  function discordCard() {
    const token = h('input', { type: 'password', placeholder: '디스코드 토큰 붙여넣기', autocomplete: 'off', 'aria-label': '디스코드 토큰' });
    const go = h('button', { class: 'primary', textContent: 'DM 목록 불러오기' });
    go.onclick = async () => {
      err.textContent = '';
      go.disabled = true;
      progress.classList.add('shimmer');
      try { const r = await api.importDiscord(token.value); token.value = ''; showConversations(r); }
      catch (e) { err.textContent = e.message; }
      finally { go.disabled = false; progress.classList.remove('shimmer'); }
    };
    return h('details', { class: 'card guide' },
      h('summary', {}, h('b', { textContent: '디스코드 DM 바로 가져오기' }), h('span', { class: 'hint', textContent: '상대 메시지까지 · DiscordChatExporter' })),
      h('ol', {}, DISCORD_TOKEN_STEPS.map(t => h('li', { textContent: t }))),
      h('div', { class: 'row' }, token, go, progress),
      h('p', { class: 'hint note', textContent: '토큰은 계정 비밀번호와 같아요. 이 앱은 토큰을 저장하지 않고 이 PC에서 디스코드로만 보냅니다. 내 계정 토큰으로 내보내는 건 디스코드 약관 위반이라 드물게 계정이 제재될 수 있어요. 처음 한 번 DiscordChatExporter(약 11MB)를 내려받습니다.' }));
  }

  function showPeople(r) {
    const inputs = r.people.map(pp => h('input', { type: 'checkbox', name: 'who', value: pp.name }));
    const merge = h('input', { type: 'checkbox' });
    const build = h('button', { class: 'primary', textContent: into ? `${into.name}에 내용 추가` : '페르소나 만들기' });
    build.onclick = async () => {
      const names = inputs.filter(i => i.checked).map(i => i.value);
      if (!names.length) { err.textContent = '사람을 한 명 이상 골라 주세요.'; return; }
      build.disabled = true; err.textContent = '';
      progress.classList.add('shimmer');
      try {
        // 기존 페르소나에 추가할 때 여러 이름을 고르면 플랫폼마다 이름이 다른 같은 사람으로 본다
        const made = await api.build({ names, into: into?.id, merge: !!into || merge.checked });
        offProgress();
        if (into) openPersona(into.id);
        else startChat(made[0].id);
      } catch (e) { err.textContent = e.message; progress.textContent = ''; progress.classList.remove('shimmer'); build.disabled = false; }
    };
    result.replaceChildren(h('div', { class: 'card reveal' },
      h('div', { class: 'row wrap' }, h('b', { textContent: r.file }),
        r.platforms.map(p => h('span', { class: 'badge', textContent: PLATFORMS[p] })),
        h('span', { class: 'badge', textContent: `메시지 ${r.total}개` }),
        r.isGroup ? h('span', { class: 'badge', textContent: `단체 대화 · ${r.people.length}명` }) : null),
      h('p', { class: 'hint', textContent: into
        ? `이 대화에서 ${into.name}에 해당하는 사람을 고르세요. 여러 플랫폼을 합쳐 이름이 다르면 그 이름들을 모두 고르세요.`
        : r.isGroup ? '단체 대화로 인식됐어요. 페르소나로 만들 사람을 고르세요(여러 명 가능, 사람마다 하나씩 만들어집니다).' : '페르소나로 만들 사람을 고르세요.' }),
      h('div', { class: 'people' }, r.people.map((pp, i) => h('label', { class: 'check person' }, inputs[i], avatar(pp.name, 'sm'),
        h('span', {}, pp.name, ' ', h('span', { class: 'badge', textContent: `${pp.count}개` }), h('small', { textContent: `마지막 메시지: ${pp.sample}` }))))),
      h('details', { class: 'card guide', open: advOpen, ontoggle: e => { advOpen = e.target.open; } },
        h('summary', {}, h('b', { textContent: '고급: 여러 플랫폼 합치기' }), h('span', { class: 'hint', textContent: '카카오톡·인스타그램·디스코드의 같은 사람을 페르소나 하나로' })),
        h('p', { class: 'hint', textContent: '다른 플랫폼에서 내보낸 대화를 더 열면 위 목록에 합쳐져요. 플랫폼마다 이름이 다르면(예: 카톡 "홍길동", 인스타 "gildong") 같은 사람의 이름을 모두 고르고 아래를 켜세요.' }),
        h('div', { class: 'row wrap' },
          h('button', { class: 'small', onclick: () => pick(true) }, icon('file'), '다른 대화 파일 더 추가'),
          into ? null : h('label', { class: 'check' }, merge, '고른 이름을 같은 사람으로 보고 페르소나 하나로 만들기'))),
      h('p', { class: 'hint', textContent: `분석 모델: ${PROVIDERS[s.provider]} · ${s.models[s.provider] || '(미설정)'} — 고른 사람의 메시지와 바로 앞 맥락이 이 제공자에게 전송됩니다.` }),
      h('div', { class: 'row' }, build, progress),
    ));
  }

  show(
    h('header', {}, into ? iconBtn('back', '돌아가기', () => openEditor(into.id)) : null,
      h('h2', { textContent: into ? `${into.name}에 대화 내용 추가` : '새 페르소나 만들기' })),
    h('div', { class: 'page' }, h('div', { class: 'stack' },
      h('section', { class: 'drop-hero tint-bg-lavender' },
        h('div', {}, h('h3', { textContent: '대화 파일 열기' }),
          h('p', { class: 'hint', textContent: '카카오톡·인스타그램·디스코드에서 내보낸 파일을 여세요. 형식은 자동으로 알아내요. 인스타그램·디스코드는 받은 .zip을 그대로 열면 됩니다.' })),
        h('button', { class: 'primary', onclick: () => pick() }, icon('file'), '파일 고르기')),
      discordCard(),
      s.hasKey[s.provider] ? null : h('p', { class: 'error', textContent: `${PROVIDERS[s.provider]} API 키가 없어요. 먼저 설정에서 넣어 주세요.` }),
      err, result,
      h('h3', { class: 'guide-title', textContent: '대화 내보내기 가이드' }),
      GUIDES.map(g => h('details', { class: 'card guide' },
        h('summary', {}, h('b', { textContent: g.title }), h('span', { class: 'hint', textContent: g.file })),
        h('ol', {}, g.steps.map(t => h('li', { textContent: t }))),
        g.note ? h('p', { class: 'hint note', textContent: g.note }) : null)))),
  );
}

// ---------- 페르소나 받기: 공유 코드 또는 파일 ----------
async function openReceive() {
  route('receive');
  renderSide();
  const err = errorBox();
  const code = h('input', { type: 'text', placeholder: 'ABCD-2345', maxLength: 12, autocomplete: 'off', class: 'code-input', 'aria-label': '공유 코드' });
  const get = h('button', { class: 'primary', textContent: '코드로 받기' });
  get.onclick = async () => {
    err.textContent = '';
    get.disabled = true;
    try { const p = await api.downloadPersona(code.value); state.tab = 'personas'; openPersona(p.id); }
    catch (e) { err.textContent = e.message; get.disabled = false; code.classList.remove('shake'); void code.offsetWidth; code.classList.add('shake'); }
  };
  code.onkeydown = e => { if (e.key === 'Enter') get.click(); };
  show(
    h('header', {}, h('h2', { textContent: '페르소나 받기' })),
    h('div', { class: 'page' }, h('div', { class: 'stack' },
      h('div', { class: 'card tint-bg-lavender receive-card' },
        h('h3', { textContent: '공유 코드로 받기' }),
        h('p', { class: 'hint', textContent: '친구가 "공유 → 공유 코드 만들기"로 받은 8자리 코드를 넣으세요. 코드는 만든 날부터 30일 동안 쓸 수 있어요.' }),
        h('div', { class: 'row' }, code, get)),
      h('div', { class: 'card' },
        h('h3', { textContent: '파일로 받기' }),
        h('p', { class: 'hint', textContent: '친구가 보낸 .persona.json 파일을 엽니다.' }),
        h('button', { onclick: async () => {
          err.textContent = '';
          try { const p = await api.importPersona(); if (p) { state.tab = 'personas'; openPersona(p.id); } } catch (e) { err.textContent = e.message; }
        } }, icon('file'), '파일 열기')),
      err)),
  );
  code.focus();
}

// ---------- 설정 ----------
async function openSettings() {
  route('settings');
  renderSide();
  const s = await api.getSettings();
  const err = errorBox();
  const keys = {}, models = {};
  const myName = h('input', { type: 'text', value: s.myName, placeholder: '나', maxLength: 30 });
  const radios = Object.keys(PROVIDERS).map(p => h('input', { type: 'radio', name: 'provider', value: p, checked: s.provider === p }));

  const cards = Object.entries(PROVIDERS).map(([p, label], i) => {
    const list = h('datalist', { id: `models-${p}` });
    models[p] = h('input', { type: 'text', value: s.models[p] ?? '', placeholder: '모델 ID', autocomplete: 'off' });
    models[p].setAttribute('list', list.id);
    if (CLI_HELP[p]) {
      api.listModels(p).then(ids => list.replaceChildren(...ids.map(v => h('option', { value: v }))));
      const status = h('p', { class: 'hint pre' });
      const check = h('button', { textContent: '연결 확인', onclick: async () => {
        check.disabled = true;
        status.textContent = '확인 중…';
        try {
          const r = await api.checkCli(p);
          status.textContent = (r.ok ? '✓ ' : '✗ ') + r.detail;
        } catch (e) { status.textContent = '✗ ' + e.message; }
        check.disabled = false;
      } });
      return h('div', { class: 'card provider' },
        h('label', { class: 'check' }, radios[i], h('b', { textContent: label }), h('span', { class: 'badge accent', textContent: '요금제 · API 키 불필요' })),
        h('p', { class: 'hint', textContent: CLI_HELP[p] }),
        h('div', { class: 'row' }, models[p], check, list),
        status,
      );
    }
    keys[p] = h('input', { type: 'password', placeholder: s.hasKey[p] ? '저장됨 — 바꾸려면 새 키 입력' : 'API 키', autocomplete: 'off' });
    const load = h('button', { textContent: '모델 불러오기', onclick: async () => {
      err.textContent = '';
      load.disabled = true;
      try {
        await saveKeys();
        const ids = await api.listModels(p);
        list.replaceChildren(...ids.map(v => h('option', { value: v })));
        if (!models[p].value && ids.length) models[p].value = ids[0];
        load.textContent = `모델 ${ids.length}개 불러옴`;
      } catch (e) { err.textContent = `${label}: ${e.message}`; }
      load.disabled = false;
    } });
    return h('div', { class: 'card provider' },
      h('label', { class: 'check' }, radios[i], h('b', { textContent: label }), s.hasKey[p] ? h('span', { class: 'badge', textContent: '키 저장됨' }) : null),
      h('p', { class: 'hint' }, '키 발급: ', h('a', { href: KEY_URL[p], target: '_blank', textContent: KEY_URL[p] })),
      h('div', { class: 'row' }, keys[p], s.hasKey[p] ? h('button', { class: 'small danger', textContent: '키 삭제', onclick: async () => { await api.setSettings({ keys: { [p]: null } }); openSettings(); } }) : null),
      h('div', { class: 'row', style: 'margin-top:8px' }, models[p], load, list),
    );
  });

  const saveKeys = () => api.setSettings({ keys: Object.fromEntries(Object.entries(keys).map(([p, el]) => [p, el.value])) });
  async function save() {
    err.textContent = '';
    try {
      await api.setSettings({
        provider: radios.find(r => r.checked)?.value,
        myName: myName.value,
        models: Object.fromEntries(Object.entries(models).map(([p, el]) => [p, el.value])),
        keys: Object.fromEntries(Object.entries(keys).map(([p, el]) => [p, el.value])),
      });
      openSettings();
    } catch (e) { err.textContent = e.message; }
  }

  show(
    h('header', {}, h('h2', { textContent: '설정' }), h('div', { class: 'head-actions' }, h('button', { class: 'primary', textContent: '저장', onclick: save }))),
    h('div', { class: 'page' }, h('div', { class: 'stack' },
      h('div', { class: 'card' }, h('div', { class: 'field' }, h('label', { textContent: '내 이름' }), myName),
        h('p', { class: 'hint', textContent: '페르소나가 나를 부를 이름이에요. 단체방에서 특히 자연스러워져요.' })),
      h('h3', { class: 'guide-title', textContent: 'AI 연결' }),
      h('p', { class: 'hint', textContent: '선택한 제공자가 페르소나 분석과 채팅에 모두 쓰입니다. 키는 이 PC의 Windows 자격 증명으로 암호화돼 저장되고, 해당 제공자에게만 전송됩니다.' }),
      cards, err)),
  );
}

// ---------- 시작 화면 ----------
function welcome() {
  route('welcome');
  renderSide();
  const step = (tint, n, title, text) => h('div', { class: `step tint-bg-${tint}` }, h('span', { class: 'step-n', textContent: n }), h('b', { textContent: title }), h('p', { textContent: text }));
  show(h('div', { class: 'welcome' },
    h('img', { src: 'icon.svg', class: 'welcome-icon', alt: '' }),
    h('h1', { class: 'reveal-line', textContent: '친구의 말투 그대로, 다시 대화하기' }),
    h('p', { class: 'lede reveal-line two', textContent: '카카오톡·인스타그램·디스코드 대화로 친구의 말투와 기억을 정리해 그 친구처럼 대화하는 페르소나를 만들어요.' }),
    h('div', { class: 'steps' },
      step('lavender', '1', 'AI 연결', '설정에서 API 키나 Claude Code·Codex 요금제를 연결해요.'),
      step('peach', '2', '대화 불러오기', '내보낸 대화 파일을 열고 페르소나로 만들 사람을 골라요.'),
      step('mint', '3', '대화하기', '1:1로 대화하거나 여러 페르소나를 초대해 단체방을 만들어요.')),
    h('div', { class: 'row center' },
      h('button', { onclick: openSettings }, icon('settings'), '설정'),
      h('button', { class: 'primary', onclick: () => openImport() }, icon('plus'), '새 페르소나'))));
}

// 지울 때 등 갈 곳이 없으면: 최근 대화 → 첫 페르소나 → 시작 화면
async function home() {
  const [chats, personas] = await Promise.all([api.listChats(), api.listPersonas()]);
  if (chats.length) { state.tab = 'chats'; return openChat(chats[0].id); }
  if (personas.length) { state.tab = 'personas'; return openPersona(personas[0].id); }
  welcome();
}

home();
