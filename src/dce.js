// 디스코드 DM 가져오기: DiscordChatExporter(MIT, github.com/Tyrrrz/DiscordChatExporter) CLI를 처음 쓸 때 내려받아 실행한다.
// 공식 데이터 패키지에는 내 메시지만 있어서, 상대 메시지까지 받으려면 사용자 토큰으로 디스코드 API를 읽는 수밖에 없다.
// 토큰은 저장하지 않고, 명령줄(프로세스 목록에 보임) 대신 환경변수 DISCORD_TOKEN으로 넘긴다.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { exec } = require('./cli');

// ponytail: 버전·해시 고정. 디스코드 API가 바뀌어 내보내기가 깨지면 새 릴리즈의 자산 이름·sha256으로 바꾼다
// (gh api repos/Tyrrrz/DiscordChatExporter/releases --jq '.[0].assets[] | {name, digest}')
const VERSION = '2.48';
const ASSETS = {
  'win32-x64': ['win-x64', '9f6706f6311f1387bc29d536e951d6c758716a57f59a2f2ce1718616ea6574b1'],
  'win32-arm64': ['win-arm64', '0be2deec0163c8fe44889c0f6e6b7d5ac4d02a97713a685f86c10bdffc8deed2'],
  'darwin-arm64': ['osx-arm64', '623f9d2dce568e17a46b8fbd366a18dca49803d386216f4ba24507d2c000fee9'],
  'darwin-x64': ['osx-x64', '91b4eae3525df85d084969004f3a287edad4eeaafd664e4869b26bb8422e2e88'],
  'linux-x64': ['linux-x64', '3e253e28ec7ea034b2201443fa84571142945299296541ecbe196ffceef8bc3c'],
  'linux-arm64': ['linux-arm64', '02a47fc8e0192fd509fbb082aadd9322035b18feae96849699fefc424a1e3379'],
};

// toolsDir 아래에 없으면 내려받아 해시를 확인하고 푼다. 실행 파일 경로를 돌려준다
async function ensure(toolsDir, progress) {
  const dir = path.join(toolsDir, `dce-${VERSION}`);
  const exe = path.join(dir, process.platform === 'win32' ? 'DiscordChatExporter.Cli.exe' : 'DiscordChatExporter.Cli');
  if (fs.existsSync(exe)) return exe;
  const asset = ASSETS[`${process.platform}-${process.arch}`];
  if (!asset) throw new Error(`이 기기(${process.platform}-${process.arch})용 DiscordChatExporter가 없어요.`);
  progress('DiscordChatExporter 내려받는 중… (처음 한 번, 약 11MB)');
  const res = await fetch(`https://github.com/Tyrrrz/DiscordChatExporter/releases/download/${VERSION}/DiscordChatExporter.Cli.${asset[0]}.zip`);
  if (!res.ok) throw new Error(`DiscordChatExporter를 내려받지 못했어요. (HTTP ${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (crypto.createHash('sha256').update(buf).digest('hex') !== asset[1]) throw new Error('내려받은 DiscordChatExporter 파일이 예상과 달라요. 잠시 뒤 다시 해 주세요.');
  const { unzipSync } = require('fflate');
  const tmp = `${dir}.tmp`;
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const [name, data] of Object.entries(unzipSync(buf))) {
    if (name.endsWith('/')) continue;
    const f = path.join(tmp, name);
    if (!f.startsWith(tmp + path.sep)) continue; // zip 경로 탈출 방지
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, data, { mode: 0o755 });
  }
  fs.renameSync(tmp, dir); // 다 풀린 뒤에만 exe가 생긴다: 중간에 꺼져도 반쯤 풀린 폴더를 쓰지 않는다
  return exe;
}

// DCE는 실패하면 "ERROR" 다음 줄에 "...Exception: 메시지"를 찍는다
function fail(r) {
  const msg = (r.err + r.out).match(/Exception: (.+)/)?.[1]?.trim() ?? (r.err || r.out).trim().split('\n').pop();
  if (/token is invalid/i.test(msg)) return new Error('디스코드 토큰이 올바르지 않아요. 다시 복사해 주세요.');
  return new Error(`DiscordChatExporter 오류: ${msg}`);
}

async function dce(exe, args, token, timeoutMs) {
  const r = await exec(exe, args, { env: { DISCORD_TOKEN: token, FUCK_RUSSIA: 'true' }, timeoutMs });
  if (r.code !== 0) throw fail(r);
  return r.out;
}

// DM·그룹 DM 목록. DCE의 "dm" 출력은 윈도우에서 시스템 코드페이지(CP949)라 한글 이름이 깨지고 이모지는 사라진다.
// 그래서 목록만 DCE가 쓰는 것과 같은 API를 직접 부른다(JSON이라 인코딩 문제 없음)
const dmTitle = c => c.name || (c.recipients ?? []).map(r => r.global_name || r.username).join(', ') || c.id;
async function listDms(token) {
  const res = await fetch('https://discord.com/api/v10/users/@me/channels', { headers: { Authorization: token } });
  if (res.status === 401) throw new Error('디스코드 토큰이 올바르지 않아요. 다시 복사해 주세요.');
  if (!res.ok) throw new Error(`디스코드 DM 목록을 받지 못했어요. (HTTP ${res.status})`);
  return (await res.json())
    .filter(c => c.type === 1 || c.type === 3) // 1:1 DM, 그룹 DM
    .sort((a, b) => (BigInt(b.last_message_id ?? 0) > BigInt(a.last_message_id ?? 0) ? 1 : -1)) // 최근 대화 먼저
    .map(c => ({ id: c.id, name: dmTitle(c) }));
}

// 고른 채널들을 JSON으로 내보내 parsers.parseFiles에 그대로 넣을 수 있는 [{name, text}]로
async function exportDms(exe, token, ids) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-dce-'));
  try {
    // 큰 DM은 오래 걸린다(디스코드 속도 제한). 한 시간까지 기다린다
    await dce(exe, ['export', '-c', ...ids, '-f', 'Json', '-o', out + path.sep], token, 60 * 60_000);
    return fs.readdirSync(out).filter(f => f.endsWith('.json')).map(f => ({ name: f, text: fs.readFileSync(path.join(out, f), 'utf8') }));
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
}

module.exports = { ensure, listDms, exportDms, dmTitle };
