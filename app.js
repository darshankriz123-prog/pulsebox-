(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const audio = $('audio');
  const state = { tracks: [], currentId: null, shuffle: false, repeat: false, video: null, output: null, converting: false, ffmpeg: null, loadingFFmpeg: null, view: 'home' };
  let dbPromise;
  let toastTimer;

  function openDB() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('pulsebox-library', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('tracks', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return dbPromise;
  }
  async function dbAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => { const tx = db.transaction('tracks', 'readonly'); const req = tx.objectStore('tracks').getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  }
  async function dbPut(track) {
    const db = await openDB();
    return new Promise((resolve, reject) => { const tx = db.transaction('tracks', 'readwrite'); tx.objectStore('tracks').put(track); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  }
  async function dbDelete(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => { const tx = db.transaction('tracks', 'readwrite'); tx.objectStore('tracks').delete(id); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
  }
  function toast(message) { const el = $('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3200); }
  function fmtTime(seconds) { if (!Number.isFinite(seconds)) return '0:00'; const s = Math.floor(seconds); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  function fmtSize(bytes) { return bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`; }
  function baseName(name) { return name.replace(/\.[^.]+$/, ''); }
  function titleOf(track) { return baseName(track.name).replace(/[_-]+/g, ' ').trim(); }
  function currentTrack() { return state.tracks.find(t => t.id === state.currentId); }
  function setView(name) { state.view = name; document.querySelectorAll('.view').forEach(el => el.classList.toggle('active', el.id === `${name}-view`)); document.querySelectorAll('.nav-link').forEach(el => el.classList.toggle('active', el.dataset.view === name)); $('crumb').innerHTML = `${name.toUpperCase()} <span>/</span> ${name === 'convert' ? 'CREATE' : 'LISTEN'}`; window.scrollTo({ top: 0, behavior: 'smooth' }); }

  function renderTrack(track) {
    const row = document.createElement('div'); row.className = `track-row${track.id === state.currentId ? ' current' : ''}`;
    const main = document.createElement('button'); main.className = 'track-main'; main.setAttribute('aria-label', `Play ${titleOf(track)}`);
    const art = document.createElement('span'); art.className = 'track-art'; art.textContent = '♫';
    const copy = document.createElement('span'); copy.className = 'track-text';
    const title = document.createElement('span'); title.className = 'track-title'; title.textContent = titleOf(track);
    const sub = document.createElement('span'); sub.className = 'track-sub'; sub.textContent = track.origin === 'converted' ? 'Converted in Pulsebox' : 'Your music';
    copy.append(title, sub); main.append(art, copy); main.onclick = () => playTrack(track.id);
    const type = document.createElement('span'); type.className = 'track-type'; type.textContent = track.name.split('.').pop().toUpperCase();
    const duration = document.createElement('span'); duration.className = 'track-time'; duration.textContent = track.duration ? fmtTime(track.duration) : '—';
    const remove = document.createElement('button'); remove.className = 'icon-button track-remove'; remove.textContent = '×'; remove.title = 'Remove from library'; remove.setAttribute('aria-label', `Remove ${titleOf(track)}`); remove.onclick = event => { event.stopPropagation(); removeTrack(track.id); };
    row.append(main, type, duration, remove); return row;
  }
  function renderList(container, tracks) {
    container.replaceChildren();
    if (!tracks.length) { const empty = document.createElement('div'); empty.className = 'empty-state'; empty.innerHTML = '<span>♫</span><strong>No tracks here yet</strong><p>Add audio files to start your collection.</p>'; const btn = document.createElement('button'); btn.className = 'btn btn-primary btn-small'; btn.textContent = '＋ Add music'; btn.onclick = () => $('audio-input').click(); empty.append(btn); container.append(empty); return; }
    tracks.forEach(track => container.append(renderTrack(track)));
  }
  function render() {
    const count = state.tracks.length;
    $('nav-count').textContent = count; $('home-count').textContent = `${count} track${count === 1 ? '' : 's'}`; $('library-count').textContent = `${count} track${count === 1 ? '' : 's'}`;
    renderList($('home-tracks'), state.tracks.slice(0, 5));
    const query = $('search').value.trim().toLowerCase(); renderList($('library-tracks'), state.tracks.filter(t => titleOf(t).toLowerCase().includes(query)));
    const track = currentTrack(); $('playing-title').textContent = track ? titleOf(track) : 'Nothing playing yet'; $('playing-subtitle').textContent = track ? (track.origin === 'converted' ? 'Converted in Pulsebox' : 'Your music') : 'Add a track to get started'; $('remove-current').disabled = !track; $('player-art').style.background = track ? '#405030' : ''; $('play').textContent = audio.paused ? '▶' : '❚❚'; $('play').setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
    $('shuffle').classList.toggle('on', state.shuffle); $('repeat').classList.toggle('on', state.repeat);
  }
  async function getDuration(file) {
    return new Promise(resolve => { const temp = document.createElement('audio'); const url = URL.createObjectURL(file); const done = () => { const value = Number.isFinite(temp.duration) ? temp.duration : 0; temp.src = ''; URL.revokeObjectURL(url); resolve(value); }; temp.onloadedmetadata = done; temp.onerror = done; temp.src = url; });
  }
  async function addAudioFiles(files, origin = 'imported') {
    let added = 0;
    for (const file of files) {
      if (!(file.type.startsWith('audio/') || /\.(mp3|m4a|wav|ogg|flac|aac|opus)$/i.test(file.name))) { toast(`Skipped ${file.name}: choose an audio file`); continue; }
      const track = { id: crypto.randomUUID(), name: file.name, blob: file, type: file.type || 'audio/mpeg', size: file.size, duration: await getDuration(file), origin, addedAt: Date.now() };
      try { await dbPut(track); state.tracks.unshift(track); added++; } catch (err) { console.error(err); toast('Browser storage is full or unavailable'); break; }
    }
    render(); if (added) toast(`Added ${added} track${added === 1 ? '' : 's'} to your library`);
    return added;
  }
  let playingURL = null;
  async function playTrack(id) {
    const track = state.tracks.find(t => t.id === id); if (!track) return;
    if (playingURL) URL.revokeObjectURL(playingURL);
    playingURL = URL.createObjectURL(track.blob); audio.src = playingURL; state.currentId = id;
    try { await audio.play(); } catch (err) { console.error(err); toast('This audio format could not be played here'); }
    render();
  }
  function togglePlay() { if (!currentTrack()) { if (state.tracks.length) playTrack(state.tracks[0].id); else $('audio-input').click(); return; } if (audio.paused) audio.play().catch(() => toast('Unable to play this track')); else audio.pause(); render(); }
  function stepTrack(direction) { if (!state.tracks.length) return; if (state.shuffle && state.tracks.length > 1) { const choices = state.tracks.filter(t => t.id !== state.currentId); return playTrack(choices[Math.floor(Math.random() * choices.length)].id); } const index = state.tracks.findIndex(t => t.id === state.currentId); const next = (index + direction + state.tracks.length) % state.tracks.length; playTrack(state.tracks[next].id); }
  async function removeTrack(id) { if (state.currentId === id) { audio.pause(); audio.removeAttribute('src'); audio.load(); if (playingURL) URL.revokeObjectURL(playingURL); playingURL = null; state.currentId = null; } try { await dbDelete(id); state.tracks = state.tracks.filter(t => t.id !== id); render(); toast('Removed from your library'); } catch (err) { console.error(err); toast('Could not remove this track'); } }

  function chooseVideo(file) {
    if (!file) return; if (!(file.type === 'video/mp4' || /\.mp4$/i.test(file.name))) { toast('Please choose an MP4 video'); return; }
    state.video = file; state.output = null; $('selected-file').classList.remove('hidden'); $('dropzone').classList.add('hidden'); $('file-name').textContent = file.name; $('file-size').textContent = fmtSize(file.size); $('convert-button').disabled = false; $('convert-result').classList.add('hidden'); $('convert-error').classList.add('hidden'); setView('convert');
  }
  function resetVideo() { state.video = null; $('video-input').value = ''; $('selected-file').classList.add('hidden'); $('dropzone').classList.remove('hidden'); $('convert-button').disabled = true; $('convert-progress').classList.add('hidden'); $('convert-error').classList.add('hidden'); }
  async function loadVideoURL() {
    const raw = $('video-url').value.trim();
    let url;
    try { url = new URL(raw); if (!['https:', 'http:'].includes(url.protocol)) throw new Error(); } catch { $('convert-error').textContent = 'Enter a valid http or https video URL.'; $('convert-error').classList.remove('hidden'); return; }
    if (['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com','youtu.be'].includes(url.hostname.toLowerCase())) { await convertYoutubeURL(url); return; }
    $('load-url').disabled = true; $('convert-error').classList.add('hidden'); showProgress('Downloading video…', .02);
    try {
      const response = await fetch(url.href);
      if (!response.ok) throw new Error(`Video download failed (HTTP ${response.status}).`);
      const length = Number(response.headers.get('content-length'));
      if (length > 500 * 1048576) throw new Error('This video is too large for browser conversion (500 MB limit).');
      const blob = await response.blob();
      if (blob.size > 500 * 1048576) throw new Error('This video is too large for browser conversion (500 MB limit).');
      if (!/video\/mp4/i.test(blob.type) && !/\.mp4$/i.test(url.pathname)) throw new Error('The link does not appear to point directly to an MP4 file.');
      const name = decodeURIComponent(url.pathname.split('/').pop() || 'linked-video.mp4').replace(/[^\w. -]/g, '_');
      chooseVideo(new File([blob], /\.mp4$/i.test(name) ? name : `${name}.mp4`, { type: 'video/mp4' }));
      await convertVideo();
    } catch (err) { console.error(err); $('convert-error').textContent = err instanceof TypeError ? 'This video host blocks browser downloads. Try another direct MP4 link or save the file first.' : err.message; $('convert-error').classList.remove('hidden'); $('convert-progress').classList.add('hidden'); }
    finally { $('load-url').disabled = false; }
  }
  async function convertYoutubeURL(url) {
    $('load-url').disabled = true; $('convert-error').classList.add('hidden'); $('convert-result').classList.add('hidden'); showProgress('Fetching YouTube audio…', .03);
    let ffmpeg;
    const stamp = Date.now();
    let inputName;
    const outputName = `youtube-${stamp}.mp3`;
    try {
      const base = (window.PULSEBOX_API_BASE || '').replace(/\/$/, '');
      const response = await fetch(`${base}/api/convert`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.href }) });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || `YouTube service returned HTTP ${response.status}`); }
      const source = new Uint8Array(await response.arrayBuffer());
      if (!source.length) throw new Error('The YouTube service returned no audio.');
      const ext = response.headers.get('X-Source-Ext') === 'webm' ? 'webm' : 'm4a';
      inputName = `youtube-${stamp}.${ext}`;
      ffmpeg = await getFFmpeg(); showProgress('Converting YouTube audio…', .12);
      await ffmpeg.writeFile(inputName, source);
      const code = await ffmpeg.exec(['-i', inputName, '-vn', '-acodec', 'libmp3lame', '-b:a', $('quality').value, outputName]);
      if (code !== 0) throw new Error('Could not convert this YouTube audio.');
      const bytes = await ffmpeg.readFile(outputName);
      if (!bytes.length) throw new Error('The converted MP3 is empty.');
      const videoId = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v');
      const mp3 = new File([bytes], `${videoId || 'youtube-audio'}.mp3`, { type: 'audio/mpeg' });
      state.output = mp3; await addAudioFiles([mp3], 'converted');
      showProgress('Finished', 1); $('result-name').textContent = mp3.name; $('convert-result').classList.remove('hidden'); toast('YouTube MP3 ready — added to your library');
    } catch (err) { console.error(err); $('convert-error').textContent = err.message || 'YouTube conversion failed. Check that the local service is running.'; $('convert-error').classList.remove('hidden'); $('convert-progress').classList.add('hidden'); }
    finally { if (ffmpeg && inputName) { await ffmpeg.deleteFile(inputName).catch(() => {}); await ffmpeg.deleteFile(outputName).catch(() => {}); } $('load-url').disabled = false; }
  }
  function showProgress(label, fraction) { $('convert-progress').classList.remove('hidden'); $('progress-label').textContent = label; const value = Math.max(0, Math.min(100, Math.round(fraction * 100))); $('progress-value').textContent = `${value}%`; $('progress-fill').style.width = `${value}%`; }
  async function getFFmpeg() {
    if (state.ffmpeg) return state.ffmpeg;
    if (state.loadingFFmpeg) return state.loadingFFmpeg;
    state.loadingFFmpeg = (async () => {
      showProgress('Loading audio engine…', .05);
      const ffmpeg = new FFmpegWASM.FFmpeg();
      ffmpeg.on('progress', ({ progress }) => showProgress('Extracting audio…', .12 + Math.max(0, Math.min(1, progress)) * .82));
      const coreURL = new URL('vendor/ffmpeg-core.js', location.href).href;
      let wasmURL = new URL('vendor/ffmpeg-core.wasm', location.href).href;
      const localWasm = await fetch(wasmURL, { method: 'HEAD' }).catch(() => null);
      if (!localWasm?.ok) {
        const remote = await fetch('https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd/ffmpeg-core.wasm');
        if (!remote.ok) throw new Error('Could not load the audio engine. Check your internet connection.');
        wasmURL = URL.createObjectURL(new Blob([await remote.arrayBuffer()], { type: 'application/wasm' }));
      }
      await ffmpeg.load({ coreURL, wasmURL });
      state.ffmpeg = ffmpeg; return ffmpeg;
    })();
    try { return await state.loadingFFmpeg; } finally { state.loadingFFmpeg = null; }
  }
  async function convertVideo() {
    if (!state.video || state.converting) return;
    state.converting = true; $('convert-button').disabled = true; $('convert-result').classList.add('hidden'); $('convert-error').classList.add('hidden');
    const file = state.video; const inputName = `input-${Date.now()}.mp4`; const outputName = `output-${Date.now()}.mp3`;
    let ffmpeg;
    try {
      ffmpeg = await getFFmpeg(); showProgress('Reading video…', .1);
      await ffmpeg.writeFile(inputName, new Uint8Array(await file.arrayBuffer()));
      showProgress('Extracting audio…', .12);
      const code = await ffmpeg.exec(['-i', inputName, '-vn', '-acodec', 'libmp3lame', '-b:a', $('quality').value, outputName]);
      if (code !== 0) throw new Error('Conversion failed. The MP4 may not contain a supported audio stream.');
      const bytes = await ffmpeg.readFile(outputName);
      if (!bytes.length) throw new Error('No audio was found in this MP4.');
      const mp3 = new File([bytes], `${baseName(file.name)}.mp3`, { type: 'audio/mpeg' });
      state.output = mp3;
      await addAudioFiles([mp3], 'converted');
      showProgress('Finished', 1); $('result-name').textContent = mp3.name; $('convert-result').classList.remove('hidden');
      toast('MP3 ready — added to your library');
    } catch (err) {
      console.error(err);
      $('convert-error').textContent = err.message || 'Conversion failed. Try another MP4 file.';
      $('convert-error').classList.remove('hidden');
      $('convert-progress').classList.add('hidden');
    } finally {
      if (ffmpeg) { await ffmpeg.deleteFile(inputName).catch(() => {}); await ffmpeg.deleteFile(outputName).catch(() => {}); }
      state.converting = false; $('convert-button').disabled = !state.video;
    }
  }
  function downloadResult() { if (!state.output) return; const url = URL.createObjectURL(state.output); const a = document.createElement('a'); a.href = url; a.download = state.output.name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
  function bind() {
    document.querySelectorAll('[data-view]').forEach(el => el.onclick = () => setView(el.dataset.view));
    [['hero-add','audio-input'],['add-top','audio-input'],['library-add','audio-input']].forEach(([button,input]) => $(button).onclick = () => $(input).click());
    [['hero-convert','convert'],['banner-convert','convert'],['see-all','library'],['open-library','library']].forEach(([button,view]) => $(button).onclick = () => setView(view));
    $('audio-input').onchange = event => { addAudioFiles([...event.target.files]); event.target.value = ''; };
    $('search').oninput = render;
    $('play').onclick = togglePlay; $('previous').onclick = () => stepTrack(-1); $('next').onclick = () => stepTrack(1);
    $('shuffle').onclick = () => { state.shuffle = !state.shuffle; render(); }; $('repeat').onclick = () => { state.repeat = !state.repeat; render(); };
    $('remove-current').onclick = () => { if (state.currentId) removeTrack(state.currentId); };
    $('seek').oninput = event => { if (Number.isFinite(audio.duration)) audio.currentTime = audio.duration * Number(event.target.value) / 100; };
    $('volume').oninput = event => { audio.volume = Number(event.target.value) / 100; audio.muted = false; $('mute').textContent = audio.volume === 0 ? '◖' : '◖))'; };
    $('mute').onclick = () => { audio.muted = !audio.muted; $('mute').textContent = audio.muted ? '◖' : '◖))'; };
    audio.ontimeupdate = () => { $('current-time').textContent = fmtTime(audio.currentTime); $('duration').textContent = fmtTime(audio.duration); $('seek').value = Number.isFinite(audio.duration) && audio.duration ? String(audio.currentTime / audio.duration * 100) : '0'; };
    audio.onplay = render; audio.onpause = render; audio.onended = () => { if (state.repeat) { audio.currentTime = 0; audio.play(); } else { const index = state.tracks.findIndex(t => t.id === state.currentId); if (index >= 0 && index < state.tracks.length - 1) stepTrack(1); else render(); } };
    $('dropzone').onclick = () => $('video-input').click(); $('dropzone').onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); $('video-input').click(); } };
    $('video-input').onchange = event => chooseVideo(event.target.files[0]);
    $('dropzone').ondragover = event => { event.preventDefault(); $('dropzone').classList.add('dragging'); };
    $('dropzone').ondragleave = () => $('dropzone').classList.remove('dragging');
    $('dropzone').ondrop = event => { event.preventDefault(); $('dropzone').classList.remove('dragging'); chooseVideo(event.dataTransfer.files[0]); };
    document.body.ondragover = event => { if ([...event.dataTransfer.types].includes('Files')) event.preventDefault(); };
    document.body.ondrop = event => { if (!event.target.closest('#dropzone') && event.dataTransfer.files.length) { event.preventDefault(); const files = [...event.dataTransfer.files]; const videos = files.filter(f => /\.mp4$/i.test(f.name)); const audios = files.filter(f => !videos.includes(f)); if (audios.length) addAudioFiles(audios); if (videos.length) chooseVideo(videos[0]); } };
    $('remove-video').onclick = resetVideo; $('convert-button').onclick = convertVideo; $('download-result').onclick = downloadResult;
    $('load-url').onclick = loadVideoURL; $('video-url').onkeydown = event => { if (event.key === 'Enter') loadVideoURL(); };
  }
  async function init() {
    bind(); audio.volume = .8;
    try { state.tracks = (await dbAll()).sort((a,b) => b.addedAt - a.addedAt); } catch (err) { console.error(err); toast('Library storage is unavailable in this browser'); }
    render();
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('service-worker.js').catch(console.error);
  }
  init();
})();

