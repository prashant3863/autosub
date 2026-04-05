const TARGET_SAMPLE_RATE = 16000;

/**
 * Extract audio from a video File as a 16 kHz mono Float32Array.
 * Tries decodeAudioData first (fast), falls back to <video> element
 * playback capture for containers it can't handle (e.g. .mov).
 */
export async function extractAudio(videoFile) {
  const isMov = videoFile.name.toLowerCase().endsWith('.mov') ||
                videoFile.type === 'video/quicktime';

  if (!isMov) {
    try {
      return await extractViaDecodeAudioData(videoFile);
    } catch (e) {
      console.warn('[audio] decodeAudioData failed, falling back to video element capture:', e);
    }
  } else {
    console.log('[audio] .mov detected, using video element capture');
  }

  return await extractViaVideoElement(videoFile);
}

/**
 * Fast path: decode audio directly from the file buffer.
 */
async function extractViaDecodeAudioData(videoFile) {
  const arrayBuffer = await videoFile.arrayBuffer();
  const audioCtx = new AudioContext();
  const decoded = await audioCtx.decodeAudioData(arrayBuffer);

  const numSamples = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);
  const offlineCtx = new OfflineAudioContext(1, numSamples, TARGET_SAMPLE_RATE);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start(0);

  const resampled = await offlineCtx.startRendering();
  const audioData = resampled.getChannelData(0);
  audioCtx.close();

  return audioData;
}

/**
 * Fallback: play video through <video> element at max speed,
 * capture raw audio samples via ScriptProcessorNode.
 * Works for any container the browser can play (.mov, etc.).
 */
async function extractViaVideoElement(videoFile) {
  const url = URL.createObjectURL(videoFile);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.src = url;
  video.volume = 0.01; // near-silent but not muted (muted disables audio pipeline)

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = resolve;
    video.onerror = () => reject(new Error('Failed to load video for audio extraction'));
  });

  const duration = video.duration;
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaElementSource(video);

  // Capture raw PCM samples via ScriptProcessorNode
  const bufferSize = 4096;
  const processor = audioCtx.createScriptProcessor(bufferSize, 1, 1);
  const capturedChunks = [];

  processor.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    capturedChunks.push(new Float32Array(input));
  };

  source.connect(processor);
  processor.connect(audioCtx.destination);

  // Play at max reliable speed
  video.playbackRate = Math.min(video.playbackRate, 4);
  video.currentTime = 0;
  await video.play();

  await new Promise((resolve) => {
    video.onended = resolve;
  });

  // Combine captured chunks
  const totalSamples = capturedChunks.reduce((sum, c) => sum + c.length, 0);
  const rawAudio = new Float32Array(totalSamples);
  let offset = 0;
  for (const chunk of capturedChunks) {
    rawAudio.set(chunk, offset);
    offset += chunk.length;
  }

  // Capture sample rate before cleanup
  const capturedSampleRate = audioCtx.sampleRate;

  // Cleanup media elements
  processor.disconnect();
  source.disconnect();
  audioCtx.close();
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
