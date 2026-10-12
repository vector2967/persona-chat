// 3사 LLM 호출(API 키) + 요금제 CLI(cli.js). 모두 스트리밍, 반환은 { text, raw? }.
// messages: [{ role: 'user'|'assistant', content: string, raw?: Anthropic content blocks }]
const Anthropic = require('@anthropic-ai/sdk').default;
const OpenAI = require('openai').default;
const { GoogleGenAI } = require('@google/genai');

const cli = require('./cli');

const DEFAULT_MODELS = { anthropic: 'claude-opus-5-5', openai: 'gpt-5.6-luna', gemini: '', 'claude-cli': 'opus', 'codex-cli': 'gpt-5.6-luna' };
// 안전 분류기가 거절하면 서버가 다른 모델로 자동 재시도(fallbacks: "default")를 지원하는 모델
const FALLBACK = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

// 3사 SDK 에러 모두 .status를 가진다. 흔한 경우만 사람 말로 바꾸고 나머지는 원문 그대로.
const FRIENDLY = {
  400: '요청이 거절됐어요. 모델 ID나 대화 길이를 확인해 주세요.',
  401: 'API 키가 올바르지 않아요. 설정에서 키를 확인해 주세요.',
  403: '이 API 키로는 해당 모델을 쓸 수 없어요.',
  404: '모델을 찾을 수 없어요. 설정에서 "모델 불러오기"로 다시 골라 주세요.',
  429: '요청 한도나 잔액이 부족해요. 잠시 후 다시 시도하거나 결제 상태를 확인해 주세요.',
};
function friendly(e) {
  const status = /API key not valid/.test(e.message) ? 401 : e.status; // Gemini는 잘못된 키에 400을 준다
  const msg = FRIENDLY[status];
  return new Error(msg ? `${msg}\n(${String(e.message).slice(0, 300)})` : e.message);
}
async function run(args) {
  try { return await call(args); } catch (e) { throw friendly(e); }
}

async function call({ provider, model, key, system, messages, onText = () => {}, chat = false, group = false, json = false }) {
  if (cli.CLI[provider]) return cli.run({ provider, model, system, messages, chat, group, onText });
  if (!key) throw new Error('API 키가 없어요. 설정에서 넣어 주세요.');
  if (!model) throw new Error('모델이 비어 있어요. 설정에서 모델을 골라 주세요.');

  if (provider === 'anthropic') {
    const client = new Anthropic({ apiKey: key });
    const params = {
      model,
      max_tokens: chat ? 4096 : 32000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      messages: messages.map(m => ({ role: m.role, content: m.raw ?? m.content })),
    };
    // 채팅은 빠르고 싸게. effort는 Claude 5세대부터 지원
    if (chat && /^claude-\w+-5/.test(model)) params.output_config = { effort: 'low' };
    if (FALLBACK.has(model)) Object.assign(params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    const stream = client.beta.messages.stream(params);
    stream.on('text', onText);
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') throw new Error('모델이 응답을 거절했어요. 다른 말로 다시 시도해 주세요.');
    return { text: final.content.filter(b => b.type === 'text').map(b => b.text).join(''), raw: final.content };
  }

  if (provider === 'openai') {
    const client = new OpenAI({ apiKey: key });
    const stream = await client.chat.completions.create({
      model,
      stream: true,
      messages: [{ role: 'system', content: system }, ...messages.map(m => ({ role: m.role, content: m.content }))],
      ...(json && { response_format: { type: 'json_object' } }),
    });
    let text = '';
    for await (const c of stream) {
      const d = c.choices[0]?.delta?.content;
      if (d) { text += d; onText(d); }
    }
    return { text };
  }

  if (provider === 'gemini') {
    const ai = new GoogleGenAI({ apiKey: key });
    const stream = await ai.models.generateContentStream({
      model,
      contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      config: { systemInstruction: system, ...(json && { responseMimeType: 'application/json' }) },
    });
    let text = '';
    for await (const c of stream) {
      const d = c.text;
      if (d) { text += d; onText(d); }
    }
    return { text };
  }

  throw new Error(`알 수 없는 제공자: ${provider}`);
}

async function listModels(provider, key) {
  try { return await models(provider, key); } catch (e) { throw friendly(e); }
}

async function models(provider, key) {
  if (cli.MODELS[provider]) return cli.MODELS[provider];
  if (!key) throw new Error('먼저 API 키를 저장해 주세요.');
  const ids = [];
  if (provider === 'anthropic') for await (const m of new Anthropic({ apiKey: key }).models.list()) ids.push(m.id);
  if (provider === 'openai') for await (const m of new OpenAI({ apiKey: key }).models.list()) if (/^(gpt|o\d|chatgpt)/.test(m.id)) ids.push(m.id);
  if (provider === 'gemini')
    for await (const m of await new GoogleGenAI({ apiKey: key }).models.list())
      if (m.supportedActions?.includes('generateContent')) ids.push(m.name.replace(/^models\//, ''));
  return ids.sort();
}

module.exports = { run, listModels, DEFAULT_MODELS, checkCli: cli.check, isCli: p => !!cli.CLI[p] };
