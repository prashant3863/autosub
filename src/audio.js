const TARGET_SAMPLE_RATE = 16000;

/**
 * Extract audio from a video File as a 16 kHz mono Float32Array
 * (the format Whisper expects).
 */
export async function extractAudio(videoFile) {
  const arrayBuffer = await videoFile.arrayBuffer();
  const audioCtx = new AudioContext();
  const decoded = await audioCtx.decodeAudioData(arrayBuffer);

  // Resample to 16 kHz mono using OfflineAudioContext
  const numSamples = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);
  const offlineCtx = new OfflineAudioContext(1, numSamples, TARGET_SAMPLE_RATE);

  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start(0);

  const resampled = await offlineCtx.startRendering();
  const audioData = resampled.getChannelData(0); // Float32Array
  audioCtx.close();

  return audioData;
}
