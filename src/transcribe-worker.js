import { pipeline } from '@huggingface/transformers';

let transcriber = null;

self.onmessage = async (e) => {
  const { type, audio } = e.data;

  if (type === 'load') {
    try {
      transcriber = await pipeline(
        'automatic-speech-recognition',
        'Xenova/whisper-small',
        {
          progress_callback: (event) => {
            self.postMessage({ type: 'load-progress', event });
          },
        }
      );
      self.postMessage({ type: 'loaded' });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  }

  if (type === 'transcribe') {
    try {
      const audioData = new Float32Array(audio);
      const sampleRate = 16000;
      const chunkSec = 30;
      const strideSec = 5;
      const chunkSamples = chunkSec * sampleRate;
      const strideSamples = strideSec * sampleRate;
      const jumpSamples = chunkSamples - 2 * strideSamples;
      const totalDuration = audioData.length / sampleRate;
      const totalChunks = Math.ceil(totalDuration / (chunkSec - strideSec));

      // Process chunks one at a time to stream partial results
      let allChunks = [];
      let offset = 0;
      let chunkIndex = 0;

      while (offset < audioData.length) {
        const end = Math.min(offset + chunkSamples, audioData.length);
        const slice = audioData.subarray(offset, end);

        // Transcribe this chunk (no further chunking inside)
        const result = await transcriber(slice, {
          return_timestamps: 'word',
          chunk_length_s: 0, // process as single segment
          task: 'translate',
        });

        // Adjust timestamps by offset
        const offsetSec = offset / sampleRate;
        const chunks = (result.chunks || []).map(c => ({
          text: c.text,
          timestamp: [
            c.timestamp[0] != null ? c.timestamp[0] + offsetSec : null,
            c.timestamp[1] != null ? c.timestamp[1] + offsetSec : null,
          ],
        }));

        allChunks.push(...chunks);
        chunkIndex++;

        // Stream partial text and progress back to main thread
        const partialText = chunks.map(c => c.text).join(' ').trim();
        self.postMessage({
          type: 'partial',
          text: partialText,
          progress: Math.round((chunkIndex / totalChunks) * 100),
        });

        // Advance by jump (accounting for stride overlap)
        if (end >= audioData.length) break;
        offset += jumpSamples;
      }

      self.postMessage({ type: 'result', chunks: allChunks });
    } catch (err) {
      self.postMessage({ type: 'error', message: err.message });
    }
  }

  if (type === 'dispose') {
    if (transcriber) {
      try {
        await transcriber.dispose();
      } catch (e) { /* ignore */ }
      transcriber = null;
    }
    self.postMessage({ type: 'disposed' });
  }
};
