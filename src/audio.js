const TARGET_SAMPLE_RATE = 16000;

// Shared AudioContext — created on user gesture, reused across all audio operations.
// iOS Safari requires AudioContext to be created/resumed during a user tap.
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
 * Tries decodeAudioData first, falls back to <video> element capture.
 */
export async function extractAudio(videoFile) {
  try {
    return await extractViaDecodeAudioData(videoFile);
  } catch (e) {
    console.warn('[audio] decodeAudioData failed, falling back to video element capture:', e);
  }

  return await extractViaVideoElement(videoFile);
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
 * Fallback: play video through <video> element,
 * capture audio via createMediaElementSource + ScriptProcessorNode.
 */
async function extractViaVideoElement(videoFile) {
  const url = URL.createObjectURL(videoFile);
  const video = document.createElement('video');
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  video.volume = 0.01;

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error('Failed to load video for audio extraction'));
  });

  const duration = video.duration;
  const audioCtx = getAudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  const source = audioCtx.createMediaElementSource(video);
  const bufferSize = 4096;
  const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
  const capturedChunks = [];

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    capturedChunks.push(new Float32Array(input));
  };

  source.connect(processor);
  processor.connect(audioCtx.destination);

  video.currentTime = 0;
  await video.play();

  await new Promise((resolve) => {
    video.onended = resolve;
  });

  const totalSamples = capturedChunks.reduce((sum, c) => sum + c.length, 0);
  const rawAudio = new Float32Array(totalSamples);
  let offset = 0;
  for (const chunk of capturedChunks) {
    rawAudio.set(chunk, offset);
    offset += chunk.length;
  }

  const capturedSampleRate = audioCtx.sampleRate;

  // Disconnect but don't close — shared context is reused
  processor.disconnect();
  source.disconnect();
  URL.revokeObjectURL(url);
  video.src = '';

  // Resample to 16 kHz mono
  const numSamples = Math.ceil(duration * TARGET_SAMPLE_RATE);
  const offlineCtx = new OfflineAudioContext(1, numSamples, TARGET_SAMPLE_RATE);
  const buffer = offlineCtx.createBuffer(1, rawAudio.length, capturedSampleRate);
  buffer.getChannelData(0).set(rawAudio);

  const bufSource = offlineCtx.createBufferSource();
  bufSource.buffer = buffer;
  bufSource.connect(offlineCtx.destination);
  bufSource.start(0);

  const resampled = await offlineCtx.startRendering();
  return resampled.getChannelData(0);
}
