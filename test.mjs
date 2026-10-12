// node test.mjs — 카톡 파서와 그래프 저장/검색 검사 (LLM 호출 없음)
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const kakao = require('./src/parsers.js');
const graph = require('./src/graph.js');

// --- 파서: PC / 안드로이드 / iOS, 이어지는 줄, 시스템 줄 무시
const pc = `홍길동 님과 카카오톡 대화
저장한 날짜 : 2026-10-01 12:00:00

--------------- 2026년 10월 1일 목요일 ---------------
[홍길동] [오후 3:15] 안녕 ㅋㅋ
[나] [오후 3:16] 뭐해
[홍길동] [오후 3:16] 그냥
여러 줄`;
assert.deepEqual(kakao.parseKakao(pc), [
  { name: '홍길동', text: '안녕 ㅋㅋ' }, { name: '나', text: '뭐해' }, { name: '홍길동', text: '그냥\n여러 줄' },
]);
const android = `2026년 10월 1일 오후 3:10
2026년 10월 1일 오후 3:11, 김철수님이 들어왔습니다.
2026년 10월 1일 오후 3:15, 홍길동 : 밥 먹었어?
2026년 10월 1일 오전 9:01, 나 : 아니
2026년 10월 1일 오전 9:02, 김철수 : 나도`;
const am = kakao.parseKakao(android);
assert.deepEqual(am.map(m => m.name), ['홍길동', '나', '김철수']);
assert.deepEqual(kakao.parseKakao(`2026. 10. 1. 오후 3:15, 홍길동 : ㅇㅇ\r\n2026. 10. 1. 오후 3:16, 나 : ㅋ`).map(m => m.text), ['ㅇㅇ', 'ㅋ']);

// --- 단톡방 인식 & 분석 기록은 고른 사람 + 직전 맥락만
assert.equal(kakao.participants(am).length, 3);
assert.equal(kakao.analysisLog(am, '김철수'), '나: 아니\n김철수: 나도');
assert.deepEqual(kakao.examples(am, '김철수'), [{ c: '아니', t: '나도' }]);

// --- 그래프: 추출 결과 병합, 중복 제거, 조사 붙은 질문으로 검색, 이웃 펼치기
const p = graph.emptyPersona('홍길동');
p.examples = [{ c: '주말에 뭐해', t: '축구하러 감 ㅋㅋ' }, { c: '배고파', t: '라면 ㄱ' }];
const ex = {
  summary: '활발한 대학생', style: ['반말', 'ㅋㅋ 자주'], trait: ['낙천적'], phrase: ['ㄱㄱ'],
  facts: [{ text: '주말마다 조기축구를 한다', topics: ['축구', '주말'] }, { text: '손흥민 팬이다', topics: ['축구'] }, { text: '고양이를 키운다', topics: ['고양이'] }],
  relations: [{ name: '김철수', text: '고등학교 친구' }],
};
graph.mergeExtraction(p, ex);
graph.mergeExtraction(p, ex); // 같은 내용 다시 넣어도 그대로
assert.equal(Object.values(p.nodes).filter(n => n.type === 'fact').length, 3);
assert.equal(Object.values(p.nodes).filter(n => n.type === 'topic').length, 4); // 축구 주말 고양이 김철수

const r = graph.retrieve(p, '요즘도 축구를 해?');
assert.ok(r.facts.includes('주말마다 조기축구를 한다'));
assert.ok(r.facts.includes('손흥민 팬이다'), '축구 키워드 이웃으로 함께 나와야 함');
assert.ok(!r.facts.includes('고양이를 키운다'));
assert.equal(graph.retrieve(p, '이번 주말에 축구해?').examples[0].t, '축구하러 감 ㅋㅋ');
assert.ok(graph.retrieve(p, '철수는 잘 지내?').facts.includes('김철수: 고등학교 친구'));
assert.deepEqual(graph.retrieve(p, '안녕').facts, []);

// --- 편집 왕복: 평면 목록으로 꺼냈다가 고쳐서 다시 넣기
const flat = graph.toFlat(p);
const cat = flat.find(i => i.text === '고양이를 키운다');
cat.text = '고양이 두 마리를 키운다'; cat.topics = ['고양이', '반려동물'];
flat.push({ type: 'fact', text: '새로 추가한 사실', topics: ['추가'] });
graph.fromFlat(p, flat.filter(i => i.text !== '손흥민 팬이다'));
assert.ok(graph.retrieve(p, '반려동물 있어?').facts.includes('고양이 두 마리를 키운다'));
assert.ok(!graph.retrieve(p, '축구 좋아해?').facts.includes('손흥민 팬이다'));
assert.ok(graph.toFlat(p).some(i => i.id === cat.id), '기존 노드 id 유지');

// --- 프롬프트
assert.match(graph.systemPrompt(p), /## 말투\n- 반말/);
assert.match(graph.withMemory(p, '축구 하자'), /<기억>[\s\S]*조기축구[\s\S]*<\/기억>\n\n축구 하자$/);
assert.equal(graph.withMemory(p, '안녕'), '안녕');
assert.deepEqual(graph.parseJSON('```json\n{"a":1}\n```'), { a: 1 });

console.log('ok');

// --- 요금제 CLI: 대화 펼치기, 새어 나온 태그 걷기
const cli = require('./src/cli.js');
assert.equal(cli.stripTags('<reasoning>생각\n중</reasoning>\n응 ㅋㅋ<system-reminder>x</system-reminder>'), '응 ㅋㅋ');
const flat2 = cli.flatten([{ role: 'user', content: '뭐해' }, { role: 'assistant', content: '누움' }, { role: 'user', content: '축구?' }], true);
assert.match(flat2, /\[상대\] 뭐해\n\n\[나\] 누움\n\n상대의 새 메시지:\n축구\?/);
assert.equal(cli.flatten([{ role: 'user', content: '분석해' }], false), '분석해');
console.log('ok (cli)');

// --- 인스타그램: 최신순 → 시간순, 깨진 한글 복원, 공감/첨부 알림 제거, 여러 파일 합치기
const mojibake = s => Buffer.from(s, 'utf8').toString('latin1'); // 인스타가 저장하는 방식 흉내
const ig1 = JSON.stringify({ participants: [{ name: mojibake('김민지') }, { name: 'me' }], messages: [
  { sender_name: mojibake('김민지'), timestamp_ms: 3000, content: mojibake('ㅋㅋ 그럼 내일 봐') },
  { sender_name: 'me', timestamp_ms: 2500, content: 'Liked a message' },
  { sender_name: 'me', timestamp_ms: 2000, content: mojibake('내일 시간 돼?') },
  { sender_name: mojibake('김민지'), timestamp_ms: 1500, photos: [{}] },
] });
const ig2 = JSON.stringify({ messages: [{ sender_name: mojibake('김민지'), timestamp_ms: 1000, content: mojibake('안녕!') }] });
const ig = kakao.parseFiles([{ name: 'message_1.json', text: ig1 }, { name: 'message_2.json', text: ig2 }]);
assert.deepEqual(ig.platforms, ['instagram']);
assert.deepEqual(ig.msgs.map(m => `${m.name}:${m.text}`), ['김민지:안녕!', 'me:내일 시간 돼?', '김민지:ㅋㅋ 그럼 내일 봐']);

// --- 디스코드: DiscordChatExporter JSON / CSV, 공식 데이터 패키지
const dce = kakao.parseFile('chan.json', JSON.stringify({ guild: { name: 'g' }, messages: [
  { timestamp: '2026-10-01T10:00:00Z', content: '안녕', author: { name: 'minji', nickname: '민지' } },
  { timestamp: '2026-10-01T10:01:00Z', content: '', author: { name: 'bob' } },
  { timestamp: '2026-10-01T10:02:00Z', content: 'yo', author: { name: 'bob' } },
] }));
assert.equal(dce.platform, 'discord');
assert.deepEqual(dce.msgs.map(m => m.name + ':' + m.text), ['민지:안녕', 'bob:yo']);
const dcsv = kakao.parseFile('chan.csv', '"AuthorID","Author","Date","Content","Attachments","Reactions"\n"1","minji#0","2026-10-01T10:00:00Z","줄바꿈\n있는, ""인용""","",""\n');
assert.deepEqual(dcsv.msgs.map(m => m.name + ':' + m.text), ['minji:줄바꿈\n있는, "인용"']);
const pkg = kakao.parseFile('messages.json', JSON.stringify([{ ID: 2, Timestamp: '2026-10-02 10:00:00', Contents: '둘째' }, { ID: 1, Timestamp: '2026-10-01 10:00:00', Contents: '첫째' }]));
assert.deepEqual(pkg.msgs.map(m => m.name + ':' + m.text), ['나:첫째', '나:둘째']);
assert.equal(kakao.parseFile('k.csv', 'Date,User,Message\n2026-10-01 10:00:00,"홍길동","ㅎㅇ"\n').msgs[0].name, '홍길동');
assert.throws(() => kakao.parseFile('x.json', '{"foo":1}'), /지원하지 않는/);
assert.equal(kakao.participants(dce.msgs)[0].sample, '안녕');

// --- 공유: 내보내기(예시 포함/제외) → 가져오기, 남이 준 파일 검증
const shared = graph.toShare(p, false);
assert.equal(shared.persona.examples.length, 0);
const p2 = graph.fromShare(JSON.parse(JSON.stringify(graph.toShare(p, true))));
assert.notEqual(p2.id, p.id);
assert.equal(p2.name, p.name);
assert.equal(p2.examples.length, p.examples.length);
assert.deepEqual(graph.retrieve(p2, '반려동물 있어?').facts, graph.retrieve(p, '반려동물 있어?').facts);
assert.throws(() => graph.fromShare({ format: 'other' }), /페르소나 파일이 아니/);
const evil = graph.fromShare({ format: 'persona-chat/persona', persona: { name: 'x', nodes: { a: { type: 'script', text: 'bad' }, b: { type: 'fact', text: 1 }, c: { type: 'fact', text: 'ok' } }, edges: [['c', 'zzz'], 'junk'], examples: [{ t: 5 }, null] } });
assert.deepEqual(Object.values(evil.nodes), [{ type: 'fact', text: 'ok' }]);
assert.deepEqual([evil.edges, evil.examples], [[], []]);
console.log('ok (formats, share)');

// --- 인스타그램 HTML + zip째로 열기 (인스타 / 디스코드 데이터 패키지)
const { zipSync, strToU8 } = require('fflate');
const igBlock = (who, text, date) => `<div class="pam _3-95 _2ph- _a6-g uiBoxWhite noborder"><h2 class="_3-95 _2pim _a6-h _a6-i">${who}</h2><div class="_3-95 _a6-p"><div><div></div><div>${text}</div><div></div><div></div></div></div><div class="_3-94 _a6-o">${date}</div></div>`;
const igHtml = `<html><body><h1 id="x">우리방</h1><h2 class="_a6-h">참가자: 김민지, 박준호</h2>` +
  igBlock('박준호', 'ㅋㅋ 내일 봐 &#064;minji &amp; 너', '10월 09, 2026 11:22 오후') +
  igBlock('김민지', '첨부 파일을 보냈습니다.', '10월 09, 2026 11:00 오후') +
  '<div class="pam"><h2 class="_3-95 _2pim _a6-h _a6-i">그룹 초대 링크: 설정</h2><div class="_a6-p"><a href="https://ig.me/j/x">https://ig.me/j/x</a></div></div>' +
  igBlock('김민지', '내일 3시 어때?<br>여의나루', '10월 09, 2026 5:47 오전') + '</body></html>';
const ih = kakao.parseInstagramHtml(igHtml);
assert.equal(ih.title, '우리방');
assert.deepEqual(ih.msgs.map(m => `${m.name}:${m.text}`), ['김민지:내일 3시 어때?\n여의나루', '박준호:ㅋㅋ 내일 봐 @minji & 너']);
assert.equal(new Date(ih.msgs[1].ts).getHours(), 23);

const igZip = zipSync({
  'your_instagram_activity/messages/inbox/room_1/message_1.html': strToU8(igHtml),
  'your_instagram_activity/messages/inbox/room_1/photos/a.jpg': new Uint8Array([1, 2]),
  'your_instagram_activity/messages/inbox/solo_2/message_1.html': strToU8(`<h1>둘만</h1>` + igBlock('나', '혼잣말', '10월 01, 2026 1:00 오후')),
});
const iz = kakao.readZip(Buffer.from(igZip));
assert.equal(iz.platform, 'instagram');
assert.deepEqual(iz.conversations.map(c => [c.title, c.count]), [['우리방', 2], ['둘만', 1]]);
assert.equal(iz.pick(['room_1', 'solo_2']).length, 3);
assert.equal(iz.pick(['room_1', 'solo_2'])[0].text, '혼잣말'); // 대화방을 합치면 시간순

const dcZip = zipSync({
  '계정/user.json': strToU8(JSON.stringify({ username: 'al', global_name: '수민' })),
  '메시지/index.json': strToU8(JSON.stringify({ 11: '철수 님과의 다이렉트 메시지' })),
  '메시지/c11/channel.json': strToU8(JSON.stringify({ id: '11', type: 'DM' })),
  '메시지/c11/messages.json': strToU8(JSON.stringify([{ Timestamp: '2026-10-02 10:00:00', Contents: 'ㅇㅋ' }, { Timestamp: '2026-10-01 10:00:00', Contents: '뭐함' }])),
  '메시지/c22/channel.json': strToU8(JSON.stringify({ id: '22', type: 'GUILD_TEXT', name: '잡담', guild: { name: '우리서버' } })),
  '메시지/c22/messages.json': strToU8(JSON.stringify([{ Timestamp: '2026-10-03 10:00:00', Contents: '하이' }])),
});
const dz = kakao.readZip(Buffer.from(dcZip));
assert.equal(dz.platform, 'discord');
assert.deepEqual(dz.conversations.map(c => [c.key, c.title, c.count, c.people]), [['11', '철수 님과의 다이렉트 메시지', 2, ['수민']], ['22', '우리서버 · 잡담', 1, ['수민']]]);
assert.deepEqual(dz.pick(['11', '22']).map(m => m.text), ['뭐함', 'ㅇㅋ', '하이']);
console.log('ok (zip)');

// --- 말풍선 나누기(1:1은 줄마다, 단체방은 [이름]으로 보낸 사람), 단체방 프롬프트
assert.deepEqual(graph.splitReply('ㅇㅇ\n\n지금 감 ㅋㅋ\n'), [{ text: 'ㅇㅇ' }, { text: '지금 감 ㅋㅋ' }]);
const names2 = ['민지', '준호'];
assert.deepEqual(graph.splitReply('[민지] 헐\n[준호] ㅋㅋㅋ\n아 진짜\n민지: 뭐야\n[모르는사람] 안녕', names2), [
  { speaker: '민지', text: '헐' }, { speaker: '준호', text: 'ㅋㅋㅋ' }, { speaker: '준호', text: '아 진짜' },
  { speaker: '민지', text: '뭐야' }, { speaker: '민지', text: '[모르는사람] 안녕' },
]);
assert.deepEqual(graph.splitReply('[민지] 헐\n[준', names2, { partial: true }), [{ speaker: '민지', text: '헐' }]); // 이름표가 덜 온 줄은 보류
assert.deepEqual(graph.splitReply('[민지]\n줄바꿈 뒤 본문', names2), [{ speaker: '민지', text: '줄바꿈 뒤 본문' }]);
const q = graph.emptyPersona('준호');
graph.mergeExtraction(q, { summary: '게임 좋아함', facts: [{ text: '롤 다이아 티어다', topics: ['롤', '게임'] }] });
const gs = graph.groupSystemPrompt([p, q], '수민');
assert.match(gs, /"홍길동", "준호"/);
assert.match(gs, /사용자 "수민"/);
assert.match(gs, /# 준호\n[\s\S]*게임 좋아함/);
const gm = graph.withGroupMemory([p, q], '주말에 축구 아니면 롤?');
assert.match(gm, /\[홍길동\][\s\S]*조기축구[\s\S]*\[준호\][\s\S]*롤 다이아/);
assert.match(graph.systemPrompt(p, '수민'), /대화 상대는 "수민"/);
const gflat = cli.flatten([{ role: 'user', content: '다들 뭐해' }, { role: 'assistant', content: '[민지] 누움\n[준호] 롤' }, { role: 'user', content: '나도 낄래' }], true, true);
assert.match(gflat, /\[사용자\] 다들 뭐해\n\n\[민지\] 누움\n\[준호\] 롤\n\n사용자의 새 메시지:\n나도 낄래[\s\S]*\[이름\] 메시지/);
console.log('ok (bubbles, group)');
