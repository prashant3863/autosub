let worker = null;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./transcribe-worker.js', import.meta.url), { type: 'module' });
  }
  return worker;
}

/**
 * Load the Whisper model in the worker.
 */
export function loadModel(onProgress) {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const handler = (e) => {
      if (e.data.type === 'error') {
        w.removeEventListener('message', handler);
        reject(new Error(e.data.message));
      } else if (e.data.type === 'load-progress' && onProgress) {
        onProgress(e.data.event);
      } else if (e.data.type === 'loaded') {
        w.removeEventListener('message', handler);
        resolve();
      }
    };
    w.addEventListener('message', handler);
    w.postMessage({ type: 'load' });
  });
}

/**
 * Transcribe audio in the worker (main thread stays free for animations).
 * @param {Float32Array} audio
 * @param {function} onPartial - Called with { text, progress } as chunks complete
 */
export function transcribe(audio, onPartial) {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const handler = (e) => {
      if (e.data.type === 'error') {
        w.removeEventListener('message', handler);
        reject(new Error(e.data.message));
      } else if (e.data.type === 'partial' && onPartial) {
        onPartial({ text: e.data.text, progress: e.data.progress });
      } else if (e.data.type === 'result') {
        w.removeEventListener('message', handler);
        resolve(e.data.chunks);
      }
    };
    w.addEventListener('message', handler);
    const buffer = audio.buffer.slice(0);
    w.postMessage({ type: 'transcribe', audio: buffer }, [buffer]);
  });
}

/**
 * Dispose the Whisper model to free memory.
 */
export function disposeModel() {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const handler = (e) => {
      if (e.data.type === 'error') {
        w.removeEventListener('message', handler);
        reject(new Error(e.data.message));
      } else if (e.data.type === 'disposed') {
        w.removeEventListener('message', handler);
        console.log('[whisper] Model disposed');
        resolve();
      }
    };
    w.addEventListener('message', handler);
    w.postMessage({ type: 'dispose' });
  });
}
