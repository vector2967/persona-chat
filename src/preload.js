const { contextBridge, ipcRenderer } = require('electron');

// 에러는 "Error invoking remote method 'x': Error: 메시지" 형태로 오므로 메시지만 남긴다
const call = (ch, ...a) => ipcRenderer.invoke(ch, ...a).catch(err => { throw new Error(String(err.message).replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '')); });
const on = ch => fn => { const l = (e, v) => fn(v); ipcRenderer.on(ch, l); return () => ipcRenderer.off(ch, l); };

contextBridge.exposeInMainWorld('api', {
  getSettings: () => call('settings:get'),
  setSettings: s => call('settings:set', s),
  listModels: provider => call('models:list', provider),
  checkCli: provider => call('cli:check', provider),
  openImport: append => call('import:open', append),
  importDiscord: token => call('import:discord', token),
  pickConversations: keys => call('import:pick', keys),
  build: args => call('persona:build', args),
  listPersonas: () => call('persona:list'),
  getPersona: id => call('persona:get', id),
  savePersona: p => call('persona:save', p),
  deletePersona: id => call('persona:delete', id),
  exportPersona: args => call('persona:export', args),
  importPersona: () => call('persona:importShared'),
  uploadPersona: args => call('persona:upload', args),
  unsharePersona: args => call('persona:unshare', args),
  downloadPersona: code => call('persona:download', code),
  listChats: personaId => call('chat:list', personaId),
  createChat: args => call('chat:create', args),
  getChat: id => call('chat:get', id),
  inviteToChat: args => call('chat:invite', args),
  renameChat: args => call('chat:rename', args),
  deleteChat: id => call('chat:delete', id),
  send: args => call('chat:send', args),
  onBubbles: on('chat:bubbles'),
  onProgress: on('progress'),
});
