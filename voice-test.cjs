const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createVoice, endpoint } = require('./voice.cjs');
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-voice-'));
  try {
    fs.mkdirSync(path.join(directory, 'attachments'));
    const hash = 'a'.repeat(64); fs.writeFileSync(path.join(directory, 'attachments', hash), Buffer.from('audio data'));
    let item = { id:'a', recordId:'r', name:'recording.webm', hash, deleted:null }, calls = 0;
    const store = { db: { prepare: () => ({ get: id => id === 'a' ? { json: JSON.stringify(item) } : undefined }) }, get: (_, id) => id === 'r' ? { id } : null };
    const providers = { config: p => ({ key: p === 'openai' ? 'secret' : '' }) };
    const voice = createVoice({ directory, store, providers, fetchImpl: async (url, options) => {
      calls++; assert.equal(url, 'http://127.0.0.1:9000/v1/audio/transcriptions'); assert.equal(options.redirect, 'error');
      assert.equal(options.body.get('model'), 'whisper-1'); assert.equal(await options.body.get('file').text(), 'audio data');
      return { ok:true, json: async () => ({ text:'hello world' }) };
    }});
    const data = { recordId:'r', attachmentId:'a', target:'local', base:'http://127.0.0.1:9000/v1', model:'whisper-1' };
    assert.deepEqual(await voice.transcribe(data), { text:'hello world' });
    for (const base of ['http://example.com/v1','http://127.0.0.1.evil.test/v1','http://user@localhost/v1']) assert.throws(() => endpoint(base));
    await assert.rejects(voice.transcribe({ ...data, recordId:'wrong' }));
    await assert.rejects(voice.transcribe({ ...data, target:'openai' }));
    item.deleted = 'now'; await assert.rejects(voice.transcribe(data));
    assert.equal(calls, 1);
    console.log('Voice tests passed');
  } finally { fs.rmSync(directory, { recursive:true, force:true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
