import {
  HandLandmarker,
  FilesetResolver,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm";

const WASM_BASE =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

// Landmark indices we anchor germs to: palm points + knuckle/tip joints.
const GERM_ANCHORS = [0, 1, 2, 5, 6, 8, 9, 10, 12, 13, 14, 16, 17, 18, 20];
const GERMS_PER_HAND = 12;
const FADE_MS = 550;
const SPAWN_MS = 350;

const video = document.getElementById("video");
const canvas = document.getElementById("output");
const ctx = canvas.getContext("2d");
const statusOverlay = document.getElementById("statusOverlay");
const statusText = document.getElementById("statusText");
const retryBtn = document.getElementById("retryBtn");
const cleanToggle = document.getElementById("cleanToggle");
const cleanBanner = document.getElementById("cleanBanner");
const germCountEl = document.getElementById("germCount");
const cleanedCountEl = document.getElementById("cleanedCount");
const flipCameraBtn = document.getElementById("flipCameraBtn");
const infoBtn = document.getElementById("infoBtn");
const closeInfoBtn = document.getElementById("closeInfoBtn");
const infoModal = document.getElementById("infoModal");

let handLandmarker = null;
let currentStream = null;
let facingMode = "environment";
let mirrored = false;
let handsClean = false; // start "dirty" so germs are visible right away
let cleanedTotal = 0;
let lastVideoTime = -1;
let latestResults = null;

/** handSlot key (0/1 by detection order) -> { germs: [...] } */
const handSlots = new Map();
let germIdCounter = 0;

function setStatus(message, showRetry = false) {
  statusText.textContent = message;
  retryBtn.classList.toggle("hidden", !showRetry);
  statusOverlay.classList.remove("hidden");
}

function hideStatus() {
  statusOverlay.classList.add("hidden");
}

async function initHandLandmarker() {
  const vision = await FilesetResolver.forVisionTasks(WASM_BASE);
  try {
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  } catch (err) {
    // Some devices don't support GPU delegate for WASM; fall back to CPU.
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  }
}

async function startCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach((t) => t.stop());
  }
  const constraints = {
    video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  };
  currentStream = await navigator.mediaDevices.getUserMedia(constraints);
  video.srcObject = currentStream;
  mirrored = facingMode === "user";
  await new Promise((resolve) => {
    video.onloadedmetadata = () => {
      video.play();
      resolve();
    };
  });
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
}

function isSecureContextOk() {
  return (
    window.isSecureContext ||
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1"
  );
}

async function boot() {
  if (!isSecureContextOk()) {
    setStatus(
      "La cámara requiere HTTPS. Abre esta app desde una URL segura (https) o localhost."
    );
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("Tu navegador no soporta acceso a la cámara.");
    return;
  }

  setStatus("Cargando modelo de detección de manos…");
  try {
    await initHandLandmarker();
  } catch (err) {
    console.error(err);
    setStatus("No se pudo cargar el modelo de IA. Revisa tu conexión.", true);
    return;
  }

  setStatus("Solicitando acceso a la cámara…");
  try {
    await startCamera();
  } catch (err) {
    console.error(err);
    setStatus(
      "No se pudo acceder a la cámara. Otorga permiso e inténtalo de nuevo.",
      true
    );
    return;
  }

  hideStatus();
  requestAnimationFrame(renderLoop);
}

retryBtn.addEventListener("click", () => {
  setStatus("Reintentando…");
  boot();
});

flipCameraBtn.addEventListener("click", async () => {
  facingMode = facingMode === "environment" ? "user" : "environment";
  handSlots.clear();
  try {
    await startCamera();
  } catch (err) {
    console.error(err);
    setStatus("No se pudo cambiar de cámara.", true);
  }
});

cleanToggle.addEventListener("change", () => {
  handsClean = cleanToggle.checked;
  const now = performance.now();
  let justRemoved = 0;
  for (const slot of handSlots.values()) {
    if (handsClean) {
      for (const germ of slot.germs) {
        if (!germ.removing) {
          germ.removing = true;
          germ.removeStart = now;
          justRemoved++;
        }
      }
    } else {
      // will be repopulated on next detection frame
      slot.needsSpawn = true;
    }
  }
  if (handsClean) {
    cleanedTotal += justRemoved;
    cleanedCountEl.textContent = String(cleanedTotal);
    cleanBanner.classList.remove("hidden");
    setTimeout(() => cleanBanner.classList.add("hidden"), 1200);
  }
});

infoBtn.addEventListener("click", () => infoModal.classList.remove("hidden"));
closeInfoBtn.addEventListener("click", () =>
  infoModal.classList.add("hidden")
);

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function spawnGermsForHand(slot, now) {
  slot.germs = [];
  for (let i = 0; i < GERMS_PER_HAND; i++) {
    slot.germs.push({
      id: germIdCounter++,
      anchor: GERM_ANCHORS[i % GERM_ANCHORS.length],
      offsetX: randRange(-0.025, 0.025),
      offsetY: randRange(-0.025, 0.025),
      phase: randRange(0, Math.PI * 2),
      wiggleSpeed: randRange(1.2, 2.4),
      baseSize: randRange(9, 16),
      hue: randRange(75, 130),
      spawnStart: now,
      removing: false,
      removeStart: 0,
    });
  }
  slot.needsSpawn = false;
}

function drawGerm(x, y, size, hue, wiggleT) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(wiggleT) * 0.3);
  const bodyColor = `hsl(${hue}, 55%, 42%)`;
  const spikeColor = `hsl(${hue}, 60%, 30%)`;

  // spikes
  const spikeCount = 8;
  ctx.strokeStyle = spikeColor;
  ctx.lineWidth = Math.max(1.5, size * 0.12);
  for (let i = 0; i < spikeCount; i++) {
    const angle = (i / spikeCount) * Math.PI * 2;
    const wobble = Math.sin(wiggleT * 2 + i) * 2;
    const innerR = size * 0.55;
    const outerR = size * 0.85 + wobble;
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle) * innerR, Math.sin(angle) * innerR);
    ctx.lineTo(Math.cos(angle) * outerR, Math.sin(angle) * outerR);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(Math.cos(angle) * outerR, Math.sin(angle) * outerR, size * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = spikeColor;
    ctx.fill();
  }

  // body
  ctx.beginPath();
  ctx.ellipse(0, 0, size * 0.6, size * 0.5, 0, 0, Math.PI * 2);
  ctx.fillStyle = bodyColor;
  ctx.fill();

  // little nucleus dots
  ctx.fillStyle = `hsl(${hue}, 70%, 60%)`;
  ctx.beginPath();
  ctx.arc(-size * 0.15, -size * 0.05, size * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(size * 0.18, size * 0.1, size * 0.09, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function updateAndDrawGerms(landmarks, slot, now) {
  let activeCount = 0;
  slot.germs = slot.germs.filter((germ) => {
    let scale = 1;
    if (germ.spawnStart && now - germ.spawnStart < SPAWN_MS) {
      scale = (now - germ.spawnStart) / SPAWN_MS;
    }
    if (germ.removing) {
      const t = (now - germ.removeStart) / FADE_MS;
      if (t >= 1) return false; // fully faded, drop it
      scale = 1 - t;
    } else {
      activeCount++;
    }

    const lm = landmarks[germ.anchor];
    if (!lm) return true;
    const wiggleT = now / 1000 * germ.wiggleSpeed + germ.phase;
    const jitterX = Math.sin(wiggleT) * 0.008;
    const jitterY = Math.cos(wiggleT * 1.3) * 0.008;
    const x = (lm.x + germ.offsetX + jitterX) * canvas.width;
    const y = (lm.y + germ.offsetY + jitterY) * canvas.height;
    const size = germ.baseSize * scale;

    if (scale > 0.01) {
      ctx.globalAlpha = Math.max(0, Math.min(1, scale));
      drawGerm(x, y, size, germ.hue, wiggleT);
      ctx.globalAlpha = 1;
    }
    return true;
  });
  return activeCount;
}

function renderLoop() {
  requestAnimationFrame(renderLoop);
  if (video.readyState < 2) return;

  ctx.save();
  if (mirrored) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

  if (handLandmarker && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    latestResults = handLandmarker.detectForVideo(video, performance.now());
  }

  const now = performance.now();
  let totalActive = 0;
  const seenSlots = new Set();

  if (latestResults && latestResults.landmarks) {
    latestResults.landmarks.forEach((landmarks, i) => {
      seenSlots.add(i);
      let slot = handSlots.get(i);
      if (!slot) {
        slot = { germs: [], needsSpawn: !handsClean };
        handSlots.set(i, slot);
      }
      if (!handsClean && (slot.needsSpawn || slot.germs.length === 0)) {
        spawnGermsForHand(slot, now);
      }
      totalActive += updateAndDrawGerms(landmarks, slot, now);
    });
  }

  // Clean up slots for hands no longer detected (once their fade finishes).
  for (const [key, slot] of handSlots) {
    if (!seenSlots.has(key) && slot.germs.length === 0) {
      handSlots.delete(key);
    }
  }

  ctx.restore();

  if (!latestResults || !latestResults.landmarks || latestResults.landmarks.length === 0) {
    drawHint();
  }

  germCountEl.textContent = String(totalActive);
}

function drawHint() {
  ctx.save();
  ctx.font = "16px -apple-system, sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.textAlign = "center";
  ctx.fillText(
    "👋 Muestra tus manos a la cámara",
    canvas.width / 2,
    canvas.height - 24
  );
  ctx.restore();
}

boot();
