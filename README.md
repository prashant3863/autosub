# autosub

Add subtitles to videos, entirely in the browser. No uploads, no servers.

**[Try it](https://prashant3863.github.io/autosub/)**

## How it works

1. Upload a video
2. Whisper transcribes the speech (translates to English if needed)
3. Pick a style, adjust size and position — preview updates live
4. Edit the transcript if anything looks off
5. Download the video with subtitles burned in

Your video stays on your device. Everything runs client-side.

## Features

- Whisper (small, multilingual) for transcription, runs in a Web Worker
- WebCodecs for encoding — uses hardware acceleration when available, FFmpeg.wasm as fallback
- Five subtitle styles (Bold, Clean, Boxed, Pop, Minimal)
- Short-form (1-3 words, for Reels/TikTok) and long-form (full sentences) modes
- Size, position, and transcript are all editable before burning

## Tech

Transformers.js, WebCodecs API, FFmpeg.wasm, mp4box.js, mp4-muxer, Canvas 2D, Vite.

## Background

My wife was looking for a tool to add subtitles to her videos. Everything she found either required uploading to some service, was too complicated, or was a paid tool with watermarks and lesser quality exports. Over dinner, I decided to just build one.

The development log is in [`DEVLOG.md`](./DEVLOG.md) if you're curious about the decisions and tradeoffs along the way.

## Development

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173/autosub/` — works best in Chrome.

## License

MIT
