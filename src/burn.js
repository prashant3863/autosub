import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const CORE_VERSION = '0.12.10';
const MT_BASE = `https://unpkg.com/@ffmpeg/core-mt@${CORE_VERSION}/dist/esm`;
const ST_BASE = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

/**
 * Burn subtitles into a video using FFmpeg.wasm (fallback path).
 * Tries multi-threaded core first, falls back to single-threaded.
 */
export async function burnSubtitles(videoFile, filterString, onProgress) {
  const ffmpeg = new FFmpeg();

  ffmpeg.on('log', ({ message }) => {
    console.log('[ffmpeg]', message);
  });

  ffmpeg.on('progress', ({ progress }) => {
    onProgress(Math.round(Math.min(progress, 1) * 100));
  });

  // Try multi-threaded first (requires SharedArrayBuffer)
  let loaded = false;
  if (typeof SharedArrayBuffer !== 'undefined') {
    try {
      await ffmpeg.load({
        coreURL: await toBlobURL(`${MT_BASE}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${MT_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
        workerURL: await toBlobURL(`${MT_BASE}/ffmpeg-core.worker.js`, 'text/javascript'),
      });
      loaded = true;
      console.log('[ffmpeg] Loaded multi-threaded core');
    } catch (e) {
      console.warn('[ffmpeg] Multi-threaded load failed, falling back to single-threaded', e);
    }
  }

  if (!loaded) {
    await ffmpeg.load({
      coreURL: await toBlobURL(`${ST_BASE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${ST_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
    });
    console.log('[ffmpeg] Loaded single-threaded core');
  }

  await ffmpeg.writeFile('input.mp4', await fetchFile(videoFile));
  await ffmpeg.createDir('fonts');
  // Resolve font URL relative to page base (works on subpath deployments like /autosub/)
  const fontURL = new URL('fonts/LiberationSans-Bold.ttf', document.baseURI).href;
  await ffmpeg.writeFile(
    'fonts/LiberationSans-Bold.ttf',
    await fetchFile(fontURL)
  );

  const fullFilter = `format=yuv420p,${filterString}`;

  const exitCode = await ffmpeg.exec([
    '-i', 'input.mp4',
    '-vf', fullFilter,
    '-c:a', 'copy',
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-crf', '23',
    'output.mp4',
  ]);

  console.log('[ffmpeg] exit code:', exitCode);

  if (exitCode !== 0) {
    throw new Error(`FFmpeg exited with code ${exitCode}. Check console for details.`);
  }

  const data = await ffmpeg.readFile('output.mp4');
  const blob = new Blob([data.buffer], { type: 'video/mp4' });

  // Clean up virtual FS to free memory
  try {
    await ffmpeg.deleteFile('input.mp4');
    await ffmpeg.deleteFile('output.mp4');
    await ffmpeg.deleteFile('fonts/LiberationSans-Bold.ttf');
  } catch (e) { /* ignore cleanup errors */ }
  ffmpeg.terminate();

  return blob;
}
