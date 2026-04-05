# Dev Log — Video Subtitle Burner

## ToDo

- [ ] **[bug] .mov container support** — `decodeAudioData()` fails on `.mov` (QuickTime) files. Detect by file extension/MIME type (`video/quicktime`), not platform. Fix: use `<video>` element + `MediaStreamAudioDestinationNode` for audio extraction when `decodeAudioData` fails or file is `.mov`.
- [ ] **[perf] WebCodecs codec probing** — WebCodecs falls back to slow FFmpeg.wasm when HEVC decode isn't available. Fix: use `VideoDecoder.isConfigSupported()` to probe the video's actual codec before attempting. If HEVC unsupported, decode via `<video>` element + canvas capture (browser handles codec via OS-level decoders), then encode to H.264 via WebCodecs hardware encoder. Capability-based, not platform-based.
- [ ] **Custom fonts for subtitle text** — Let user upload or select fonts for subtitles. Needs font loading via FontFace API for Canvas rendering, and writing the font file to FFmpeg virtual FS for the fallback path.

## Progress
1. Scaffolded Vite project with Transformers.js (Whisper) + FFmpeg.wasm
2. Built pipeline: extract audio → transcribe → generate drawtext filter → burn subtitles
3. All client-side, no backend
4. Social media subtitle styling (uppercase, 1-3 words, large font, thick outline)
5. WebCodecs + Canvas hardware-accelerated burn path (with FFmpeg fallback)
6. Short-form / Long-form video format toggle (controls word grouping + styling)
7. Upgraded Whisper to `whisper-small` multilingual + auto-translate to English
8. Subtitle size control (S/M/L) with configurable multipliers
9. Text wrapping — subtitles capped to 80% of video width, word-wrap to multiple lines
10. RAM optimisation — Whisper model disposal, backpressure in WebCodecs, buffer cleanup
11. Style picker — 5 visual preset cards (Bold, Clean, Boxed, Pop, Minimal) with live preview on video frame
12. Height slider — range 10-90%, real-time preview update, resets to preset default on style change
13. Refactored shared drawing logic into `src/styles.js`, used by both preview and burn
14. Boxed style: concave notch curves at multi-line junctions, per-line width hugging via composite path
15. Transcript editing — editable cue list shown after transcription, user fixes words before burn
16. Transcription moved to Web Worker — main thread stays free, CSS animations run smoothly
17. Live transcript stream — partial text appears during transcription with real progress bar updates

## Issues & Fixes

### White screen on load
**Cause:** Stale service worker from previous project cached on localhost:5173, hijacking module requests.
**Fix:** Unregister service worker in DevTools → Application → Service Workers, clear site data.

### FS error on burn
**Cause:** `fonts/` directory didn't exist in FFmpeg's virtual filesystem.
**Fix:** Added `ffmpeg.createDir('fonts')` before writing the font file.

### 0 MB output file
**Cause:** Multiple issues — over-escaped drawtext filter string, absolute font path (`/fonts/...`), no error visibility from FFmpeg.
**Fix:**
- Simplified drawtext escaping (removed excessive backslashes)
- Changed font path to relative (`fonts/...`)
- Added `ffmpeg.on('log')` for console output
- Check exit code and throw on failure
- Switched from `filter_script:v` to `-vf` directly

### Font "unknown file format"
**Cause:** GitHub download URLs returned HTML pages instead of actual TTF binary. Multiple CDN attempts also failed.
**Fix:** Copied system Arial Bold (`/System/Library/Fonts/Supplemental/Arial Bold.ttf`) as the bundled font. Works for dev; for prod deployment, need a properly sourced OFL font.

### Subtitles too small + wrong style for social media
**Cause:** fontsize=24 on a 3840-tall video is tiny. 8 words per cue looks like traditional movie subtitles.
**Fix:** Social media style overhaul:
- 1-3 words per cue (karaoke style)
- Dynamic font size: `h/27` (~70px on 1920h, ~140px on 3840h)
- UPPERCASE text
- Thick outline (borderw=4) + drop shadow
- Positioned at 60% height (not bottom — avoids UI overlap)

### Video corruption (black squiggly lines on HEVC 10-bit input)
**Cause:** Input was HEVC 10-bit HDR (yuv420p10le, bt2020). Direct transcode to H.264 with `ultrafast` preset caused artifacts.
**Fix:**
- Prepend `format=yuv420p` filter to convert pixel format before drawtext
- Changed preset from `ultrafast` to `fast` for better quality
- Lowered CRF from 23 to 20

### Extremely slow burn (4K HEVC, 44s video took 30+ mins)
**Cause:** FFmpeg.wasm is single-threaded WASM — no GPU, no SIMD. 4K = 8.3M pixels/frame. `preset=fast` made it 2-3x slower than `ultrafast`. Canva is fast because it uses server-side GPU encoding.
**Fix:** Three-pronged approach:
1. FFmpeg fallback reverted to `ultrafast` preset
2. FFmpeg now tries multi-threaded core (`@ffmpeg/core-mt`) first
3. New primary path: WebCodecs API + Canvas — decodes frames with VideoDecoder, draws subtitles on OffscreenCanvas, re-encodes with VideoEncoder using `hardwareAcceleration: 'prefer-hardware'`. Uses mp4box.js for demux, mp4-muxer for output. Expected 5-20x speedup.

### Upgraded Whisper model + translation
**Change:** `Xenova/whisper-tiny.en` (40MB) → `Xenova/whisper-small` (250MB, multilingual)
**Why:** tiny.en accuracy ~7.5/10, missing many words. small is ~9/10.
**Bonus:** Multilingual model with `task: 'translate'` enables any-language-to-English translation (e.g. Gujarati → English). Negligible speed impact — same inference pass, just decodes to English tokens.

### Subtitle text overflowing video width
**Cause:** No max-width constraint — long cue text rendered as a single line exceeding frame boundaries.
**Fix:** Added word-wrapping in Canvas `drawSubtitle()` via `ctx.measureText()`. Text wraps to multiple lines within 80% of video width. Multi-line rendering stacks lines with 1.2x line height.

### Subtitle size control
**Need:** Long-form content on TV/desktop needs smaller subtitles than short-form mobile content.
**Fix:** Added S/M/L toggle in UI. Size multipliers (0.7/1.0/1.3) applied to base font size per format. Flows through to both WebCodecs and FFmpeg burn paths.

### RAM optimisation
**Cause:** App consumed excessive memory making Mac slow/laggy. Multiple issues:
1. Whisper model (~250MB) stayed in memory during burn phase
2. Audio Float32Array kept alive after transcription
3. WebCodecs: all video samples dumped to decoder at once, no backpressure — decoded 4K frames (~32MB each) queued unbounded
4. Unnecessary `arrayBuffer.slice(0)` doubled video file in memory
5. FFmpeg virtual FS not cleaned up after burn

**Fix:**
- Added `disposeModel()` in transcribe.js — frees Whisper model after transcription
- Null out audio array after transcription completes
- **WebCodecs backpressure**: feed samples via pump with decode queue max 30 (HEVC needs large buffer for B-frames), encode queue max 10. Periodic 100ms pump timer as fallback to prevent deadlocks. Null out consumed samples.
- Removed unnecessary buffer copy in demux
- FFmpeg: delete input/output files from virtual FS and call `ffmpeg.terminate()` after burn
- Added `src/perf.js` memory profiler — logs heap snapshots at each pipeline stage with deltas and timing

### Benchmark results (44s 4K HEVC portrait video)
```
Stage           Heap    Delta    Time
start           50MB    —        —
model loaded    483MB   +433MB   1.3s
audio extracted 73MB    -410MB   0.1s
transcription   554MB   +481MB   17.0s
model disposed  554MB   +0MB     0.0s
burn complete   352MB   -202MB   23.5s
done            352MB   —        —
Peak: 554MB | Total: 42.0s
```
WebCodecs burn: ~47 fps at 4K (hardware accelerated). Previous FFmpeg.wasm run took 30+ minutes for the same video.

### Boxed style multi-line background overlap
**Cause:** Per-line background boxes drawn separately — overlapping regions got darker with semi-transparent fill.
**Fix (v1):** Single path with all rects, one fill call. Still had 90-degree junctions.
**Fix (v2):** Per-line boxes on offscreen canvas with opaque fill, composited with alpha. Still 90-degree junctions.
**Fix (v3):** Custom composite path with `arcTo` concave notch curves at width-step junctions. Each line's box hugs its own text width. Corner radius scales with font size (`fontSize * 0.3`).

### Progress bar frozen during transcription
**Cause:** ONNX WASM inference blocks the main thread — `setInterval`, CSS animations, and DOM updates all freeze during Whisper's matrix operations. Even CSS compositor thread gets starved.
**Fix:** Moved entire transcription pipeline to a **Web Worker** (`src/transcribe-worker.js`). Worker processes 30s audio chunks sequentially and posts `partial` messages with text + progress. Main thread stays completely free — progress bar and live transcript stream update smoothly. API surface unchanged (`loadModel`, `transcribe`, `disposeModel`).
