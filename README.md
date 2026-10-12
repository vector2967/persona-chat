# Persona Chat

카카오톡·인스타그램·디스코드에서 내보낸 대화로 지인의 말투·성격·기억을 정리해, 그 사람처럼 대화하는 챗봇을 만드는 Windows 데스크톱 앱입니다.

- 서버에 계정이 없습니다. 대화 파일과 페르소나는 **내 PC에만** 저장됩니다.
- 준비물: API 키(Anthropic / OpenAI / Gemini) 또는 로그인해 둔 Claude Code / Codex CLI(구독 요금제).

## 설치

[Releases](../../releases/latest)에서 `Persona Chat Setup x.y.z.exe`를 받아 실행합니다.

코드 서명이 없어서 처음 실행할 때 Windows가 "PC 보호" 경고를 띄웁니다. **추가 정보 → 실행**을 누르세요.

## 사용법

1. **설정**에서 제공자를 고르고 API 키를 넣습니다. Claude Code / Codex CLI를 쓰면 키 없이 "연결 확인"만 하면 됩니다.
2. **새 페르소나 → 파일 고르기**로 대화 내보내기 파일을 엽니다. 형식은 자동으로 알아냅니다.
3. 페르소나로 만들 사람을 고르면 LLM이 말투·성격·기억을 분석해 페르소나를 만듭니다.
4. 1:1로 대화하거나, 여러 페르소나를 초대해 단체방을 만들 수 있습니다.

### 지원하는 대화 파일

| 플랫폼 | 파일 | 얻는 법 |
|---|---|---|
| 카카오톡 | `.txt` / `.csv` | 대화방 메뉴 → 대화 내용 내보내기 |
| 인스타그램 DM | 받은 `.zip` 그대로 | 계정 센터 → 내 정보 내보내기(메시지, HTML 또는 JSON) |
| 디스코드 서버 채널 | `.json` / `.csv` | [DiscordChatExporter](https://github.com/Tyrrrz/DiscordChatExporter)(봇 토큰) |
| 디스코드 (나 자신) | 받은 `package.zip` 그대로 | 설정 → 데이터 및 개인정보 보호 → 내 데이터 요청 |

자세한 단계는 앱의 "새 페르소나" 화면 아래 **대화 내보내기 가이드**에 있습니다.

### 여러 플랫폼 합치기 (고급)

같은 사람과 카톡·인스타·디스코드에서 나눈 대화를 페르소나 하나로 묶을 수 있습니다. 사람 고르기 화면의 **고급: 여러 플랫폼 합치기**에서 다른 대화 파일을 더 열고, 플랫폼마다 다른 그 사람의 이름(예: `홍길동`, `gildong`)을 모두 고른 뒤 "같은 사람으로 보고 페르소나 하나로 만들기"를 켜세요.

### 페르소나 공유

편집 화면의 **공유하기**에서 두 가지 방법을 고를 수 있습니다.

- `.persona.json` 파일로 저장해 직접 보내기
- **공유 코드**(8자리, 30일 유효): 공유 서버에 올리고 코드만 알려 주기. 올린 PC에서 언제든 지울 수 있습니다.

실제 메시지 예시를 넣을지는 공유할 때 고릅니다. 받는 쪽은 **받기**에서 코드를 넣거나 파일을 엽니다.

## 데이터와 개인정보

- 저장 위치: `%APPDATA%\Persona Chat\` (`settings.json`, `personas/`, `chats/`)
- API 키는 Windows 자격 증명(Electron `safeStorage`)으로 암호화해 저장합니다.
- 페르소나를 만들 때, 고른 사람의 메시지와 바로 앞 맥락이 **고른 LLM 제공자에게 전송**됩니다.
- 공유 코드를 만들 때만 페르소나 파일이 공유 서버에 올라갑니다(HTTPS, 30일 뒤 삭제).

## 개발

```
npm install
npm start           # 개발 실행
npm test            # 파서·그래프·공유 검사 (LLM 호출 없음)
node server/test.mjs  # 공유 서버 로컬 검사
npm run dist        # dist/<버전>/Persona Chat x.y.z.exe (설치 없이 실행하는 portable)
npm run dist:setup  # dist/<버전>/Persona Chat Setup x.y.z.exe (설치 파일)
npm run icon        # renderer/icon.svg → 아이콘 PNG
```

`npm install`에서 Electron 바이너리가 안 받아지면 `node node_modules/electron/install.js`를 한 번 실행하세요.

### 구조

- `src/main.js` 메인 프로세스: 저장, IPC, LLM 호출. 키는 renderer로 보내지 않습니다.
- `src/parsers.js` 대화 파일 파서(카카오톡 txt·csv, 인스타그램 HTML·JSON·zip, 디스코드 DCE JSON·CSV·데이터 패키지)
- `src/graph.js` 페르소나 지식 그래프(요약·말투·성격·말버릇·주변 사람·기억·키워드)와 글자 2-gram 검색
- `src/llm.js` Anthropic / OpenAI / Gemini 스트리밍, `src/cli.js` Claude Code / Codex CLI 실행
- `src/cloud.js` 공유 서버 클라이언트(앱에 넣은 자체 서명 인증서만 신뢰)
- `renderer/` 화면(프레임워크 없음), `server/` 공유 코드 서버(Node 표준 라이브러리만)
