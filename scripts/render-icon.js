// npx electron scripts/render-icon.js — renderer/icon.svg를 PNG로 굽는다(투명 배경).
//   build/icon.png(512): electron-builder가 설치 파일·exe 아이콘(ico)으로 바꿔 쓴다
//   renderer/icon.png(256): 개발 실행 창 아이콘
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(root, 'renderer', 'icon.svg'), 'utf8');
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<canvas></canvas>');
  for (const [size, out] of [[512, 'build/icon.png'], [256, 'renderer/icon.png']]) {
    const dataUrl = await win.webContents.executeJavaScript(`new Promise(r => {
      const img = new Image();
      img.onload = () => { const c = document.querySelector('canvas'); c.width = c.height = ${size};
        c.getContext('2d').drawImage(img, 0, 0, ${size}, ${size}); r(c.toDataURL('image/png')); };
      img.src = 'data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}';
    })`);
    fs.mkdirSync(path.dirname(path.join(root, out)), { recursive: true });
    fs.writeFileSync(path.join(root, out), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log('wrote', out);
  }
  app.quit();
});
