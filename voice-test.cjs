const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { createVoice, endpoint } = require('./voice.cjs');
(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spark-voice-'));
  try {
    fs.mkdirSync(path.join(directory, 'attachments'));
    const hash = 'a'.repeat(64); fs.writeFileSync(path.join(directory, 'attachments', hash), Buffer.from('audio data'));
    let item = { id:'a', recordId:'r', name:'recording.webm', hash, deleted:null };
    const store = { db: { prepare: () => ({ get: id => id === 'a' ? { json: JSON.stringify(item) } : undefined }) }, get: (_, id) => id === 'r' ? { id } : null };
    let groqKey = '';
    const providers = { config: p => ({ key: p === 'openai' ? 'secret' : '' }), groq: () => ({ key: groqKey, source: groqKey ? 'local secrets file' : 'none' }), setGroqKey: k => { groqKey = k.trim(); } };
    const calls = []; let localFails = false;
    const make = () => createVoice({ directory, store, providers, fetchImpl: async (url, options) => {
      calls.push({ url, auth: options.headers.Authorization, model: options.body.get('model') });
      assert.equal(options.redirect, 'error'); assert.equal(await options.body.get('file').text(), 'audio data');
      if (url.startsWith('http://127.0.0.1') && localFails) throw new Error('down');
      return { ok:true, json: async () => ({ text:'hello world' }) };
    }});
    let voice = make();
    const data = { recordId:'r', attachmentId:'a' };

    assert.equal(voice.settings().localModel, 'deepdml/faster-whisper-large-v3-turbo-ct2');
    assert.equal(voice.settings().localBase, 'http://127.0.0.1:8000/v1');
    assert.deepEqual(await voice.transcribe(data), { text:'hello world' });
    assert.equal(calls[0].url, 'http://127.0.0.1:8000/v1/audio/transcriptions');
    assert.equal(calls[0].model, 'deepdml/faster-whisper-large-v3-turbo-ct2');

    for (const base of ['http://example.com/v1','http://127.0.0.1.evil.test/v1','http://user@localhost/v1']) { assert.throws(() => endpoint(base)); assert.throws(() => voice.update({ localBase: base })); }
    await assert.rejects(voice.transcribe({ ...data, recordId:'wrong' }));

    voice.update({ target:'groq' });
    await assert.rejects(voice.transcribe(data), /Groq in Settings/);
    voice.update({ groqConsent:true });
    await assert.rejects(voice.transcribe(data), /Groq API key/);
    voice.update({ groqKey:' gk ' });
    assert.equal(voice.settings().groqKeyConfigured, true);
    assert.equal(JSON.stringify(voice.settings()).includes('gk'), false);
    calls.length = 0;
    await voice.transcribe(data);
    assert.deepEqual(calls[0], { url:'https://api.groq.com/openai/v1/audio/transcriptions', auth:'Bearer gk', model:'whisper-large-v3-turbo' });

    voice.update({ target:'openai' });
    await assert.rejects(voice.transcribe(data), /OpenAI in Settings/);
    voice.update({ openaiConsent:true }); calls.length = 0;
    await voice.transcribe(data);
    assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/transcriptions'); assert.equal(calls[0].auth, 'Bearer secret');

    voice.update({ target:'local', fallback:true, fallbackTarget:'groq' });
    localFails = true; calls.length = 0;
    assert.deepEqual(await voice.transcribe(data), { text:'hello world' });
    assert.deepEqual(calls.map(c => c.url), ['http://127.0.0.1:8000/v1/audio/transcriptions', 'https://api.groq.com/openai/v1/audio/transcriptions']);

    voice.update({ fallback:false }); calls.length = 0;
    await assert.rejects(voice.transcribe(data), /could not be reached/);
    assert.equal(calls.length, 1);

    voice.update({ groqConsent:false });
    assert.throws(() => voice.update({ fallback:true, fallbackTarget:'groq' }), /fallback needs consent/);
    voice.update({ fallbackTarget:'openai', fallback:true });
    assert.throws(() => voice.update({ openaiConsent:false }), /fallback needs consent/);

    voice.update({ target:'local', fallback:false }); localFails = false; calls.length = 0;
    const attBefore = fs.readdirSync(path.join(directory, 'attachments')).length, b64 = Buffer.from('audio data').toString('base64');
    assert.deepEqual(await voice.preview({ contentBase64:b64, mimeType:'audio/webm;codecs=opus' }), { text:'hello world' });
    assert.deepEqual(calls.map(c => c.url), ['http://127.0.0.1:8000/v1/audio/transcriptions']);
    await assert.rejects(voice.preview({ contentBase64:b64, mimeType:'text/html' }), /Unsupported audio/);
    await assert.rejects(voice.preview({ contentBase64:'not base64!', mimeType:'audio/webm' }), /too large or invalid/);
    await assert.rejects(voice.preview({ contentBase64:'', mimeType:'audio/webm' }), /too large or invalid/);
    await assert.rejects(voice.preview({ contentBase64:Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64'), mimeType:'audio/webm' }), e => e.status === 413);
    await assert.rejects(voice.preview({ mimeType:'audio/webm' }));
    assert.equal(calls.length, 1);
    for (const target of ['groq', 'openai']) {
      voice.update({ target, groqConsent:true, openaiConsent:true });
      await assert.rejects(voice.preview({ contentBase64:b64, mimeType:'audio/webm' }), e => e.status === 409 && /local transcription/.test(e.message));
    }
    assert.equal(calls.length, 1);
    assert.equal(fs.readdirSync(path.join(directory, 'attachments')).length, attBefore);
    voice.update({ target:'local' });

    voice.update({ target:'local', fallback:false, groqConsent:true, localModel:'m1' });
    voice = make();
    assert.equal(voice.settings().groqConsent, true); assert.equal(voice.settings().localModel, 'm1'); assert.equal(voice.settings().target, 'local');
    assert.throws(() => voice.update({ target:'bogus' }));
    assert.throws(() => voice.update({ groqConsent:'yes' }));

    item.deleted = 'now'; localFails = false; await assert.rejects(voice.transcribe(data));
    console.log('Voice tests passed');
  } finally { fs.rmSync(directory, { recursive:true, force:true }); }
})().catch(e => { console.error(e); process.exitCode = 1; });
