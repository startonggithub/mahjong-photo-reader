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

function createSectionSchema() {
  return Schema.object({
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
}

const recognitionSchema = Schema.object({
  properties: {
    upper: createSectionSchema(),
    lower: createSectionSchema()
  }
});

const recognitionPrompt = `
Act as a careful visual Mahjong tile transcriber. You will receive two cropped
images from one photograph. The first image is the UPPER SET and the second
image is the LOWER SET. Return two independent results named upper and lower.
Never move a tile from one result to the other.

For each image:
- Return only visible, face-up Mahjong tiles.
- Transcribe left-to-right within each row.
- If a crop contains multiple rows, process its upper/far row first.
- Keep duplicates as separate entries.
- Ignore racks, dice, counters, table patterns, labels, and face-down tiles.
- Use UNKNOWN for a visible physical tile whose face cannot be identified.
- Never invent tiles hidden by cropping or overlap.
- Do not determine winning patterns, calculate points, or sort the hand.

Visual conventions:
- CHARACTERS_1..9 are character/wan tiles.
- BAMBOO_1..9 are bamboo/stick/sou tiles; BAMBOO_1 often depicts a bird.
- DOTS_1..9 are circle/dot/pin tiles.
- EAST, SOUTH, WEST, NORTH are winds.
- RED_DRAGON, GREEN_DRAGON, WHITE_DRAGON are dragons.
- FLOWER_* and SEASON_* are bonus tiles.

For each classification, give a visual confidence between 0 and 1. Mention
blur, glare, cropping, overlap, steep perspective, and ambiguous regional
artwork in the warnings for the affected section. Allowed codes:
${tileCodes.join(", ")}.
`;

const elements = {
  connectionBadge: document.getElementById("connectionBadge"),
  setupNotice: document.getElementById("setupNotice"),
  cameraFrame: document.getElementById("cameraFrame"),
  camera: document.getElementById("camera"),
  photoPreview: document.getElementById("photoPreview"),
  canvas: document.getElementById("captureCanvas"),
  upperCanvas: document.getElementById("upperCanvas"),
  lowerCanvas: document.getElementById("lowerCanvas"),
  startCameraButton: document.getElementById("startCameraButton"),
  captureButton: document.getElementById("captureButton"),
  photoInput: document.getElementById("photoInput"),
  recognizeButton: document.getElementById("recognizeButton"),
  demoButton: document.getElementById("demoButton"),
  status: document.getElementById("status"),
  resultActions: document.getElementById("resultActions"),
  confirmButton: document.getElementById("confirmButton"),
  confirmedOutput: document.getElementById("confirmedOutput")
};

const sectionStates = {
  upper: {
    key: "upper",
    label: "Upper set",
    tiles: [],
    warnings: [],
    photoQuality: "",
    loaded: false,
    elements: {
      qualityBadge: document.getElementById("upperQualityBadge"),
      countBadge: document.getElementById("upperCountBadge"),
      resultEmpty: document.getElementById("upperResultEmpty"),
      tileList: document.getElementById("upperTileList"),
      warningList: document.getElementById("upperWarningList"),
      sectionActions: document.getElementById("upperSectionActions"),
      addTileButton: document.getElementById("upperAddTileButton")
    }
  },
  lower: {
    key: "lower",
    label: "Lower set",
    tiles: [],
    warnings: [],
    photoQuality: "",
    loaded: false,
    elements: {
      qualityBadge: document.getElementById("lowerQualityBadge"),
      countBadge: document.getElementById("lowerCountBadge"),
      resultEmpty: document.getElementById("lowerResultEmpty"),
      tileList: document.getElementById("lowerTileList"),
      warningList: document.getElementById("lowerWarningList"),
      sectionActions: document.getElementById("lowerSectionActions"),
      addTileButton: document.getElementById("lowerAddTileButton")
    }
  }
};

const sectionKeys = Object.keys(sectionStates);
const sectionImageDataUrls = { upper: null, lower: null };
let cameraStream = null;
let fullImageDataUrl = null;
let recognitionModel = null;
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
  const bothSectionsReady = sectionKeys.every((key) => Boolean(sectionImageDataUrls[key]));
  elements.recognizeButton.disabled = !bothSectionsReady || !recognitionModel || recognizing;
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
        maxOutputTokens: 4096
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

function clearPreparedPhoto() {
  fullImageDataUrl = null;
  sectionImageDataUrls.upper = null;
  sectionImageDataUrls.lower = null;
  syncRecognizeButton();
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
    clearPreparedPhoto();
    clearRecognitionResults();
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
    setStatus("Camera ready. Put one tile set above the line and the other below it, then take the photo.");
  } catch (error) {
    stopCamera();
    setStatus(`Could not start the camera: ${error.message}. Try “Choose photo.”`, "error");
  }
}

function clearRecognitionResults() {
  for (const key of sectionKeys) {
    const section = sectionStates[key];
    section.tiles = [];
    section.warnings = [];
    section.photoQuality = "";
    section.loaded = false;
    renderSection(key);
  }
  elements.resultActions.hidden = true;
  elements.confirmedOutput.classList.remove("active");
}

function cropCanvas(sourceCanvas, targetCanvas, sourceY, cropHeight) {
  const width = sourceCanvas.width;
  targetCanvas.width = width;
  targetCanvas.height = cropHeight;
  const context = targetCanvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, cropHeight);
  context.drawImage(
    sourceCanvas,
    0,
    sourceY,
    width,
    cropHeight,
    0,
    0,
    width,
    cropHeight
  );
  return targetCanvas.toDataURL("image/jpeg", 0.9);
}

function drawSourceToCanvas(source, sourceWidth, sourceHeight) {
  const maximumDimension = 2048;
  const scale = Math.min(1, maximumDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(2, Math.round(sourceHeight * scale));

  elements.canvas.width = width;
  elements.canvas.height = height;
  const context = elements.canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);

  const upperHeight = Math.floor(height / 2);
  const lowerHeight = height - upperHeight;
  fullImageDataUrl = elements.canvas.toDataURL("image/jpeg", 0.9);
  sectionImageDataUrls.upper = cropCanvas(elements.canvas, elements.upperCanvas, 0, upperHeight);
  sectionImageDataUrls.lower = cropCanvas(elements.canvas, elements.lowerCanvas, upperHeight, lowerHeight);

  elements.photoPreview.src = fullImageDataUrl;
  elements.photoPreview.classList.add("active");
  elements.camera.classList.remove("active");
  elements.cameraFrame.classList.remove("live");
  elements.cameraFrame.classList.add("has-photo");
  clearRecognitionResults();
  syncRecognizeButton();

  if (recognitionModel) {
    setStatus(`Photo split into upper and lower sections (${width} × ${height}). Press “Recognize both sets.”`);
  } else {
    setStatus(`Photo split into upper and lower sections (${width} × ${height}). Configure Firebase to enable recognition.`, "working");
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
  setStatus("Preparing and splitting the photo…", "working");
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

function createTileSelect(selectedCode, sectionLabel, tileNumber) {
  const select = document.createElement("select");
  select.setAttribute("aria-label", `${sectionLabel}, tile ${tileNumber}`);

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

function renderSection(sectionKey) {
  const section = sectionStates[sectionKey];
  const sectionElements = section.elements;
  sectionElements.tileList.replaceChildren();
  sectionElements.sectionActions.hidden = !section.loaded;
  sectionElements.countBadge.hidden = !section.loaded;
  sectionElements.countBadge.textContent = `${section.tiles.length} tile${section.tiles.length === 1 ? "" : "s"}`;
  sectionElements.resultEmpty.hidden = section.loaded && section.tiles.length > 0;

  if (section.loaded && section.tiles.length === 0) {
    sectionElements.resultEmpty.textContent = `No face-up Mahjong tiles were detected in the ${sectionKey} section. Add tiles manually or take a clearer photo.`;
  } else if (!section.loaded) {
    sectionElements.resultEmpty.textContent = `The ${sectionKey} result list will appear here.`;
  }

  section.tiles.forEach((tile, index) => {
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
    const select = createTileSelect(tile.code, section.label, index + 1);
    const confidence = document.createElement("div");
    confidence.className = "confidence";
    confidence.innerHTML = `<span>${confidencePercent}%</span><div class="confidence-track"><div class="confidence-fill${confidencePercent < 80 ? " low" : ""}" style="width:${confidencePercent}%"></div></div>`;
    controls.append(select, confidence);

    const actions = document.createElement("div");
    actions.className = "row-actions";
    const earlier = makeRowButton("←", `Move ${section.label} tile ${index + 1} earlier`, "move-left");
    const later = makeRowButton("→", `Move ${section.label} tile ${index + 1} later`, "move-right");
    const remove = makeRowButton("Remove", `Remove ${section.label} tile ${index + 1}`, "remove");
    earlier.disabled = index === 0;
    later.disabled = index === section.tiles.length - 1;
    actions.append(earlier, later, remove);

    select.addEventListener("change", (event) => {
      section.tiles[index] = { code: event.target.value, confidence: 1 };
      renderSection(sectionKey);
    });
    earlier.addEventListener("click", () => moveTile(sectionKey, index, index - 1));
    later.addEventListener("click", () => moveTile(sectionKey, index, index + 1));
    remove.addEventListener("click", () => {
      section.tiles.splice(index, 1);
      renderSection(sectionKey);
    });

    row.append(face, controls, actions);
    sectionElements.tileList.appendChild(row);
  });

  renderWarnings(sectionKey, section.warnings);
  setQuality(sectionKey, section.photoQuality);
  elements.resultActions.hidden = !sectionKeys.every((key) => sectionStates[key].loaded);
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

function moveTile(sectionKey, fromIndex, toIndex) {
  const section = sectionStates[sectionKey];
  if (toIndex < 0 || toIndex >= section.tiles.length) return;
  const [tile] = section.tiles.splice(fromIndex, 1);
  section.tiles.splice(toIndex, 0, tile);
  renderSection(sectionKey);
}

function renderWarnings(sectionKey, warnings) {
  const warningList = sectionStates[sectionKey].elements.warningList;
  warningList.replaceChildren();
  const safeWarnings = Array.isArray(warnings)
    ? warnings.filter((warning) => typeof warning === "string")
    : [];
  for (const warning of safeWarnings) {
    const item = document.createElement("li");
    item.textContent = warning;
    warningList.appendChild(item);
  }
  warningList.classList.toggle("active", safeWarnings.length > 0);
}

function setQuality(sectionKey, quality) {
  const qualityBadge = sectionStates[sectionKey].elements.qualityBadge;
  const allowed = new Set(["good", "usable", "poor"]);
  const normalized = allowed.has(quality) ? quality : "";
  qualityBadge.className = `pill${normalized ? ` active ${normalized}` : ""}`;
  qualityBadge.textContent = normalized ? `${normalized} photo` : "";
}

function normalizeSectionResult(value) {
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

function showRecognitionResults(value, sourceLabel) {
  for (const key of sectionKeys) {
    const normalized = normalizeSectionResult(value?.[key]);
    const section = sectionStates[key];
    section.tiles = normalized.tiles;
    section.warnings = normalized.warnings;
    section.photoQuality = normalized.photoQuality;
    section.loaded = true;
    renderSection(key);
  }

  elements.confirmedOutput.classList.remove("active");
  const upperCount = sectionStates.upper.tiles.length;
  const lowerCount = sectionStates.lower.tiles.length;
  const totalCount = upperCount + lowerCount;
  setStatus(
    totalCount
      ? `${sourceLabel} found ${upperCount} upper tile${upperCount === 1 ? "" : "s"} and ${lowerCount} lower tile${lowerCount === 1 ? "" : "s"}. Verify both lists before confirming.`
      : `${sourceLabel} found no tiles in either section. Try a clearer photograph or add tiles manually.`,
    totalCount ? "" : "error"
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
  const bothSectionsReady = sectionKeys.every((key) => Boolean(sectionImageDataUrls[key]));
  if (!bothSectionsReady || !recognitionModel || recognizing) return;

  recognizing = true;
  syncRecognizeButton();
  elements.recognizeButton.innerHTML = '<span class="spinner" aria-hidden="true"></span>Recognizing both…';
  setStatus("Gemini is reading the upper and lower tile sets. This may take several seconds…", "working");

  try {
    const response = await recognitionModel.generateContent([
      recognitionPrompt,
      "IMAGE 1 — UPPER SET. Return its tiles only in the upper result:",
      inlineImagePart(sectionImageDataUrls.upper),
      "IMAGE 2 — LOWER SET. Return its tiles only in the lower result:",
      inlineImagePart(sectionImageDataUrls.lower)
    ]);
    const parsed = JSON.parse(response.response.text());
    showRecognitionResults(parsed, "Firebase AI");
  } catch (error) {
    console.error("Recognition failed", error);
    setStatus(friendlyRecognitionError(error), "error");
  } finally {
    recognizing = false;
    elements.recognizeButton.textContent = "Recognize both sets";
    syncRecognizeButton();
  }
}

function loadDemoResult() {
  showRecognitionResults({
    upper: {
      photoQuality: "good",
      tiles: [
        { code: "CHARACTERS_1", confidence: 0.98 },
        { code: "CHARACTERS_2", confidence: 0.97 },
        { code: "CHARACTERS_3", confidence: 0.96 },
        { code: "BAMBOO_4", confidence: 0.95 },
        { code: "BAMBOO_5", confidence: 0.92 },
        { code: "BAMBOO_6", confidence: 0.94 },
        { code: "EAST", confidence: 0.96 }
      ],
      warnings: ["Demo upper-set data — no photo was analyzed."]
    },
    lower: {
      photoQuality: "usable",
      tiles: [
        { code: "DOTS_1", confidence: 0.97 },
        { code: "DOTS_2", confidence: 0.95 },
        { code: "DOTS_3", confidence: 0.94 },
        { code: "RED_DRAGON", confidence: 0.91 },
        { code: "RED_DRAGON", confidence: 0.9 },
        { code: "RED_DRAGON", confidence: 0.89 },
        { code: "WHITE_DRAGON", confidence: 0.85 }
      ],
      warnings: ["Demo lower-set data — no photo was analyzed."]
    }
  }, "Demo");
}

function addTile(sectionKey) {
  const section = sectionStates[sectionKey];
  section.tiles.push({ code: "UNKNOWN", confidence: 0 });
  section.loaded = true;
  renderSection(sectionKey);
  section.elements.tileList.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function sectionDetail(sectionKey) {
  const tiles = sectionStates[sectionKey].tiles.map((tile) => ({ ...tile }));
  return {
    tileCodes: tiles.map((tile) => tile.code),
    tiles
  };
}

function confirmTileSets() {
  const upper = sectionDetail("upper");
  const lower = sectionDetail("lower");
  const upperUnknownCount = upper.tileCodes.filter((code) => code === "UNKNOWN").length;
  const lowerUnknownCount = lower.tileCodes.filter((code) => code === "UNKNOWN").length;
  const unknownCount = upperUnknownCount + lowerUnknownCount;

  if (unknownCount > 0) {
    const locations = [];
    if (upperUnknownCount) locations.push(`${upperUnknownCount} upper`);
    if (lowerUnknownCount) locations.push(`${lowerUnknownCount} lower`);
    setStatus(`Correct the unknown tiles (${locations.join(", ")}) before continuing.`, "error");
    return;
  }

  const detail = {
    upperTileCodes: upper.tileCodes,
    lowerTileCodes: lower.tileCodes,
    upper,
    lower
  };
  elements.confirmedOutput.textContent = JSON.stringify(detail, null, 2);
  elements.confirmedOutput.classList.add("active");
  setStatus("Both result lists were confirmed and sent to the integration hooks.");

  window.dispatchEvent(new CustomEvent("mahjong-tile-sets-confirmed", { detail }));
  if (typeof window.onMahjongTileSetsConfirmed === "function") {
    window.onMahjongTileSetsConfirmed(upper.tileCodes, lower.tileCodes, detail);
  }

  // Backward compatibility: existing single-list integrations receive one
  // call for each section, identified by detail.section.
  if (typeof window.onMahjongTilesConfirmed === "function") {
    for (const sectionKey of sectionKeys) {
      const oneSectionDetail = {
        section: sectionKey,
        ...detail[sectionKey]
      };
      window.dispatchEvent(new CustomEvent("mahjong-tiles-confirmed", { detail: oneSectionDetail }));
      window.onMahjongTilesConfirmed(oneSectionDetail.tileCodes, oneSectionDetail);
    }
  }
}

// Preferred two-list integration hook. Replace this with the call to your
// existing arrangement, winning-pattern, and points logic.
window.onMahjongTileSetsConfirmed = window.onMahjongTileSetsConfirmed || function (upperCodes, lowerCodes) {
  console.log("Confirmed upper Mahjong tile codes:", upperCodes);
  console.log("Confirmed lower Mahjong tile codes:", lowerCodes);
};

// Optional backward-compatible hook. When supplied, it is called twice: once
// with detail.section === "upper" and once with detail.section === "lower".

// A small optional API for integration or automated testing.
window.MahjongPhotoReader = {
  getTileSets: () => ({
    upper: sectionDetail("upper"),
    lower: sectionDetail("lower")
  }),
  getTiles: (sectionKey = "upper") => sectionDetail(sectionKey).tiles,
  setTileSets: (value) => showRecognitionResults({
    upper: {
      photoQuality: "usable",
      tiles: value?.upper || [],
      warnings: ["Upper tile data was supplied by the host application."]
    },
    lower: {
      photoQuality: "usable",
      tiles: value?.lower || [],
      warnings: ["Lower tile data was supplied by the host application."]
    }
  }, "Host application")
};

elements.startCameraButton.addEventListener("click", startCamera);
elements.captureButton.addEventListener("click", capturePhoto);
elements.photoInput.addEventListener("change", (event) => loadPhotoFile(event.target.files?.[0]));
elements.recognizeButton.addEventListener("click", recognizePhoto);
elements.demoButton.addEventListener("click", loadDemoResult);
sectionStates.upper.elements.addTileButton.addEventListener("click", () => addTile("upper"));
sectionStates.lower.elements.addTileButton.addEventListener("click", () => addTile("lower"));
elements.confirmButton.addEventListener("click", confirmTileSets);
window.addEventListener("pagehide", stopCamera);

clearRecognitionResults();
initializeFirebase();
