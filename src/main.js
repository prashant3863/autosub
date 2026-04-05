import { extractAudio } from './audio.js';
import { loadModel, transcribe, disposeModel } from './transcribe.js';
import { groupIntoCues, generateDrawtextFilter } from './subtitles.js';
import { burnSubtitles } from './burn.js';
import { isWebCodecsSupported, burnWithWebCodecs } from './burn-webcodecs.js';
import { STYLE_PRESETS } from './styles.js';
import { extractFrame, renderPreview, renderStyleCard } from './preview.js';
import * as perf from './perf.js';

// DOM elements
const fileInput = document.getElementById('videoFile');
const startBtn = document.getElementById('startBtn');
const uploadSection = document.getElementById('uploadSection');
const processingSection = document.getElementById('processingSection');
const editSection = document.getElementById('editSection');
const cueEditor = document.getElementById('cueEditor');
const confirmBurnBtn = document.getElementById('confirmBurnBtn');
const cancelEditBtn = document.getElementById('cancelEditBtn');
const downloadSection = document.getElementById('downloadSection');
const statusText = document.getElementById('statusText');
const progressBar = document.getElementById('progressBar');
const phaseText = document.getElementById('phaseText');
const downloadBtn = document.getElementById('downloadBtn');
const startOverBtn = document.getElementById('startOverBtn');
const styleCardsContainer = document.getElementById('styleCards');
const previewContainer = document.getElementById('previewContainer');
const previewCanvas = document.getElementById('previewCanvas');
const heightSlider = document.getElementById('heightSlider');

// State
let outputBlob = null;
let frameBitmap = null;
let selectedStyle = 'bold';
let pendingCues = null;
let pendingVideoFile = null;

// --- Init style cards ---
Object.entries(STYLE_PRESETS).forEach(([key, style]) => {
  const card = document.createElement('div');
  card.className = `style-card${key === selectedStyle ? ' active' : ''}`;
  card.dataset.style = key;

  const canvas = document.createElement('canvas');
  canvas.width = 200;
  canvas.height = 120;
  card.appendChild(canvas);
  styleCardsContainer.appendChild(card);

  renderStyleCard(canvas, style);

  card.addEventListener('click', () => {
    document.querySelectorAll('.style-card').forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    selectedStyle = key;

    const defaultY = Math.round(style.yPosFrac * 100);
    heightSlider.value = defaultY;
    document.getElementById('heightValue').textContent = `Position: ${defaultY}%`;

    updatePreview();
  });
});

// --- Event listeners ---
fileInput.addEventListener('change', async () => {
  const hasFile = fileInput.files.length > 0;
  startBtn.disabled = !hasFile;

  if (hasFile) {
    try {
      frameBitmap = await extractFrame(fileInput.files[0]);
      previewContainer.style.display = '';
      updatePreview();
    } catch (e) {
      console.warn('[preview] Failed to extract frame:', e);
      previewContainer.style.display = 'none';
    }
  }
});

startBtn.addEventListener('click', runTranscribe);
confirmBurnBtn.addEventListener('click', runBurn);
cancelEditBtn.addEventListener('click', () => location.reload());
startOverBtn.addEventListener('click', () => location.reload());

downloadBtn.addEventListener('click', () => {
  if (!outputBlob) return;
  const url = URL.createObjectURL(outputBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'subtitled_video.mp4';
  a.click();
  URL.revokeObjectURL(url);
});

document.querySelectorAll('.size-btn').forEach(btn => {
  btn.addEventListener('click', () => updatePreview());
});

heightSlider.addEventListener('input', () => updatePreview());

// --- Helper functions ---
function getVideoFormat() {
  return document.querySelector('#btnShort.active, #btnLong.active')?.dataset.value || 'short';
}

function getSubtitleSize() {
  return document.querySelector('.size-btn.active')?.dataset.value || 'medium';
}

function getHeightOverride() {
  return parseInt(heightSlider.value, 10) / 100;
}

function getSelectedStyle() {
  return STYLE_PRESETS[selectedStyle];
}

function updatePreview() {
  if (!frameBitmap) return;
  renderPreview(previewCanvas, frameBitmap, getSelectedStyle(), getSubtitleSize(), getHeightOverride());
}

const indeterminateBar = document.getElementById('indeterminateBar');

function showPhase(phase, progress = -1) {
  phaseText.textContent = phase;
  if (progress >= 0) {
    // Determinate: show <progress> with value
    progressBar.value = progress;
    progressBar.style.display = '';
    indeterminateBar.style.display = 'none';
  } else {
    // Indeterminate: show animated sliding bar
    progressBar.style.display = 'none';
    indeterminateBar.style.display = '';
  }
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

/**
 * Populate the cue editor with editable inputs.
 */
function populateCueEditor(cues) {
  cueEditor.innerHTML = '';
  for (let i = 0; i < cues.length; i++) {
    const row = document.createElement('div');
    row.className = 'cue-row';

    const time = document.createElement('span');
    time.className = 'cue-time';
    time.textContent = `${formatTime(cues[i].start)} → ${formatTime(cues[i].end)}`;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cue-text';
    input.value = cues[i].text;
    input.dataset.index = i;

    row.appendChild(time);
    row.appendChild(input);
    cueEditor.appendChild(row);
  }
}

/**
 * Read edited cue texts back from the editor inputs.
 */
function readEditedCues() {
  const inputs = cueEditor.querySelectorAll('.cue-text');
  inputs.forEach((input) => {
    const idx = parseInt(input.dataset.index, 10);
    if (pendingCues[idx]) {
      pendingCues[idx].text = input.value;
    }
  });
  // Remove cues with empty text
  return pendingCues.filter(c => c.text.trim().length > 0);
}

// --- Pipeline Part 1: Transcribe → show editor ---
async function runTranscribe() {
  const videoFile = fileInput.files[0];
  if (!videoFile) return;

  pendingVideoFile = videoFile;
  const format = getVideoFormat();

  perf.reset();
  perf.mark('start');

  uploadSection.style.display = 'none';
  processingSection.style.display = '';

  try {
    showPhase('Downloading speech model (first time only)...');
    await loadModel((event) => {
      if (event.status === 'progress' && event.progress != null) {
        showPhase('Downloading speech model...', Math.round(event.progress));
      }
    });
    perf.mark('model loaded');

    showPhase('Extracting audio...');
    let audio = await extractAudio(videoFile);
    perf.mark('audio extracted');

    showPhase('Transcribing speech (this may take a minute)...');
    const liveTranscript = document.getElementById('liveTranscript');
    liveTranscript.style.display = '';
    liveTranscript.innerHTML = '';
    const chunks = await transcribe(audio, ({ text, progress }) => {
      showPhase('Transcribing speech...', progress);
      if (text) {
        const span = document.createElement('span');
        span.className = 'new-chunk';
        span.textContent = text + ' ';
        liveTranscript.appendChild(span);
        liveTranscript.scrollTop = liveTranscript.scrollHeight;
      }
    });
    liveTranscript.style.display = 'none';
    perf.mark('transcription done');

    audio = null;
    showPhase('Freeing memory...');
    await disposeModel();
    perf.mark('model disposed');

    if (!chunks || chunks.length === 0) {
      statusText.textContent = 'No speech detected in the video.';
      phaseText.textContent = '';
      progressBar.style.display = 'none';
      perf.report();
      return;
    }

    pendingCues = groupIntoCues(chunks, format);
    perf.mark('cues generated');

    // Show edit section
    processingSection.style.display = 'none';
    editSection.style.display = '';
    populateCueEditor(pendingCues);

  } catch (err) {
    statusText.textContent = `Error: ${err.message}`;
    phaseText.textContent = '';
    progressBar.style.display = 'none';
    console.error(err);
    perf.mark('error');
    perf.report();
  }
}

// --- Pipeline Part 2: Burn (after user confirms edits) ---
async function runBurn() {
  const cues = readEditedCues();
  if (cues.length === 0) {
    alert('No subtitle cues to burn.');
    return;
  }

  const size = getSubtitleSize();
  const style = getSelectedStyle();
  const yOverride = getHeightOverride();
  console.log(`[config] size: ${size}, style: ${selectedStyle}, y: ${yOverride}, cues: ${cues.length}`);

  editSection.style.display = 'none';
  processingSection.style.display = '';

  try {
    showPhase('Burning subtitles into video...', 0);

    const useWebCodecs = isWebCodecsSupported();
    console.log(`[burn] Using ${useWebCodecs ? 'WebCodecs (hardware)' : 'FFmpeg (software)'}`);

    if (useWebCodecs) {
      showPhase('Burning subtitles (hardware accelerated)...', 0);
      try {
        outputBlob = await burnWithWebCodecs(pendingVideoFile, cues, style, size, yOverride, (p) => {
          showPhase('Burning subtitles (hardware accelerated)...', p);
        });
      } catch (e) {
        console.warn('[burn] WebCodecs failed, falling back to FFmpeg:', e);
        showPhase('WebCodecs failed, falling back to FFmpeg...', 0);
        const filterString = generateDrawtextFilter(cues, style, size, yOverride);
        outputBlob = await burnSubtitles(pendingVideoFile, filterString, (p) => {
          showPhase('Burning subtitles (software)...', p);
        });
      }
    } else {
      const filterString = generateDrawtextFilter(cues, style, size, yOverride);
      outputBlob = await burnSubtitles(pendingVideoFile, filterString, (p) => {
        showPhase('Burning subtitles (software)...', p);
      });
    }
    perf.mark('burn complete');

    processingSection.style.display = 'none';
    downloadSection.style.display = '';
    const sizeMB = (outputBlob.size / 1024 / 1024).toFixed(1);
    document.getElementById('fileSize').textContent = `(${sizeMB} MB)`;

    perf.mark('done');
    perf.report();

  } catch (err) {
    statusText.textContent = `Error: ${err.message}`;
    phaseText.textContent = '';
    progressBar.style.display = 'none';
    console.error(err);
    perf.mark('error');
    perf.report();
  }
}
