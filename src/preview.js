import { drawStyledSubtitle } from './styles.js';

const SAMPLE_TEXT = 'Sample subtitle text';

/**
 * Extract a single frame from a video file at the given time.
 * Returns an ImageBitmap that can be drawn onto any canvas.
 */
export async function extractFrame(videoFile, timeSec = 2) {
  const url = URL.createObjectURL(videoFile);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = url;

  return new Promise((resolve, reject) => {
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load video for preview'));
    };

    video.onloadedmetadata = () => {
      // Clamp seek time to video duration
      const seekTo = Math.min(timeSec, video.duration * 0.5);
      video.currentTime = seekTo;
    };

    video.onseeked = async () => {
      try {
        const bitmap = await createImageBitmap(video);
        URL.revokeObjectURL(url);
        video.src = ''; // release video resource
        resolve(bitmap);
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
  });
}

/**
 * Render a preview of the subtitle style onto a canvas.
 * @param {HTMLCanvasElement} canvas - The visible preview canvas
 * @param {ImageBitmap} frameBitmap - A frame from the video
 * @param {object} style - Style preset from STYLE_PRESETS
 * @param {string} sizeMult - 'small' | 'medium' | 'large'
 * @param {number|null} yOverride - Y position override (0-1 fraction), null for style default
 */
export function renderPreview(canvas, frameBitmap, style, sizeMult = 'medium', yOverride = null) {
  const ctx = canvas.getContext('2d');

  // Size canvas to fit the frame at display width
  const displayWidth = canvas.clientWidth || 320;
  const aspect = frameBitmap.height / frameBitmap.width;
  const displayHeight = Math.round(displayWidth * aspect);

  canvas.width = displayWidth;
  canvas.height = displayHeight;

  // Draw the video frame scaled to canvas
  ctx.drawImage(frameBitmap, 0, 0, displayWidth, displayHeight);

  // Draw subtitle using shared function
  drawStyledSubtitle(ctx, SAMPLE_TEXT, displayWidth, displayHeight, style, sizeMult, yOverride);
}

/**
 * Render a style card thumbnail.
 * @param {HTMLCanvasElement} canvas - Small card canvas
 * @param {object} style - Style preset
 */
export function renderStyleCard(canvas, style) {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d');

  // Dark background
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, w, h);

  // Draw the style name using a simplified version of the style
  const text = style.uppercase ? style.name.toUpperCase() : style.name;
  const fontSize = Math.round(h / 3.5);

  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const x = w / 2;
  const y = h / 2;

  if (style.bgBox && style.bgColor) {
    const pad = fontSize * 0.2;
    const tw = ctx.measureText(text).width;
    ctx.fillStyle = style.bgColor;
    ctx.beginPath();
    ctx.roundRect(x - tw / 2 - pad, y - fontSize * 0.6 - pad,
                  tw + pad * 2, fontSize * 1.2 + pad * 2, 4);
    ctx.fill();
  }

  if (style.borderw > 0 && style.borderColor) {
    ctx.strokeStyle = style.borderColor;
    ctx.lineWidth = Math.max(1, style.borderw * (fontSize / 24));
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
  }

  ctx.fillStyle = style.fontColor;
  ctx.fillText(text, x, y);
}
