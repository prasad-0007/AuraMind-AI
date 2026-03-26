/**
 * AuraMind PRO v2.1 — script.js
 * Improved: modular, robust error handling, state management,
 * smooth UX, bilingual messages, emotion chip tracking.
 */

'use strict';

/* ─── Constants ──────────────────────────────────────────────── */
const MODEL_URL     = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/';
const DETECT_INTERVAL_MS = 300;   // ms between detections
const INPUT_SIZE     = 128;       // TinyFaceDetector input (faster)
const SCORE_THRESH   = 0.4;

/** Weighted stress formula coefficients */
const STRESS_WEIGHTS = {
  angry:    1.5,
  fearful:  1.2,
  sad:      1.0,
  disgusted: 0.7,
  surprised: 0.3,
};

const STRESS_THRESHOLDS = { HIGH: 35, MID: 15 };

/* ─── Counselor messages per state ──────────────────────────── */
const MESSAGES = {
  flow: [
    "Excellent mood — your retention is high right now. Keep going!",
    "You're in a great headspace. This is the perfect time to tackle tough topics.",
    "Peak engagement detected. Ride this wave!",
  ],
  focus: [
    "तुम्ही एकाग्र आहात. धड्याकडे लक्ष द्या! (You're focused — keep learning!)",
    "Steady concentration detected. You're in the zone.",
    "Strong focus. Take brief notes to lock in what you're learning.",
  ],
  fatigue: [
    "तुमच्या चेहऱ्यावर ताण जाणवत आहे. थोडा श्वास घ्या! (Stress detected — breathe!)",
    "Fatigue alert. Try the 4-7-8 breathing technique: inhale 4s, hold 7s, exhale 8s.",
    "High cognitive load detected. A 5-minute break now saves 30 minutes of lost focus.",
    "Consider stepping away briefly. Your brain needs recovery time to consolidate learning.",
  ],
  searching: [
    "Calibrating… Please face the camera directly.",
    "Face not detected. Adjust your distance or lighting.",
  ],
};

/* ─── DOM References ─────────────────────────────────────────── */
const $  = id => document.getElementById(id);
const video         = $('video');
const tutorText     = $('tutor-text');
const stressBar     = $('stress-bar');
const stressPercent = $('stress-percent');
const stateText     = $('state-text');
const emotionTag    = $('emotion-tag');
const loaderOverlay = $('loader-overlay');
const loaderIcon    = $('loader-icon');
const loaderMsg     = $('loader-msg');
const statusDot     = $('status-dot');
const statusLabel   = $('status-label');
const endBtn        = $('end-btn');
const cameraPanel   = $('camera-panel');
const reportModal   = $('report-modal');

/* ─── App State ──────────────────────────────────────────────── */
const state = {
  sessionActive: false,
  stressHistory: [],          // array of { value, ts }
  currentEmotion: 'neutral',
  detectionLoop: null,
  messageTimers: {},
  lastMessageIndex: {},
};

/* ─── Utility ────────────────────────────────────────────────── */
function randomMessage(category) {
  const pool = MESSAGES[category];
  const last = state.lastMessageIndex[category] ?? -1;
  let idx;
  do { idx = Math.floor(Math.random() * pool.length); }
  while (pool.length > 1 && idx === last);
  state.lastMessageIndex[category] = idx;
  return pool[idx];
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

/** Fade-swap text with minimal flicker */
function setTutorText(msg) {
  if (tutorText.innerText === msg) return;
  tutorText.style.opacity = '0';
  setTimeout(() => {
    tutorText.innerText = msg;
    tutorText.style.opacity = '1';
  }, 180);
}

/* ─── Emotion Chips ──────────────────────────────────────────── */
const EMOTION_KEYS = ['happy','neutral','sad','angry','fearful','disgusted','surprised'];

function buildEmotionChips() {
  const container = $('emotion-chips');
  if (!container) return;
  container.innerHTML = '';
  EMOTION_KEYS.forEach(e => {
    const span = document.createElement('span');
    span.className = 'chip';
    span.id = `chip-${e}`;
    span.textContent = e;
    container.appendChild(span);
  });
}

function updateChips(dominant) {
  EMOTION_KEYS.forEach(e => {
    const chip = $(`chip-${e}`);
    if (!chip) return;
    chip.classList.toggle('active-chip', e === dominant);
  });
}

/* ─── Status helpers ─────────────────────────────────────────── */
function setStatus(dotClass, label) {
  statusDot.className = `status-dot ${dotClass}`;
  statusLabel.innerText = label;
}

function setCameraGlow(type) {
  cameraPanel.classList.remove('active-blue', 'active-emerald', 'active-red');
  if (type) cameraPanel.classList.add(`active-${type}`);
}

/* ─── Bootstrap ──────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  buildEmotionChips();
});

/* ─── forceStart — load models then open camera ──────────────── */
async function forceStart() {
  const startBtn = document.querySelector('.start-btn');
  if (startBtn) startBtn.disabled = true;

  try {
    // Show spinner
    loaderIcon.classList.add('visible');
    loaderMsg.innerText = 'Loading neural models…';
    setStatus('idle', 'Loading AI…');

    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      faceapi.nets.faceExpressionNet.loadFromUri(MODEL_URL),
    ]);

    loaderMsg.innerText = 'Requesting camera…';
    await startVideo();

    // Dismiss overlay
    loaderOverlay.style.opacity = '0';
    setTimeout(() => { loaderOverlay.style.display = 'none'; }, 350);

  } catch (err) {
    console.error('[AuraMind] Init error:', err);
    loaderIcon.classList.remove('visible');
    loaderMsg.innerText = '⚠ Failed to start. Check permissions.';
    setStatus('offline', 'ERROR');
    if (startBtn) {
      startBtn.disabled = false;
      startBtn.textContent = 'RETRY';
    }
  }
}

/* ─── Camera ─────────────────────────────────────────────────── */
async function startVideo() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 30 } },
  });
  video.srcObject = stream;

  return new Promise((resolve, reject) => {
    video.onloadedmetadata = () => {
      video.play().then(() => {
        state.sessionActive = true;
        endBtn.classList.add('visible');
        setStatus('active', 'AI ACTIVE');
        beginAnalysis();
        resolve();
      }).catch(reject);
    };
    video.onerror = reject;
  });
}

/* ─── Analysis Loop ──────────────────────────────────────────── */
function beginAnalysis() {
  const options = new faceapi.TinyFaceDetectorOptions({
    inputSize: INPUT_SIZE,
    scoreThreshold: SCORE_THRESH,
  });

  state.detectionLoop = setInterval(async () => {
    if (!state.sessionActive || video.paused || video.ended) return;

    try {
      const detections = await faceapi
        .detectAllFaces(video, options)
        .withFaceExpressions();

      if (detections && detections.length > 0) {
        processDetection(detections[0].expressions);
      } else {
        handleNoFace();
      }
    } catch (err) {
      // Silently ignore single-frame failures (tab blur, etc.)
    }
  }, DETECT_INTERVAL_MS);
}

/* ─── Process a single detection ────────────────────────────── */
function processDetection(e) {
  // Compute stress score
  const raw = Object.entries(STRESS_WEIGHTS).reduce((acc, [key, w]) => {
    return acc + (e[key] ?? 0) * w;
  }, 0);
  const stressVal = clamp(Math.round(raw * 100), 0, 100);

  // Record with timestamp
  state.stressHistory.push({ value: stressVal, ts: Date.now() });

  // Dominant emotion
  const dominant = Object.entries(e).sort((a, b) => b[1] - a[1])[0][0];
  state.currentEmotion = dominant;

  // Update chips & badge
  updateChips(dominant);
  emotionTag.innerText = dominant.toUpperCase();

  updateUI(stressVal, e.happy ?? 0, dominant);
}

/* ─── Handle face not found ──────────────────────────────────── */
function handleNoFace() {
  emotionTag.innerText = 'RE-CALIBRATING';
  stateText.innerText = 'SEARCHING…';
  stateText.className = 'text-dim';
  setCameraGlow(null);

  // Throttle message updates
  clearTimeout(state.messageTimers.noFace);
  state.messageTimers.noFace = setTimeout(() => {
    setTutorText(randomMessage('searching'));
  }, 800);
}

/* ─── Update UI based on stress value ───────────────────────── */
function updateUI(val, happy, emotion) {
  // Bar & percentage
  stressPercent.innerText = `${val}%`;
  stressBar.style.width   = `${Math.max(4, val)}%`;

  if (val > STRESS_THRESHOLDS.HIGH) {
    // ── Fatigue / Stress
    stressBar.style.background = 'var(--accent-red)';
    stressPercent.className    = 'high';
    stateText.innerText        = 'FATIGUE ALERT';
    stateText.className        = 'alert';
    setCameraGlow('red');
    throttleMessage('fatigue');

  } else if (happy > 0.28) {
    // ── Flow State
    stressBar.style.background = 'var(--accent-emerald)';
    stressPercent.className    = 'low';
    stateText.innerText        = 'FLOW STATE';
    stateText.className        = 'calm';
    setCameraGlow('emerald');
    throttleMessage('flow');

  } else {
    // ── Focused / Neutral
    stressBar.style.background = 'var(--accent-blue)';
    stressPercent.className    = 'mid';
    stateText.innerText        = 'CONCENTRATING';
    stateText.className        = 'focused';
    setCameraGlow('blue');
    throttleMessage('focus');
  }
}

/**
 * Only rotate message every 8 seconds per category,
 * preventing rapid text flicker.
 */
function throttleMessage(category) {
  const key = `msg_${category}`;
  if (state.messageTimers[key]) return;
  setTutorText(randomMessage(category));
  state.messageTimers[key] = setTimeout(() => {
    delete state.messageTimers[key];
  }, 8000);
}

/* ─── End Session ────────────────────────────────────────────── */
function endSession() {
  state.sessionActive = false;
  clearInterval(state.detectionLoop);

  // Stop camera
  if (video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
  }

  // Compute analytics
  const values    = state.stressHistory.map(d => d.value);
  const avgStress = values.length ? mean(values).toFixed(1) : 0;
  const peakStress = values.length ? Math.max(...values) : 0;

  const isStressed = Number(avgStress) > STRESS_THRESHOLDS.HIGH;

  $('avg-stress').innerText  = `${avgStress}%`;
  $('peak-stress').innerText = isStressed ? 'STRESSED' : 'FOCUSED';
  $('peak-stress').className = `tile-value ${isStressed ? 'red' : 'emerald'}`;
  $('peak-val').innerText    = `${peakStress}%`;

  $('report-advice').innerText = isStressed
    ? "Your session showed elevated stress levels. Try the Pomodoro Technique (25 min focus / 5 min rest) and ensure good lighting and posture."
    : "Great session! Your focus was consistent throughout. Keep maintaining this study rhythm.";

  reportModal.classList.add('open');
}

/* ─── Expose to HTML ─────────────────────────────────────────── */
window.forceStart  = forceStart;
window.endSession  = endSession;
