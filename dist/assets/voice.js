(() => {
  const $ = (id) => document.getElementById(id);
  let recorder, stream, recordId = "", playbackUrl = "", generation = 0;
  const status = (text) => { $("voice-status").textContent = text; };
  const supported = /\.(webm|mp3|mp4|m4a|mpeg|mpga|wav|ogg|flac)$/i;
  function resetStream() { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; recorder = null; $("voice-record").disabled = false; $("voice-pause").disabled = true; $("voice-stop").disabled = true; $("voice-pause").textContent = "Pause"; }
  window.voiceOpen = (id) => {
    generation++;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    resetStream(); recordId = id;
    $("voice-controls").hidden = !id;
    $("voice-help").textContent = id ? "Audio is saved locally before transcription (5 MB maximum). Review the transcript before adding it to notes." : "Save this entry first to record or import audio. Audio is saved locally before transcription (5 MB maximum).";
    $("voice-review").value = ""; status("");
    if (!id) window.voiceFiles([]);
  };
  window.voiceFiles = (files) => {
    const select = $("voice-files"), old = select.value;
    select.replaceChildren();
    for (const f of files.filter(f => !f.deleted && supported.test(f.name))) select.add(new Option(f.name, f.id));
    if ([...select.options].some(o => o.value === old)) select.value = old;
    loadPlayback();
  };
  async function loadPlayback() {
    const selected = $("voice-files").value;
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    playbackUrl = ""; $("voice-player").removeAttribute("src");
    if (!selected) return;
    try {
      const response = await fetch(`/api/attachments/${encodeURIComponent(selected)}/download`);
      if (!response.ok) throw Error("Could not load saved audio.");
      const blob = await response.blob();
      if ($("voice-files").value !== selected) return;
      const ext = $("voice-files").selectedOptions[0].textContent.split(".").pop().toLowerCase();
      const type = { webm:"audio/webm", mp3:"audio/mpeg", mp4:"audio/mp4", m4a:"audio/mp4", mpeg:"audio/mpeg", mpga:"audio/mpeg", wav:"audio/wav", ogg:"audio/ogg", flac:"audio/flac" }[ext];
      playbackUrl = URL.createObjectURL(new Blob([blob], { type })); $("voice-player").src = playbackUrl;
    } catch (e) { status(e.message); }
  }
  async function saveFile(file, id) {
    if (!file.size || file.size > 5 * 1024 * 1024) throw Error("Choose audio between 1 byte and 5 MB.");
    if (!supported.test(file.name)) throw Error("Choose a supported audio file: webm, mp3, mp4, m4a, mpeg, mpga, wav, ogg or flac.");
    const bytes = new Uint8Array(await file.arrayBuffer()); let binary = "";
    for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    const saved = await api("/api/attachments", { method: "POST", data: { recordId: id, name: file.name, contentBase64: btoa(binary) } });
    if (recordId === id && $("record-dialog").open) { await loadAttachments(id); $("voice-files").value = saved.id; await loadPlayback(); status("Audio saved. You can replay or transcribe it now."); }
  }
  $("voice-record").onclick = async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw Error("Recording is unavailable in this browser or insecure context. Import an audio file instead.");
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
        catch (e) { status(e.message); }
      };
      recorder.start(); $("voice-record").disabled = true; $("voice-pause").disabled = false; $("voice-stop").disabled = false; status("Recording…");
    } catch (e) { resetStream(); status(e.message); }
  };
  $("voice-pause").onclick = () => { if (!recorder) return; if (recorder.state === "recording") { recorder.pause(); $("voice-pause").textContent = "Resume"; status("Paused."); } else if (recorder.state === "paused") { recorder.resume(); $("voice-pause").textContent = "Pause"; status("Recording…"); } };
  $("voice-stop").onclick = () => { if (recorder && recorder.state !== "inactive") { $("voice-stop").disabled = true; recorder.stop(); status("Saving audio…"); } };
  $("voice-import").onchange = async e => { const file = e.target.files[0]; if (!file) return; try { await saveFile(file, recordId); } catch (err) { status(err.message); } finally { e.target.value = ""; } };
  $("voice-files").onchange = loadPlayback;
  $("voice-transcribe").onclick = async () => {
    const attachmentId = $("voice-files").value, id = recordId;
    if (!attachmentId) return status("Save or select audio first.");
    const button = $("voice-transcribe"); button.disabled = true; status("Transcribing saved audio…");
    try { const result = await api("/api/voice/transcribe", { method: "POST", data: { recordId: id, attachmentId } }); if (recordId === id && $("record-dialog").open) { $("voice-review").value = result.text; status("Review and edit the transcript before adding it to notes."); } }
    catch (e) { status(e.message); } finally { button.disabled = false; }
  };
  $("voice-append").onclick = () => { const text = $("voice-review").value.trim(); if (!text) return status("There is no transcript to add."); const notes = $("record-body"); notes.value += (notes.value.trim() ? "\n\n" : "") + text; $("voice-review").value = ""; status("Transcript added to notes. Save the entry to keep it."); };
  $("record-dialog").addEventListener("close", () => { generation++; if (recorder && recorder.state !== "inactive") recorder.stop(); resetStream(); });
})();
