import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js";
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  Schema
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-ai.js";
import {
  appCheckSiteKey,
  firebaseConfig,
  geminiModelName,
  useAppCheckDebugToken
} from "./firebase-config.js";

const tileDefinitions = [
  ...Array.from({ length: 9 }, (_, index) => ({
    code: `CHARACTERS_${index + 1}`,
    label: `${index + 1} Characters`,
    group: "Characters",
    symbol: String.fromCodePoint(0x1f007 + index)
  })),
  ...Array.from({ length: 9 }, (_, index) => ({
    code: `BAMBOO_${index + 1}`,
    label: `${index + 1} Bamboo`,
    group: "Bamboo",
    symbol: String.fromCodePoint(0x1f010 + index)
  })),
  ...Array.from({ length: 9 }, (_, index) => ({
    code: `DOTS_${index + 1}`,
    label: `${index + 1} Dots`,
    group: "Dots",
    symbol: String.fromCodePoint(0x1f019 + index)
  })),
  { code: "EAST", label: "East", group: "Honors", symbol: "🀀" },
  { code: "SOUTH", label: "South", group: "Honors", symbol: "🀁" },
  { code: "WEST", label: "West", group: "Honors", symbol: "🀂" },
  { code: "NORTH", label: "North", group: "Honors", symbol: "🀃" },
  { code: "RED_DRAGON", label: "Red Dragon", group: "Honors", symbol: "🀄" },
  { code: "GREEN_DRAGON", label: "Green Dragon", group: "Honors", symbol: "🀅" },
  { code: "WHITE_DRAGON", label: "White Dragon", group: "Honors", symbol: "🀆" },
  { code: "FLOWER_PLUM", label: "Flower: Plum", group: "Bonus", symbol: "🀢" },
  { code: "FLOWER_ORCHID", label: "Flower: Orchid", group: "Bonus", symbol: "🀣" },
  { code: "FLOWER_BAMBOO", label: "Flower: Bamboo", group: "Bonus", symbol: "🀤" },
  { code: "FLOWER_CHRYSANTHEMUM", label: "Flower: Chrysanthemum", group: "Bonus", symbol: "🀥" },
  { code: "SEASON_SPRING", label: "Season: Spring", group: "Bonus", symbol: "🀦" },
  { code: "SEASON_SUMMER", label: "Season: Summer", group: "Bonus", symbol: "🀧" },
  { code: "SEASON_AUTUMN", label: "Season: Autumn", group: "Bonus", symbol: "🀨" },
  { code: "SEASON_WINTER", label: "Season: Winter", group: "Bonus", symbol: "🀩" },
  { code: "UNKNOWN", label: "Unknown tile", group: "Other", symbol: "?" }
];

const tileByCode = new Map(tileDefinitions.map((tile) => [tile.code, tile]));
const tileCodes = tileDefinitions.map((tile) => tile.code);

const recognitionSchema = Schema.object({
  properties: {
    photoQuality: Schema.enumString({
      enum: ["good", "usable", "poor"]
    }),
    tiles: Schema.array({
      maxItems: 40,
      items: Schema.object({
        properties: {
          code: Schema.enumString({ enum: tileCodes }),
          confidence: Schema.number()
        }
      })
    }),
    warnings: Schema.array({
      maxItems: 12,
      items: Schema.string()
    })
  }
});

const recognitionPrompt = `
Act as a careful visual Mahjong tile transcriber. Inspect the photograph and
return only the visible, face-up Mahjong tiles belonging to the photographed
hand. Do not determine whether the hand wins, calculate points, or sort it.

Ordering:
- Transcribe tiles left-to-right within each row.
- For multiple rows, process the upper/far row first, then move downward.
- Keep duplicates as separate entries.
- Ignore racks, dice, counters, table patterns, labels, and face-down tiles.
- Use UNKNOWN for a visible physical tile whose face cannot be identified.
- Never invent tiles hidden by cropping or overlap.

Visual conventions:
- CHARACTERS_1..9 are character/wan tiles.
- BAMBOO_1..9 are bamboo/stick/sou tiles; BAMBOO_1 often depicts a bird.
- DOTS_1..9 are circle/dot/pin tiles.
- EAST, SOUTH, WEST, NORTH are winds.
- RED_DRAGON, GREEN_DRAGON, WHITE_DRAGON are dragons.
- FLOWER_* and SEASON_* are bonus tiles.

For each classification, give a visual confidence between 0 and 1. Mention
blur, glare, cropping, overlap, steep perspective, and ambiguous regional
artwork in warnings. Allowed codes: ${tileCodes.join(", ")}.
`;

const elements = {
  connectionBadge: document.getElementById("connectionBadge"),
  setupNotice: document.getElementById("setupNotice"),
  cameraFrame: document.getElementById("cameraFrame"),
  camera: document.getElementById("camera"),
  photoPreview: document.getElementById("photoPreview"),
  canvas: document.getElementById("captureCanvas"),
  startCameraButton: document.getElementById("startCameraButton"),
  captureButton: document.getElementById("captureButton"),
  photoInput: document.getElementById("photoInput"),
  recognizeButton: document.getElementById("recognizeButton"),
  demoButton: document.getElementById("demoButton"),
  status: document.getElementById("status"),
  qualityBadge: document.getElementById("qualityBadge"),
  countBadge: document.getElementById("countBadge"),
  resultEmpty: document.getElementById("resultEmpty"),
  tileList: document.getElementById("tileList"),
  warningList: document.getElementById("warningList"),
  resultActions: document.getElementById("resultActions"),
  addTileButton: document.getElementById("addTileButton"),
  confirmButton: document.getElementById("confirmButton"),
  confirmedOutput: document.getElementById("confirmedOutput")
};

let cameraStream = null;
let imageDataUrl = null;
let recognitionModel = null;
let recognizedTiles = [];
let resultsLoaded = false;
let recognizing = false;

function hasPlaceholder(value) {
  return typeof value !== "string" || !value.trim() || value.includes("REPLACE_WITH_");
}

function configurationIsComplete() {
  const requiredKeys = ["apiKey", "authDomain", "projectId", "appId"];
  return requiredKeys.every((key) => !hasPlaceholder(firebaseConfig[key])) &&
    !hasPlaceholder(appCheckSiteKey);
}

function setConnectionState(label, state = "") {
  elements.connectionBadge.textContent = label;
  elements.connectionBadge.className = `connection-badge ${state}`.trim();
}

function setStatus(message, state = "") {
  elements.status.textContent = message;
  elements.status.className = `status ${state}`.trim();
}

function syncRecognizeButton() {
  elements.recognizeButton.disabled = !imageDataUrl || !recognitionModel || recognizing;
}

function initializeFirebase() {
  if (!configurationIsComplete()) {
    elements.setupNotice.hidden = false;
    setConnectionState("Setup needed", "error");
    syncRecognizeButton();
    return;
  }

  try {
    // The debug override must be set before App Check is initialized. Firebase
    // prints the token to the console; register it in the App Check console.
    if (useAppCheckDebugToken) {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }

    const app = initializeApp(firebaseConfig);
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true
    });

    const ai = getAI(app, { backend: new GoogleAIBackend() });
    recognitionModel = getGenerativeModel(ai, {
      model: geminiModelName,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: recognitionSchema,
        temperature: 0.1,
        maxOutputTokens: 2048
      }
    });

    setConnectionState("Firebase ready", "ready");
    elements.setupNotice.hidden = true;
    syncRecognizeButton();
  } catch (error) {
    console.error("Firebase initialization failed", error);
    setConnectionState("Firebase error", "error");
    elements.setupNotice.hidden = false;
    setStatus(`Firebase could not start: ${error.message}`, "error");
  }
}

function stopCamera() {
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop();
    cameraStream = null;
  }
  elements.camera.srcObject = null;
  elements.camera.classList.remove("active");
  elements.cameraFrame.classList.remove("live");
  elements.captureButton.disabled = true;
  elements.startCameraButton.textContent = "Start camera";
}

async function startCamera() {
  if (!window.isSecureContext) {
    setStatus("Camera access requires HTTPS or localhost. You can still choose a saved photo.", "error");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("Live camera is unavailable in this browser. Choose a saved photo instead.", "error");
    return;
  }

  try {
    stopCamera();
    setStatus("Requesting camera permission…", "working");
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    });
    elements.camera.srcObject = cameraStream;
    await elements.camera.play();
    elements.photoPreview.classList.remove("active");
    elements.camera.classList.add("active");
    elements.cameraFrame.classList.add("live");
    elements.cameraFrame.classList.remove("has-photo");
    elements.captureButton.disabled = false;
    elements.startCameraButton.textContent = "Restart camera";
    setStatus("Camera ready. Align the tiles inside the guide, then take the photo.");
  } catch (error) {
    stopCamera();
    setStatus(`Could not start the camera: ${error.message}. Try “Choose photo.”`, "error");
  }
}

function clearRecognitionResult() {
  recognizedTiles = [];
  resultsLoaded = false;
  elements.tileList.replaceChildren();
  elements.resultEmpty.hidden = false;
  elements.resultEmpty.textContent = "Recognition results will appear here. AI can make mistakes, so always check the tile faces before scoring.";
  elements.resultActions.hidden = true;
  elements.countBadge.hidden = true;
  setQuality("");
  renderWarnings([]);
  elements.confirmedOutput.classList.remove("active");
}

function drawSourceToCanvas(source, sourceWidth, sourceHeight) {
  const maximumDimension = 2048;
  const scale = Math.min(1, maximumDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  elements.canvas.width = width;
  elements.canvas.height = height;
  const context = elements.canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);

  imageDataUrl = elements.canvas.toDataURL("image/jpeg", 0.9);
  elements.photoPreview.src = imageDataUrl;
  elements.photoPreview.classList.add("active");
  elements.camera.classList.remove("active");
  elements.cameraFrame.classList.remove("live");
  elements.cameraFrame.classList.add("has-photo");
  clearRecognitionResult();
  syncRecognizeButton();

  if (recognitionModel) {
    setStatus(`Photo ready (${width} × ${height}). Press “Recognize tiles.”`);
  } else {
    setStatus(`Photo ready (${width} × ${height}). Configure Firebase to enable recognition.`, "working");
  }
}

function capturePhoto() {
  if (!elements.camera.videoWidth || !elements.camera.videoHeight) {
    setStatus("The camera is not ready yet.", "error");
    return;
  }
  drawSourceToCanvas(elements.camera, elements.camera.videoWidth, elements.camera.videoHeight);
  stopCamera();
}

async function loadPhotoFile(file) {
  const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  if (!file || !acceptedTypes.has(file.type)) {
    setStatus("Choose a JPEG, PNG, or WebP image.", "error");
    return;
  }

  stopCamera();
  setStatus("Preparing the photo…", "working");
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await image.decode();
    drawSourceToCanvas(image, image.naturalWidth, image.naturalHeight);
  } catch (error) {
    setStatus(`Could not read the photo: ${error.message}`, "error");
  } finally {
    URL.revokeObjectURL(objectUrl);
    elements.photoInput.value = "";
  }
}

function createTileSelect(selectedCode, tileNumber) {
  const select = document.createElement("select");
  select.setAttribute("aria-label", `Tile ${tileNumber}`);

  for (const groupName of ["Characters", "Bamboo", "Dots", "Honors", "Bonus", "Other"]) {
    const group = document.createElement("optgroup");
    group.label = groupName;
    for (const definition of tileDefinitions.filter((tile) => tile.group === groupName)) {
      const option = document.createElement("option");
      option.value = definition.code;
      option.textContent = definition.label;
      option.selected = definition.code === selectedCode;
      group.appendChild(option);
    }
    select.appendChild(group);
  }
  return select;
}

function renderResults() {
  elements.tileList.replaceChildren();
  elements.resultActions.hidden = !resultsLoaded;
  elements.countBadge.hidden = !resultsLoaded;
  elements.countBadge.textContent = `${recognizedTiles.length} tile${recognizedTiles.length === 1 ? "" : "s"}`;
  elements.resultEmpty.hidden = resultsLoaded && recognizedTiles.length > 0;

  if (resultsLoaded && recognizedTiles.length === 0) {
    elements.resultEmpty.textContent = "No face-up Mahjong tiles were detected. Try a clearer photo, or add tiles manually.";
  }

  recognizedTiles.forEach((tile, index) => {
    const definition = tileByCode.get(tile.code) || tileByCode.get("UNKNOWN");
    const confidencePercent = Math.round(Math.max(0, Math.min(1, tile.confidence)) * 100);

    const row = document.createElement("div");
    row.className = "tile-row";

    const face = document.createElement("div");
    face.className = "tile-face";
    face.setAttribute("aria-hidden", "true");
    face.textContent = definition.symbol;

    const controls = document.createElement("div");
    controls.className = "tile-controls";
    const select = createTileSelect(tile.code, index + 1);
    const confidence = document.createElement("div");
    confidence.className = "confidence";
    confidence.innerHTML = `<span>${confidencePercent}%</span><div class="confidence-track"><div class="confidence-fill${confidencePercent < 80 ? " low" : ""}" style="width:${confidencePercent}%"></div></div>`;
    controls.append(select, confidence);

    const actions = document.createElement("div");
    actions.className = "row-actions";
    const earlier = makeRowButton("←", `Move tile ${index + 1} earlier`, "move-left");
    const later = makeRowButton("→", `Move tile ${index + 1} later`, "move-right");
    const remove = makeRowButton("Remove", `Remove tile ${index + 1}`, "remove");
    earlier.disabled = index === 0;
    later.disabled = index === recognizedTiles.length - 1;
    actions.append(earlier, later, remove);

    select.addEventListener("change", (event) => {
      recognizedTiles[index] = { code: event.target.value, confidence: 1 };
      renderResults();
    });
    earlier.addEventListener("click", () => moveTile(index, index - 1));
    later.addEventListener("click", () => moveTile(index, index + 1));
    remove.addEventListener("click", () => {
      recognizedTiles.splice(index, 1);
      renderResults();
    });

    row.append(face, controls, actions);
    elements.tileList.appendChild(row);
  });
}

function makeRowButton(label, accessibleLabel, extraClass) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `icon-button ${extraClass}`;
  button.textContent = label;
  button.setAttribute("aria-label", accessibleLabel);
  button.title = accessibleLabel;
  return button;
}

function moveTile(fromIndex, toIndex) {
  if (toIndex < 0 || toIndex >= recognizedTiles.length) return;
  const [tile] = recognizedTiles.splice(fromIndex, 1);
  recognizedTiles.splice(toIndex, 0, tile);
  renderResults();
}

function renderWarnings(warnings) {
  elements.warningList.replaceChildren();
  const safeWarnings = Array.isArray(warnings) ? warnings.filter((warning) => typeof warning === "string") : [];
  for (const warning of safeWarnings) {
    const item = document.createElement("li");
    item.textContent = warning;
    elements.warningList.appendChild(item);
  }
  elements.warningList.classList.toggle("active", safeWarnings.length > 0);
}

function setQuality(quality) {
  const allowed = new Set(["good", "usable", "poor"]);
  const normalized = allowed.has(quality) ? quality : "";
  elements.qualityBadge.className = `pill${normalized ? ` active ${normalized}` : ""}`;
  elements.qualityBadge.textContent = normalized ? `${normalized} photo` : "";
}

function normalizeRecognitionResult(value) {
  const rawTiles = Array.isArray(value?.tiles) ? value.tiles : [];
  const tiles = rawTiles.slice(0, 40).map((tile) => ({
    code: tileByCode.has(tile?.code) ? tile.code : "UNKNOWN",
    confidence: Number.isFinite(Number(tile?.confidence))
      ? Math.max(0, Math.min(1, Number(tile.confidence)))
      : 0
  }));
  const photoQuality = ["good", "usable", "poor"].includes(value?.photoQuality)
    ? value.photoQuality
    : "poor";
  const warnings = Array.isArray(value?.warnings)
    ? value.warnings.filter((warning) => typeof warning === "string").slice(0, 12)
    : [];
  return { photoQuality, tiles, warnings };
}

function showRecognitionResult(value, sourceLabel) {
  const result = normalizeRecognitionResult(value);
  recognizedTiles = result.tiles;
  resultsLoaded = true;
  renderResults();
  renderWarnings(result.warnings);
  setQuality(result.photoQuality);
  elements.confirmedOutput.classList.remove("active");
  setStatus(
    recognizedTiles.length
      ? `${sourceLabel} found ${recognizedTiles.length} tile${recognizedTiles.length === 1 ? "" : "s"}. Verify every tile before confirming.`
      : `${sourceLabel} found no tiles. Try a clearer photograph or add tiles manually.`,
    recognizedTiles.length ? "" : "error"
  );
}

function inlineImagePart(dataUrl) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s.exec(dataUrl);
  if (!match) throw new Error("The prepared image is not in a supported format.");
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

function friendlyRecognitionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("app check") || lower.includes("403") || lower.includes("permission")) {
    return "Firebase App Check rejected the request. For localhost, register the debug token printed in the browser console; for production, verify the reCAPTCHA Enterprise site key.";
  }
  if (lower.includes("quota") || lower.includes("429") || lower.includes("resource_exhausted")) {
    return "The Firebase/Gemini quota is currently exhausted. Wait for the quota to reset or review the project quota in Firebase Console.";
  }
  if (lower.includes("failed to fetch") || !navigator.onLine) {
    return "The recognition service could not be reached. Check the internet connection and try again.";
  }
  return `Recognition failed: ${message}`;
}

async function recognizePhoto() {
  if (!imageDataUrl || !recognitionModel || recognizing) return;

  recognizing = true;
  syncRecognizeButton();
  elements.recognizeButton.innerHTML = '<span class="spinner" aria-hidden="true"></span>Recognizing…';
  setStatus("Gemini is reading the visible tile faces. This may take several seconds…", "working");

  try {
    const response = await recognitionModel.generateContent([
      recognitionPrompt,
      inlineImagePart(imageDataUrl)
    ]);
    const parsed = JSON.parse(response.response.text());
    showRecognitionResult(parsed, "Firebase AI");
  } catch (error) {
    console.error("Recognition failed", error);
    setStatus(friendlyRecognitionError(error), "error");
  } finally {
    recognizing = false;
    elements.recognizeButton.textContent = "Recognize tiles";
    syncRecognizeButton();
  }
}

function loadDemoResult() {
  showRecognitionResult({
    photoQuality: "usable",
    tiles: [
      { code: "CHARACTERS_1", confidence: 0.98 },
      { code: "CHARACTERS_2", confidence: 0.97 },
      { code: "CHARACTERS_3", confidence: 0.96 },
      { code: "BAMBOO_4", confidence: 0.95 },
      { code: "BAMBOO_5", confidence: 0.92 },
      { code: "BAMBOO_6", confidence: 0.94 },
      { code: "DOTS_7", confidence: 0.91 },
      { code: "DOTS_8", confidence: 0.89 },
      { code: "DOTS_9", confidence: 0.93 },
      { code: "EAST", confidence: 0.96 },
      { code: "EAST", confidence: 0.95 },
      { code: "EAST", confidence: 0.95 },
      { code: "RED_DRAGON", confidence: 0.87 },
      { code: "RED_DRAGON", confidence: 0.86 }
    ],
    warnings: ["Demo data only — no photo was analyzed."]
  }, "Demo");
}

function addTile() {
  recognizedTiles.push({ code: "UNKNOWN", confidence: 0 });
  resultsLoaded = true;
  renderResults();
  elements.tileList.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function confirmTiles() {
  const tileCodesOutput = recognizedTiles.map((tile) => tile.code);
  const unknownCount = tileCodesOutput.filter((code) => code === "UNKNOWN").length;
  if (unknownCount > 0) {
    setStatus(`Correct the ${unknownCount} unknown tile${unknownCount === 1 ? "" : "s"} before continuing.`, "error");
    return;
  }

  const detail = {
    tileCodes: tileCodesOutput,
    tiles: recognizedTiles.map((tile) => ({ ...tile }))
  };
  elements.confirmedOutput.textContent = JSON.stringify(detail, null, 2);
  elements.confirmedOutput.classList.add("active");
  setStatus("Tile codes confirmed and sent to the integration hook.");

  window.dispatchEvent(new CustomEvent("mahjong-tiles-confirmed", { detail }));
  if (typeof window.onMahjongTilesConfirmed === "function") {
    window.onMahjongTilesConfirmed(tileCodesOutput, detail);
  }
}

// Replace this default function with the call to your existing arrangement,
// winning-pattern, and points logic. It receives an ordered array of codes.
window.onMahjongTilesConfirmed = window.onMahjongTilesConfirmed || function (codes) {
  console.log("Confirmed Mahjong tile codes:", codes);
};

// A small optional API for integration or automated testing.
window.MahjongPhotoReader = {
  getTiles: () => recognizedTiles.map((tile) => ({ ...tile })),
  setTiles: (tiles) => showRecognitionResult({
    photoQuality: "usable",
    tiles,
    warnings: ["Tile data was supplied by the host application."]
  }, "Host application")
};

elements.startCameraButton.addEventListener("click", startCamera);
elements.captureButton.addEventListener("click", capturePhoto);
elements.photoInput.addEventListener("change", (event) => loadPhotoFile(event.target.files?.[0]));
elements.recognizeButton.addEventListener("click", recognizePhoto);
elements.demoButton.addEventListener("click", loadDemoResult);
elements.addTileButton.addEventListener("click", addTile);
elements.confirmButton.addEventListener("click", confirmTiles);
window.addEventListener("pagehide", stopCamera);

initializeFirebase();
