(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  let recorder, stream, recordId = "", generation = 0, files = [], pending = null;
  const urls = new Map();
  const status = (text) => { $("voice-status").textContent = text; };
  const supported = /\.(webm|mp3|mp4|m4a|mpeg|mpga|wav|ogg|flac)$/i;
  const mimes = { webm: "audio/webm", mp3: "audio/mpeg", mp4: "audio/mp4", m4a: "audio/mp4", mpeg: "audio/mpeg", mpga: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac" };
  const size = (n) => (n < 1024 * 1024 ? Math.max(1, Math.ceil(n / 1024)) + " KB" : fmt.num(n / 1024 / 1024, 1) + " MB");
  const clock = (s) => Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
  function revokeUrls() { for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); }
  function setRecording(on) { $("voice-controls").classList.toggle("recording", on); }
  function resetStream() { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; recorder = null; setRecording(false); $("voice-record").disabled = false; $("voice-pause").disabled = true; $("voice-stop").disabled = true; $("voice-pause").textContent = tx("Pause"); }
  function clearTranscript() { pending = null; $("voice-review").value = ""; $("voice-transcript").hidden = true; }
  window.voiceOpen = (id) => {
    generation++;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    resetStream(); revokeUrls(); clearTranscript(); recordId = id; files = [];
    $("voice-controls").hidden = !id;
    status("");
    renderFiles();
  };
  window.voiceFiles = (list) => { files = list; renderFiles(); };
  function rowMarkup(f) {
    const audio = !f.deleted && supported.test(f.name),
      meta = [size(f.size), f.textReadable ? tx("Readable text") : audio ? "" : tx("Download only"), f.deleted ? tx("Trashed") : ""].filter(Boolean).join(" · ");
    const menu = f.deleted
      ? `<button type="button" class="text-button" data-restore-file="${esc(f.id)}">${tx("Restore")}</button>`
      : `<details class="menu row-menu"><summary aria-label="${tx("Actions for {name}", { name: esc(f.name) })}">⋯</summary><div class="menu-list">${audio ? `<button type="button" data-voice-transcribe="${esc(f.id)}">${tx("Transcribe")}</button>` : ""}${pending?.id === f.id ? `<button type="button" data-voice-notes>${tx("Add transcript to notes")}</button>` : ""}<a href="/api/attachments/${encodeURIComponent(f.id)}/download">${tx("Download")}</a><button type="button" class="menu-danger" data-trash-file="${esc(f.id)}">${tx("Move to trash")}</button></div></details>`;
    return `<div class="file-row${f.deleted ? " gone" : ""}" data-file="${esc(f.id)}"><div class="file-main"><span class="file-name">${esc(f.name)}</span><small>${esc(meta)}<span class="file-dur" data-dur="${esc(f.id)}"></span></small>${audio ? `<audio controls preload="metadata" data-audio="${esc(f.id)}"></audio>` : ""}</div>${menu}</div>`;
  }
  function renderFiles() {
    $("attachment-list").innerHTML = files.length ? files.map(rowMarkup).join("") : recordId ? `<p class="hint">${tx("Nothing here yet. Record audio or add a file.")}</p>` : "";
    for (const f of files) if (!f.deleted && supported.test(f.name)) loadAudio(f);
  }
  async function loadAudio(f) {
    const mine = generation, el = () => document.querySelector(`audio[data-audio="${CSS.escape(f.id)}"]`);
    try {
      if (!urls.has(f.id)) {
        const response = await fetch(`/api/attachments/${encodeURIComponent(f.id)}/download`);
        if (!response.ok) throw Error(tx("Could not load saved audio."));
        const blob = await response.blob();
        if (mine !== generation) return;
        urls.set(f.id, URL.createObjectURL(new Blob([blob], { type: mimes[f.name.split(".").pop().toLowerCase()] })));
      }
      const audio = el();
      if (!audio) return;
      audio.onloadedmetadata = () => { const d = document.querySelector(`[data-dur="${CSS.escape(f.id)}"]`); if (d && isFinite(audio.duration)) d.textContent = " · " + clock(audio.duration); };
      audio.src = urls.get(f.id);
    } catch (e) { status(tx(e.message)); }
  }
  async function saveFile(file, id) {
    if (!file.size || file.size > 5 * 1024 * 1024) throw Error(tx("Choose audio between 1 byte and 5 MB."));
    if (!supported.test(file.name)) throw Error(tx("Choose a supported audio file: webm, mp3, mp4, m4a, mpeg, mpga, wav, ogg or flac."));
    const bytes = new Uint8Array(await file.arrayBuffer()); let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    await api("/api/attachments", { method: "POST", data: { recordId: id, name: file.name, contentBase64: btoa(binary) } });
    if (recordId === id) { await loadAttachments(id); status(tx("Audio saved. Use ⋯ on the row to transcribe it.")); }
  }
  $("voice-record").onclick = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw Error(tx("Recording is unavailable in this browser or insecure context. Add an audio file instead."));
      const id = recordId, currentGeneration = generation;
      $("voice-record").disabled = true;
      const acquired = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (generation !== currentGeneration) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream = acquired;
      const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(t => MediaRecorder.isTypeSupported(t));
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      const activeRecorder = recorder, capturedChunks = [];
      activeRecorder.ondataavailable = e => { if (e.data.size) capturedChunks.push(e.data); };
      activeRecorder.onstop = async () => {
        const blob = new Blob(capturedChunks, { type: activeRecorder.mimeType || mime || "audio/webm" });
        const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
        if (recorder === activeRecorder) resetStream();
        try { if (blob.size) await saveFile(new File([blob], `Recording-${Date.now()}.${ext}`, { type: blob.type }), id); }
        catch (e) { status(tx(e.message)); }
      };
      recorder.start(); setRecording(true); $("voice-record").disabled = true; $("voice-pause").disabled = false; $("voice-stop").disabled = false; status(tx("Recording…"));
    } catch (e) { resetStream(); status(tx(e.message)); }
  };
  $("voice-pause").onclick = () => { if (!recorder) return; if (recorder.state === "recording") { recorder.pause(); setRecording(false); $("voice-pause").textContent = tx("Resume"); status(tx("Paused.")); } else if (recorder.state === "paused") { recorder.resume(); setRecording(true); $("voice-pause").textContent = tx("Pause"); status(tx("Recording…")); } };
  $("voice-stop").onclick = () => { if (recorder && recorder.state !== "inactive") { $("voice-stop").disabled = true; recorder.stop(); status(tx("Saving audio…")); } };
  async function transcribe(attachmentId) {
    const id = recordId, file = files.find((f) => f.id === attachmentId);
    status(tx("Transcribing {name}…", { name: file?.name || tx("audio") }));
    try {
      const result = await api("/api/voice/transcribe", { method: "POST", data: { recordId: id, attachmentId } });
      if (recordId === id) {
        pending = { id: attachmentId };
        $("voice-review").value = result.text;
        $("voice-transcript-label").textContent = tx("Transcript of {name}. Review and edit before adding it to notes.", { name: file?.name || tx("audio") });
        $("voice-transcript").hidden = false;
        $("voice-review").focus();
        status("");
        renderFiles();
      }
    } catch (e) { status(tx(e.message)); }
  }
  function addToNotes() {
    const text = $("voice-review").value.trim();
    if (!text) return status(tx("There is no transcript to add."));
    const notes = $("record-body");
    notes.value += (notes.value.trim() ? "\n\n" : "") + text;
    notes.dispatchEvent(new Event("input", { bubbles: true }));
    clearTranscript(); renderFiles();
    status(tx("Transcript added to notes."));
  }
  $("attachment-list").addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (b?.dataset.voiceTranscribe) transcribe(b.dataset.voiceTranscribe);
    else if (b?.hasAttribute("data-voice-notes")) { $("voice-transcript").hidden = false; $("voice-review").focus(); }
  });
  $("voice-append").onclick = addToNotes;
  $("voice-discard").onclick = () => { clearTranscript(); renderFiles(); };
})();
