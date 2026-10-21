# Pulsebox

A personal music player and MP4-to-MP3 website prototype. It can play audio files, keep a browser-local library, convert uploaded or direct-link MP4 files to MP3, and convert YouTube links when the local helper is running.

## Try it locally on Windows

1. Right-click `Start-Pulsebox.ps1` and choose **Run with PowerShell**. Python 3.10 or newer is required. The included `yt-dlp` wheel is unpacked on first run; no account is needed.
2. Open <http://127.0.0.1:4173/> if the browser does not open automatically.
3. Paste a YouTube link, a direct MP4 URL, or choose an MP4 file. YouTube links are fetched by the local helper. FFmpeg WebAssembly converts the audio to MP3 in your browser.
4. Run `Stop-Pulsebox.ps1` when finished.

The local helper accepts YouTube videos up to 30 minutes and 100 MB. Some videos may be unavailable, restricted, or blocked by YouTube. Only use media you have permission to convert.

## GitHub Pages

The static website can be served from the repository root on GitHub Pages. Audio files and uploaded MP4 files are processed locally in the browser. Direct MP4 links require the video host to allow cross-origin downloads. YouTube links also need the local helper at `http://127.0.0.1:4173` or a separate hosted service configured in `config.js`; GitHub Pages cannot run the helper itself.

## Project files

- `index.html`, `styles.css`, `app.js` — website
- `vendor/` — FFmpeg WebAssembly files used for conversion
- `server/convert.py` — local static server and YouTube audio fetcher
- `Start-Pulsebox.ps1`, `Stop-Pulsebox.ps1` — Windows launch scripts

The library is stored in IndexedDB on the device that imports the tracks. The service worker caches app assets for repeat visits. Clearing browser site data removes the library.

## Licenses

Pulsebox application code is MIT licensed. The bundled `@ffmpeg/ffmpeg` JavaScript package is MIT licensed. The bundled `@ffmpeg/core` WebAssembly binary contains FFmpeg and is GPL-2.0-or-later; see [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) and [FFmpeg](https://ffmpeg.org/legal.html) for source and notices. The included `yt-dlp` wheel is Unlicense licensed; see [yt-dlp](https://github.com/yt-dlp/yt-dlp).

