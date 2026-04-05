import { SIZE_MULTIPLIERS } from './styles.js';

const SENTENCE_ENDINGS = /[.?!]$/;

const FORMAT_CONFIG = {
  short: { maxWords: 3 },
  long: { maxWords: 10 },
};

/**
 * Group word chunks into subtitle cues.
 */
export function groupIntoCues(chunks, format = 'short') {
  const { maxWords } = FORMAT_CONFIG[format];
  const cues = [];
  let currentWords = [];
  let cueStart = null;

  for (const chunk of chunks) {
    if (chunk.timestamp[0] == null || chunk.timestamp[1] == null) continue;

    if (cueStart === null) cueStart = chunk.timestamp[0];
    currentWords.push(chunk.text.trim());

    const isEndOfSentence = SENTENCE_ENDINGS.test(chunk.text.trim());
    const isFull = currentWords.length >= maxWords;

    if (isEndOfSentence || isFull) {
      cues.push({
        text: currentWords.join(' '),
        start: cueStart,
        end: chunk.timestamp[1],
      });
      currentWords = [];
      cueStart = null;
    }
  }

  if (currentWords.length > 0) {
    const lastChunk = chunks[chunks.length - 1];
    cues.push({
      text: currentWords.join(' '),
      start: cueStart,
      end: lastChunk.timestamp[1] ?? cueStart + 3,
    });
  }

  return cues;
}

/**
 * Escape text for FFmpeg drawtext filter.
 */
function escapeDrawtext(text) {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\u2019")
    .replace(/:/g, '\\:')
    .replace(/%/g, '%%');
}

/**
 * Generate an FFmpeg drawtext filter string from cues using a style preset.
 * @param {Array} cues
 * @param {object} style - Style preset from STYLE_PRESETS
 * @param {string} sizeMult - 'small' | 'medium' | 'large'
 * @param {number|null} yOverride - Y position as fraction (0-1)
 * @param {string} fontPath
 */
export function generateDrawtextFilter(cues, style, sizeMult = 'medium', yOverride = null, fontPath = 'fonts/LiberationSans-Bold.ttf') {
  const mult = SIZE_MULTIPLIERS[sizeMult] || 1;
  const fontSizeExpr = `h/${Math.round(style.baseFontDiv / mult)}`;
  const yExpr = `h*${(yOverride ?? style.yPosFrac).toFixed(2)}`;

  // Map style fontColor to FFmpeg color
  const fontColor = ffmpegColor(style.fontColor);
  const borderColor = ffmpegColor(style.borderColor);

  const filters = cues.map((cue) => {
    const displayText = style.uppercase ? cue.text.toUpperCase() : cue.text;
    const escaped = escapeDrawtext(displayText);
    const start = cue.start.toFixed(3);
    const end = cue.end.toFixed(3);

    const parts = [
      `drawtext=fontfile=${fontPath}`,
      `text='${escaped}'`,
      `fontsize=${fontSizeExpr}`,
      `fontcolor=${fontColor}`,
      `x=(w-text_w)/2`,
      `y=${yExpr}`,
      `enable='between(t,${start},${end})'`,
    ];

    if (style.borderw > 0 && borderColor) {
      parts.push(`borderw=${style.borderw}`);
      parts.push(`bordercolor=${borderColor}`);
    }

    if (style.bgBox) {
      parts.push(`box=1`);
      parts.push(`boxcolor=black@0.6`);
      parts.push(`boxborderw=10`);
    }

    if (style.shadowX || style.shadowY) {
      parts.push(`shadowcolor=black@0.5`);
      parts.push(`shadowx=${style.shadowX}`);
      parts.push(`shadowy=${style.shadowY}`);
    }

    return parts.join(':');
  });

  return filters.join(',');
}

/**
 * Convert CSS color to FFmpeg-compatible color string.
 */
function ffmpegColor(cssColor) {
  if (!cssColor) return 'black';
  if (cssColor.startsWith('#')) return cssColor;
  if (cssColor.startsWith('rgba')) {
    // rgba(r,g,b,a) → color@a
    const m = cssColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+),?\s*([\d.]+)?\)/);
    if (m) {
      const hex = '#' + [m[1], m[2], m[3]].map(v => parseInt(v).toString(16).padStart(2, '0')).join('');
      const alpha = m[4] != null ? m[4] : '1';
      return alpha === '1' ? hex : `${hex}@${alpha}`;
    }
  }
  return cssColor; // 'white', 'black', etc.
}
