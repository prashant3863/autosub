# autosub

Auto-generate and burn subtitles into videos. Runs entirely in your browser — no uploads, no servers, no API keys.

**[Try it live](https://prashant3863.github.io/autosub/)**

## What it does

1. Upload a video
2. AI transcribes the speech (supports any language, translates to English)
3. Pick a subtitle style, size, and position with live preview
4. Edit the transcript to fix any errors
5. Download the video with burned-in subtitles

Everything runs client-side using WebAssembly and WebCodecs. Your video never leaves your device.

## Features

- **AI Transcription** — Whisper (small, multilingual) via Transformers.js, running in a Web Worker
- **Hardware-accelerated encoding** — WebCodecs API with GPU encoding (VideoToolbox on Mac)
- **5 subtitle styles** — Bold, Clean, Boxed, Pop, Minimal with live preview on your actual video frame
- **Short-form & long-form** — Optimized for Reels/TikTok (1-3 words) or YouTube (full sentences)
- **Subtitle size & position** — S/M/L sizing + drag slider for vertical position
- **Transcript editing** — Review and fix misheard words before burning
- **Any language to English** — Whisper translates speech to English subtitles automatically
- **FFmpeg fallback** — Multi-threaded FFmpeg.wasm as fallback when WebCodecs isn't available

## Tech stack

| Layer | Tech |
|---|---|
| Speech-to-text | [Transformers.js](https://huggingface.co/docs/transformers.js) + Whisper small |
| Video encoding | [WebCodecs API](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) (hardware) |
| Fallback encoding | [FFmpeg.wasm](https://ffmpegwasm.netlify.app/) (software) |
| Demux/mux | [mp4box.js](https://github.com/nicol-ograve/nicol-ograve.github.io) + [mp4-muxer](https://github.com/nicol-ograve/nicol-ograve.github.io) |
| Subtitle rendering | Canvas 2D with word-wrap and composite box paths |
| Bundler | [Vite](https://vitejs.dev/) |
| Hosting | GitHub Pages (static, no backend) |

## How it was built

This project was built as an experiment in AI-assisted development — using advanced context management techniques to rapidly iterate on a complex client-side application. The full development log with all decisions, bugs, and fixes is in [`DEVLOG.md`](./DEVLOG.md).

## Development

```bash
npm install
npm run dev
```

Open `http://localhost:5173/autosub/` in Chrome.

## License

MIT
