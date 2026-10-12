# 공유 서버 (persona-share)

앱의 "공유 코드"를 처리하는 작은 HTTPS 서버. 표준 라이브러리만 쓰고, 서버 Node가 v10이라 최신 문법(?. ?? matchAll)을 쓰지 않는다.
페르소나 파일을 올리면 8자리 코드를 주고 30일 보관한다. IP별 시간당 업로드 30회·조회 300회 제한, 본문 20MB 제한.

서버: `/opt/persona-share/` 아래에 둔다. 접속 정보·배포 명령은 레포에 두지 않고 로컬 `server/DEPLOY.local.md`(gitignore)에 있다.
- `/opt/persona-share/server.js`, 데이터 `data/<코드>.json`, 인증서 `tls/`(자체 서명, IP SAN, 2036년까지)
- systemd `persona-share.service`(이 폴더에 사본), 전용 사용자 `persona-share`, 포트 8788. Caddy·pm2·다른 서비스와 무관
- 앱은 `tls/cert.pem`을 `src/share-server.pem`으로 넣어 이 인증서만 믿는다. 인증서를 다시 만들면 앱도 다시 빌드해야 기존 앱이 연결된다

```
node server/test.mjs   # 로컬 검사(http, 임시 폴더)
```
