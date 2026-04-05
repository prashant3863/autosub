import { createFile, DataStream } from 'mp4box';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { drawStyledSubtitle } from './styles.js';

/**
 * Check if WebCodecs is available.
 */
export function isWebCodecsSupported() {
  return typeof VideoDecoder !== 'undefined' && typeof VideoEncoder !== 'undefined';
}

/**
 * Burn subtitles using WebCodecs + Canvas (hardware-accelerated).
 */
export async function burnWithWebCodecs(videoFile, cues, style, sizeMult = 'medium', yOverride = null, onProgress) {
  const arrayBuffer = await videoFile.arrayBuffer();

  // Step 1: Demux
  const demuxed = await demux(arrayBuffer);
  const { videoTrack, audioTrack, videoSamples, audioChunks } = demuxed;

  const totalFrames = videoSamples.length;
  console.log(`[webcodecs] ${totalFrames} frames, ${videoTrack.width}x${videoTrack.height}, codec: ${videoTrack.codec}`);

  // Verify decoder supports this codec before proceeding
  const decoderSupport = await VideoDecoder.isConfigSupported({
    codec: videoTrack.codec,
    codedWidth: videoTrack.width,
    codedHeight: videoTrack.height,
  });
  if (!decoderSupport.supported) {
    throw new Error(`Codec ${videoTrack.codec} not supported by this device`);
  }
  console.log(`[webcodecs] Decoder config supported: ${videoTrack.codec}`);

  // Verify encoder supports H.264 at this resolution
  const encoderSupport = await VideoEncoder.isConfigSupported({
    codec: 'avc1.640033',
    width: videoTrack.width,
    height: videoTrack.height,
    bitrate: 8_000_000,
    hardwareAcceleration: 'prefer-hardware',
  });
  if (!encoderSupport.supported) {
    throw new Error(`H.264 encoding at ${videoTrack.width}x${videoTrack.height} not supported by this device`);
  }
  console.log(`[webcodecs] Encoder config supported: avc1.640033 ${videoTrack.width}x${videoTrack.height}`);

  // Step 2: Canvas for drawing subtitles
  // Always use HTMLCanvasElement — OffscreenCanvas + VideoFrame is unreliable on some Android devices
  const canvas = document.createElement('canvas');
  canvas.width = videoTrack.width;
  canvas.height = videoTrack.height;
  const ctx = canvas.getContext('2d');

  // Step 3: Encoder + muxer
  const { muxer, videoEncoder, addAudio } = setupMuxer(videoTrack, audioTrack);

  // Step 4: Decode → draw → encode (with backpressure)
  let framesProcessed = 0;
  // HEVC needs a larger decode buffer due to B-frame reordering
  const DECODE_QUEUE_MAX = 30;
  const ENCODE_QUEUE_MAX = 10;

  await new Promise((resolve, reject) => {
    let sampleIndex = 0;
    let flushing = false;
    let pumpTimer = null;

    const decoder = new VideoDecoder({
      output: (frame) => {
        try {
          const ts = frame.timestamp;
          const dur = frame.duration;
          const timeSec = ts / 1_000_000;

          ctx.drawImage(frame, 0, 0);
          frame.close();

          // Find active cue for this timestamp
          const activeCue = cues.find(c => timeSec >= c.start && timeSec <= c.end);
          if (activeCue) {
            drawStyledSubtitle(ctx, activeCue.text, videoTrack.width, videoTrack.height, style, sizeMult, yOverride);
          }

          const newFrame = new VideoFrame(canvas, {
            timestamp: ts,
            duration: dur,
          });
          videoEncoder.encode(newFrame, { keyFrame: framesProcessed % 60 === 0 });
          newFrame.close();

          framesProcessed++;
          if (framesProcessed % 5 === 0 || framesProcessed === totalFrames) {
            onProgress(Math.round((framesProcessed / totalFrames) * 100));
          }

          // Feed more samples when a frame is consumed
          pump();
        } catch (e) {
          cleanup();
          reject(e);
        }
      },
      error: (e) => { cleanup(); reject(e); },
    });

    decoder.configure({
      codec: videoTrack.codec,
      codedWidth: videoTrack.width,
      codedHeight: videoTrack.height,
      description: videoTrack.description,
    });

    function pump() {
      // Feed samples while queues have room
      while (
        sampleIndex < videoSamples.length &&
        decoder.decodeQueueSize < DECODE_QUEUE_MAX &&
        videoEncoder.encodeQueueSize < ENCODE_QUEUE_MAX
      ) {
        const sample = videoSamples[sampleIndex];
        if (sample) {
          decoder.decode(new EncodedVideoChunk({
            type: sample.is_sync ? 'key' : 'delta',
            timestamp: sample.cts,
            duration: sample.duration,
            data: sample.data,
          }));
        }
        videoSamples[sampleIndex] = null;
        sampleIndex++;
      }

      // All samples fed → flush
      if (sampleIndex >= videoSamples.length && !flushing) {
        flushing = true;
        cleanup();
        decoder.flush().then(() => {
          return videoEncoder.flush();
        }).then(() => {
          resolve();
        }).catch(reject);
      }
    }

    function cleanup() {
      if (pumpTimer) {
        clearInterval(pumpTimer);
        pumpTimer = null;
      }
    }

    // Periodic pump as fallback — decoder may not always trigger output fast enough
    pumpTimer = setInterval(pump, 100);

    // Start feeding
    pump();
  });

  // Step 5: Add audio
  for (const chunk of audioChunks) {
    if (chunk && chunk.data) {
      addAudio(chunk);
    }
  }

  // Step 6: Finalize
  try {
    muxer.finalize();
  } catch (e) {
    console.error('[webcodecs] Muxer finalize failed:', e);
    throw e;
  }
  const buffer = muxer.target.buffer;
  return new Blob([buffer], { type: 'video/mp4' });
}

/**
 * Demux MP4 file using mp4box.js.
 */
function demux(arrayBuffer) {
  return new Promise((resolve, reject) => {
    const mp4 = createFile();
    let videoTrack = null;
    let audioTrack = null;
    const videoSamples = [];
    const audioChunks = [];
    let resolved = false;

    mp4.onError = (e) => reject(e);

    mp4.onReady = (info) => {
      console.log('[demux] ready', info);

      const vTrack = info.videoTracks[0];
      if (!vTrack) {
        reject(new Error('No video track found'));
        return;
      }

      // Extract codec-specific description for WebCodecs
      const trak = mp4.getTrackById(vTrack.id);
      const entry = trak.mdia.minf.stbl.stsd.entries[0];
      let description;

      // Look for avcC, hvcC, or vpcC config box
      const configBoxTypes = ['avcC', 'hvcC', 'vpcC'];
      for (const type of configBoxTypes) {
        const box = entry[type];
        if (box) {
          const stream = new DataStream(undefined, 0, DataStream.BIG_ENDIAN);
          box.write(stream);
          // The write() includes the box header (size + type = 8 bytes), skip it
          description = new Uint8Array(stream.buffer, 8);
          break;
        }
      }

      videoTrack = {
        id: vTrack.id,
        codec: vTrack.codec,
        width: vTrack.video.width,
        height: vTrack.video.height,
        timescale: vTrack.timescale,
        nb_samples: vTrack.nb_samples,
        description,
      };

      const aTrack = info.audioTracks[0];
      if (aTrack) {
        audioTrack = {
          id: aTrack.id,
          codec: aTrack.codec,
          sampleRate: aTrack.audio.sample_rate,
          channels: aTrack.audio.channel_count,
          timescale: aTrack.timescale,
        };
        mp4.setExtractionOptions(aTrack.id, 'audio', { nbSamples: 500 });
      }

      mp4.setExtractionOptions(vTrack.id, 'video', { nbSamples: 500 });
      mp4.start();
    };

    mp4.onSamples = (trackId, user, samples) => {
      for (const sample of samples) {
        // Convert timestamps to microseconds
        const tsMicro = (sample.cts * 1_000_000) / sample.timescale;
        const durMicro = (sample.duration * 1_000_000) / sample.timescale;

        if (user === 'video') {
          videoSamples.push({
            data: sample.data,
            cts: tsMicro,
            duration: durMicro,
            is_sync: sample.is_sync,
          });
        } else if (user === 'audio') {
          audioChunks.push({
            data: sample.data,
            timestamp: tsMicro,
            duration: durMicro,
          });
        }
      }
    };

    mp4.onFlush = () => {
      if (!resolved) {
        resolved = true;
        console.log(`[demux] done: ${videoSamples.length} video, ${audioChunks.length} audio samples`);
        resolve({ videoTrack, audioTrack, videoSamples, audioChunks });
      }
    };

    // Feed the buffer (fileStart is required by mp4box)
    arrayBuffer.fileStart = 0;
    mp4.appendBuffer(arrayBuffer);
    mp4.flush();

    // Fallback: if onFlush doesn't fire, resolve after a short delay
    setTimeout(() => {
      if (!resolved && videoSamples.length > 0) {
        resolved = true;
        console.log(`[demux] timeout fallback: ${videoSamples.length} video, ${audioChunks.length} audio samples`);
        resolve({ videoTrack, audioTrack, videoSamples, audioChunks });
      }
    }, 3000);
  });
}

/**
 * Set up mp4-muxer with video encoder.
 */
function setupMuxer(videoTrack, audioTrack) {
  const target = new ArrayBufferTarget();

  const muxerOptions = {
    target,
    video: {
      codec: 'avc',
      width: videoTrack.width,
      height: videoTrack.height,
    },
    fastStart: 'in-memory',
  };

  if (audioTrack) {
    muxerOptions.audio = {
      codec: 'aac',
      sampleRate: audioTrack.sampleRate,
      numberOfChannels: audioTrack.channels,
    };
  }

  const muxer = new Muxer(muxerOptions);

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (e) => console.error('[encoder]', e),
  });

  videoEncoder.configure({
    codec: 'avc1.640033',
    width: videoTrack.width,
    height: videoTrack.height,
    bitrate: 8_000_000,
    hardwareAcceleration: 'prefer-hardware',
  });

  const addAudio = (sample) => {
    const chunk = new EncodedAudioChunk({
      type: 'key',
      timestamp: sample.timestamp,
      duration: sample.duration,
      data: sample.data,
    });
    muxer.addAudioChunk(chunk);
  };

  return { muxer, videoEncoder, addAudio };
}
