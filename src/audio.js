import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

const TARGET_SAMPLE_RATE = 16000;

let sharedCtx = null;

export function warmUpAudioContext() {
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new AudioContext();
  }
  if (sharedCtx.state === 'suspended') {
    sharedCtx.resume();
  }
  console.log('[audio] AudioContext warmed up, state:', sharedCtx.state);
}

function getAudioContext() {
  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new AudioContext();
  }
  return sharedCtx;
}

/**
 * Extract audio from a video File as a 16 kHz mono Float32Array.
 * Strategy:
 *   1. Try decodeAudioData (fast, works for mp4/webm)
 *   2. Fallback: FFmpeg.wasm to extract audio as WAV, then decodeAudioData on the WAV
 */
export async function extractAudio(videoFile) {
  // Try fast path first
  try {
    return await extractViaDecodeAudioData(videoFile);
  } catch (e) {
    console.warn('[audio] decodeAudioData failed:', e.message);
  }

  // Fallback: use FFmpeg to extract audio as WAV
  console.log('[audio] Using FFmpeg to extract audio');
  return await extractViaFFmpeg(videoFile);
}

/**
 * Fast path: decode audio directly from the file buffer.
 */
async function extractViaDecodeAudioData(videoFile) {
  const arrayBuffer = await videoFile.arrayBuffer();
  const audioCtx = getAudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  const decoded = await audioCtx.decodeAudioData(arrayBuffer);

  const numSamples = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);
  const offlineCtx = new OfflineAudioContext(1, numSamples, TARGET_SAMPLE_RATE);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start(0);

  const resampled = await offlineCtx.startRendering();
  return resampled.getChannelData(0);
}

/**
 * Fallback: use FFmpeg.wasm to extract audio as 16kHz mono WAV,
 * then decode with decodeAudioData. Works for .mov and any format FFmpeg supports.
 * Only does demux + audio transcode (no video processing), so it's fast.
 */
async function extractViaFFmpeg(videoFile) {
  const ffmpeg = new FFmpeg();
  const ST_BASE = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm';

  await ffmpeg.load({
    coreURL: await toBlobURL(`${ST_BASE}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${ST_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
  });

  await ffmpeg.writeFile('input', await fetchFile(videoFile));

  // Extract audio only, convert to 16kHz mono WAV (fast, no video processing)
  await ffmpeg.exec([
    '-i', 'input',
    '-vn',                // no video
    '-ac', '1',           // mono
    '-ar', '16000',       // 16kHz
    '-f', 'wav',
    'output.wav',
  ]);

  const wavData = await ffmpeg.readFile('output.wav');
  ffmpeg.terminate();

  // Decode the WAV (decodeAudioData handles WAV reliably on all browsers)
  const audioCtx = getAudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  const decoded = await audioCtx.decodeAudioData(wavData.buffer);
  return decoded.getChannelData(0);
}
