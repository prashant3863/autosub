export const MAX_WIDTH_FRAC = 0.8;

export const SIZE_MULTIPLIERS = {
  small: 0.7,
  medium: 1.0,
  large: 1.3,
};

export const STYLE_PRESETS = {
  bold: {
    name: 'Bold',
    fontColor: 'white',
    baseFontDiv: 27,
    uppercase: true,
    borderw: 4,
    borderColor: 'black',
    bgBox: false,
    bgColor: null,
    yPosFrac: 0.6,
    shadowX: 2,
    shadowY: 2,
    shadowColor: 'rgba(0,0,0,0.5)',
  },
  clean: {
    name: 'Clean',
    fontColor: 'white',
    baseFontDiv: 35,
    uppercase: false,
    borderw: 2,
    borderColor: 'black',
    bgBox: false,
    bgColor: null,
    yPosFrac: 0.6,
    shadowX: 1,
    shadowY: 1,
    shadowColor: 'rgba(0,0,0,0.3)',
  },
  boxed: {
    name: 'Boxed',
    fontColor: 'white',
    baseFontDiv: 30,
    uppercase: true,
    borderw: 0,
    borderColor: null,
    bgBox: true,
    bgColor: 'rgba(0,0,0,0.6)',
    yPosFrac: 0.6,
    shadowX: 0,
    shadowY: 0,
    shadowColor: null,
  },
  pop: {
    name: 'Pop',
    fontColor: '#FFD700',
    baseFontDiv: 25,
    uppercase: true,
    borderw: 4,
    borderColor: 'black',
    bgBox: false,
    bgColor: null,
    yPosFrac: 0.6,
    shadowX: 3,
    shadowY: 3,
    shadowColor: 'rgba(0,0,0,0.6)',
  },
  minimal: {
    name: 'Minimal',
    fontColor: 'rgba(255,255,255,0.9)',
    baseFontDiv: 40,
    uppercase: false,
    borderw: 1,
    borderColor: 'rgba(0,0,0,0.5)',
    bgBox: false,
    bgColor: null,
    yPosFrac: 0.6,
    shadowX: 0,
    shadowY: 0,
    shadowColor: null,
  },
};

/**
 * Get font size in pixels for a given style, size multiplier, and video height.
 */
export function getStyleFontSize(style, sizeMult, height) {
  const mult = SIZE_MULTIPLIERS[sizeMult] || 1;
  return Math.round((height / style.baseFontDiv) * mult);
}

/**
 * Wrap text into lines that fit within maxWidth.
 */
export function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = words[0] || '';

  for (let i = 1; i < words.length; i++) {
    const testLine = currentLine + ' ' + words[i];
    if (ctx.measureText(testLine).width > maxWidth) {
      lines.push(currentLine);
      currentLine = words[i];
    } else {
      currentLine = testLine;
    }
  }
  lines.push(currentLine);
  return lines;
}

/**
 * Draw styled subtitle text on a canvas context.
 * Shared by both preview and burn-webcodecs.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text - Raw subtitle text
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @param {object} style - Style preset from STYLE_PRESETS
 * @param {string} sizeMult - 'small' | 'medium' | 'large'
 * @param {number|null} yOverride - Override Y position as fraction (0-1), null uses style default
 */
export function drawStyledSubtitle(ctx, text, width, height, style, sizeMult = 'medium', yOverride = null) {
  const displayText = style.uppercase ? text.toUpperCase() : text;
  const fontSize = getStyleFontSize(style, sizeMult, height);
  const maxWidth = width * MAX_WIDTH_FRAC;
  const lineHeight = fontSize * 1.2;
  const yFrac = yOverride ?? style.yPosFrac;

  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lines = wrapText(ctx, displayText, maxWidth);
  const totalHeight = lines.length * lineHeight;
  const x = width / 2;
  const baseY = height * yFrac - totalHeight / 2 + lineHeight / 2;

  // Draw composite background shape with concave notches at line junctions
  if (style.bgBox && style.bgColor && lines.length > 0) {
    const pad = fontSize * 0.3;
    const r = Math.round(fontSize * 0.3);

    // Parse alpha from bgColor
    let bgAlpha = 1;
    let bgOpaque = style.bgColor;
    const rgbaMatch = style.bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+),?\s*([\d.]+)?\)/);
    if (rgbaMatch && rgbaMatch[4] != null) {
      bgAlpha = parseFloat(rgbaMatch[4]);
      bgOpaque = `rgb(${rgbaMatch[1]},${rgbaMatch[2]},${rgbaMatch[3]})`;
    }

    // Compute bounding box for each line
    const boxes = lines.map((line, i) => {
      const lw = ctx.measureText(line).width;
      const cy = baseY + i * lineHeight;
      return {
        left: x - lw / 2 - pad,
        right: x + lw / 2 + pad,
        top: cy - fontSize * 0.6 - pad,
        bottom: cy - fontSize * 0.6 - pad + fontSize * 1.2 + pad * 2,
      };
    });

    const tmpCanvas = new OffscreenCanvas(width, height);
    const tmp = tmpCanvas.getContext('2d');
    tmp.fillStyle = bgOpaque;
    tmp.beginPath();

    const first = boxes[0];
    const last = boxes[boxes.length - 1];

    // Start top-left corner
    tmp.moveTo(first.left + r, first.top);
    // Top edge → top-right corner
    tmp.lineTo(first.right - r, first.top);
    tmp.arcTo(first.right, first.top, first.right, first.top + r, r);

    // Right side going down with concave notches at steps
    for (let i = 0; i < boxes.length - 1; i++) {
      const curr = boxes[i];
      const next = boxes[i + 1];
      const jY = (curr.bottom + next.top) / 2;

      if (Math.abs(curr.right - next.right) < 1) {
        // Same width — straight down
        tmp.lineTo(curr.right, next.top + r);
      } else if (curr.right > next.right) {
        // Wider → narrower: concave notch on right
        tmp.lineTo(curr.right, jY - r);
        tmp.arcTo(curr.right, jY, curr.right - r, jY, r);
        tmp.lineTo(next.right + r, jY);
        tmp.arcTo(next.right, jY, next.right, jY + r, r);
      } else {
        // Narrower → wider: concave notch on right
        tmp.lineTo(curr.right, jY - r);
        tmp.arcTo(curr.right, jY, curr.right + r, jY, r);
        tmp.lineTo(next.right - r, jY);
        tmp.arcTo(next.right, jY, next.right, jY + r, r);
      }
    }

    // Bottom-right corner
    tmp.lineTo(last.right, last.bottom - r);
    tmp.arcTo(last.right, last.bottom, last.right - r, last.bottom, r);
    // Bottom edge → bottom-left corner
    tmp.lineTo(last.left + r, last.bottom);
    tmp.arcTo(last.left, last.bottom, last.left, last.bottom - r, r);

    // Left side going up with concave notches at steps
    for (let i = boxes.length - 1; i > 0; i--) {
      const curr = boxes[i];
      const prev = boxes[i - 1];
      const jY = (prev.bottom + curr.top) / 2;

      if (Math.abs(curr.left - prev.left) < 1) {
        tmp.lineTo(curr.left, prev.bottom - r);
      } else if (curr.left < prev.left) {
        // Current wider on left → concave notch going up
        tmp.lineTo(curr.left, jY + r);
        tmp.arcTo(curr.left, jY, curr.left + r, jY, r);
        tmp.lineTo(prev.left - r, jY);
        tmp.arcTo(prev.left, jY, prev.left, jY - r, r);
      } else {
        // Current narrower → concave notch going up
        tmp.lineTo(curr.left, jY + r);
        tmp.arcTo(curr.left, jY, curr.left - r, jY, r);
        tmp.lineTo(prev.left + r, jY);
        tmp.arcTo(prev.left, jY, prev.left, jY - r, r);
      }
    }

    // Top-left corner (close path)
    tmp.lineTo(first.left, first.top + r);
    tmp.arcTo(first.left, first.top, first.left + r, first.top, r);
    tmp.closePath();
    tmp.fill();

    // Composite with desired alpha
    ctx.save();
    ctx.globalAlpha = bgAlpha;
    ctx.drawImage(tmpCanvas, 0, 0);
    ctx.restore();
  }

  for (let i = 0; i < lines.length; i++) {
    const y = baseY + i * lineHeight;

    // Shadow
    if (style.shadowColor && (style.shadowX || style.shadowY)) {
      ctx.fillStyle = style.shadowColor;
      ctx.fillText(lines[i], x + style.shadowX, y + style.shadowY);
    }

    // Outline
    if (style.borderw > 0 && style.borderColor) {
      ctx.strokeStyle = style.borderColor;
      ctx.lineWidth = style.borderw * (fontSize / 24);
      ctx.lineJoin = 'round';
      ctx.strokeText(lines[i], x, y);
    }

    // Fill
    ctx.fillStyle = style.fontColor;
    ctx.fillText(lines[i], x, y);
  }
}
