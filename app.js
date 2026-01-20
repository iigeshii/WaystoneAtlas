console.log("Waystone Atlas loaded");

// -----------------------------
// MAP CONFIG
// -----------------------------
//
// Overworld bounds are your Mapee visible area.
// Nether bounds are placeholders—update once you export the nether map and get its "Visible areas".
//
const MAPS = {
  Overworld: {
    image: "world.jpg",
    bounds: { minX: -5159, maxX: 5157, minZ: -2611, maxZ: 2609 }
  },
  Nether: {
    image: "nether.jpg",
    // PLACEHOLDER DEFAULTS — update these to match your exported nether image visible area.
    bounds: { minX: -2289, maxX: 2287, minZ: -1159, maxZ: 1157 }
  }
};

// Category ordering + labels
const CATEGORY_ORDER = ["Base", "Community Feature", "Farm", "Other", "Portal", "Shop"];
const CATEGORY_LABELS = {
  "Base": "🏠 BASES",
  "Community Feature": "🐴 COMMUNITY FEATURES",
  "Farm": "🌾 FARMS",
  "Other": "🪦 OTHER",
  "Portal": "🔥 PORTALS",
  "Shop": "🛒 SHOPS",
};

// Path labels (optional)
const PATHS_HEADER = "🧭 PATHS";

// -----------------------------
// LEAFLET SETUP
// -----------------------------
const map = L.map("map", {
  crs: L.CRS.Simple,
  minZoom: -4,
  zoom: -2,
});

// Leaflet expects [y, x]. Use [-Z, X] so north/south matches Minecraft intuition.
function mcToLatLng(x, z) {
  return [-z, x];
}

// Layers (easy to clear & redraw)
let imageOverlay = null;
const poiLayer = L.layerGroup().addTo(map);
const pathLayer = L.layerGroup().addTo(map);

// Marker index (FIX): directory clicks look up markers here (no stale references)
const poiMarkers = new Map(); // key: "x,z" -> Leaflet marker

// Data
let allPois = [];
let allPaths = [];

// UI
const mapSelect = document.getElementById("map-select");
const searchInput = document.getElementById("search");
const listEl = document.getElementById("poi-list");

let currentDimension = mapSelect.value || "Overworld";
let currentSearch = "";

// -----------------------------
// LOAD DATA
// -----------------------------
Promise.all([
  fetch("pois.json").then(r => r.ok ? r.json() : Promise.reject(new Error("pois.json not found"))),
  fetch("paths.json").then(r => r.ok ? r.json() : Promise.reject(new Error("paths.json not found")))
]).then(([pois, paths]) => {
  allPois = Array.isArray(pois) ? pois : [];
  allPaths = Array.isArray(paths) ? paths : [];

  wireUI();
  renderAll();
}).catch(err => {
  console.error(err);
  alert("Failed to load pois.json or paths.json. Make sure you are running via a web server (python -m http.server).");
});

// -----------------------------
// UI
// -----------------------------
function wireUI() {
  mapSelect.value = currentDimension;

  mapSelect.addEventListener("change", () => {
    currentDimension = mapSelect.value;
    renderAll();
  });

  searchInput.addEventListener("input", () => {
    currentSearch = searchInput.value.trim().toLowerCase();
    renderDirectory(); // directory-only refresh on search
  });
}

// -----------------------------
// RENDER PIPELINE
// -----------------------------
function renderAll() {
  renderBaseMap();
  renderPaths();
  renderPOIs();
  renderDirectory();
}

function renderBaseMap() {
  const cfg = MAPS[currentDimension];
  if (!cfg) return;

  if (imageOverlay) {
    map.removeLayer(imageOverlay);
    imageOverlay = null;
  }

  const b = cfg.bounds;
  const bounds = L.latLngBounds(
    mcToLatLng(b.minX, b.minZ),
    mcToLatLng(b.maxX, b.maxZ)
  );

  imageOverlay = L.imageOverlay(cfg.image, bounds).addTo(map);

  // Optional: pixel-ish scaling (try it; some prefer default smoothing)
  // map.getPane("overlayPane").style.imageRendering = "pixelated";

  map.fitBounds(bounds);
  map.setMaxBounds(bounds);
}

function renderPOIs() {
  poiLayer.clearLayers();
  poiMarkers.clear();

  const pois = visiblePois();
  pois.forEach(p => {
    const pos = mcToLatLng(p.x, p.z);

    const marker = L.circleMarker(pos, {
      radius: 6,
      color: "#7b1e2b",
      fillColor: "#c03a4a",
      fillOpacity: 0.9,
      weight: 1,
    }).addTo(poiLayer);

    marker.bindPopup(buildPoiPopupHtml(p));

    // Keyed by x,z (y doesn't matter for map placement)
    const key = `${p.x},${p.z}`;
    poiMarkers.set(key, marker);
  });
}

function renderPaths() {
  pathLayer.clearLayers();

  const paths = visiblePaths();
  paths.forEach(p => {
    const from = p.from || {};
    const to = p.to || {};

    if (!isNum(from.x) || !isNum(from.z) || !isNum(to.x) || !isNum(to.z)) return;

    const line = L.polyline(
      [mcToLatLng(from.x, from.z), mcToLatLng(to.x, to.z)],
      pathStyle(p)
    ).addTo(pathLayer);

    line.bindPopup(buildPathPopupHtml(p));

    // store refs for directory clicks
    p.__line = line;
    p.__mid = mcToLatLng((from.x + to.x) / 2, (from.z + to.z) / 2);
  });
}

function renderDirectory() {
  listEl.innerHTML = "";

  // ---------- POIs grouped ----------
  const groups = {};
  visiblePois().forEach(p => {
    const cat = normalizeCategory(p.category);
    groups[cat] ??= [];
    groups[cat].push(p);
  });

  Object.values(groups).forEach(arr => {
    arr.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
  });

  const orderedCats = [
    ...CATEGORY_ORDER,
    ...Object.keys(groups).filter(c => !CATEGORY_ORDER.includes(c)).sort(),
  ];

  orderedCats.forEach(cat => {
    const items = groups[cat];
    if (!items || items.length === 0) return;

    const header = document.createElement("li");
    header.className = "dir-header";
    header.textContent = CATEGORY_LABELS[cat] ?? cat.toUpperCase();
    listEl.appendChild(header);

    items.forEach(p => {
      if (!passesSearch(p)) return;

      const li = document.createElement("li");
      li.className = "dir-item";
      li.innerHTML = `
        ${escapeHtml("– " + (p.name ?? "(Unnamed)"))}
        <span class="sub">${escapeHtml(`${p.x}, ${p.y}, ${p.z}`)}${p.owner ? ` • ${escapeHtml(p.owner)}` : ""}</span>
      `;

      // FIX: look up marker at click time (no stale references)
      li.addEventListener("click", () => {
        const key = `${p.x},${p.z}`;
        const marker = poiMarkers.get(key);
        if (!marker) return;

        map.setView(marker.getLatLng(), Math.max(map.getZoom(), -1));
        marker.openPopup();
      });

      listEl.appendChild(li);
    });
  });

  // ---------- PATHS section ----------
  // const paths = visiblePaths()
  //   .slice()
  //   .sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));

  // const anyVisiblePaths = paths.some(p => passesSearch(p));
  // if (anyVisiblePaths) {
  //   const header = document.createElement("li");
  //   header.className = "dir-header";
  //   header.textContent = PATHS_HEADER;
  //   listEl.appendChild(header);

  //   paths.forEach(p => {
  //     if (!passesSearch(p)) return;

  //     const kindLabel = friendlyPathKind(p.kind);
  //     const li = document.createElement("li");
  //     li.className = "dir-item";
  //     li.innerHTML = `
  //       ${escapeHtml("– " + (p.name ?? "Path"))}
  //       <span class="sub">${escapeHtml(kindLabel)}</span>
  //     `;

  //     li.addEventListener("click", () => {
  //       if (p.__mid) map.setView(p.__mid, Math.max(map.getZoom(), -1));
  //       if (p.__line) p.__line.openPopup();
  //     });

  //     listEl.appendChild(li);
  //   });
  // }
}

// -----------------------------
// FILTERING
// -----------------------------
function visiblePois() {
  return allPois
    .map(p => ({
      ...p,
      dimension: normalizeDimension(p.dimension),
      category: normalizeCategory(p.category),
    }))
    .filter(p => p.dimension === currentDimension);
}

function visiblePaths() {
  return allPaths
    .map(p => ({
      ...p,
      dimension: normalizeDimension(p.dimension),
      kind: normalizePathKind(p.kind),
    }))
    .filter(p => p.dimension === currentDimension);
}

function passesSearch(obj) {
  if (!currentSearch) return true;
  const hay = `${obj.name ?? ""} ${obj.owner ?? ""} ${obj.notes ?? ""} ${obj.kind ?? ""} ${obj.type ?? ""}`.toLowerCase();
  return hay.includes(currentSearch);
}

function normalizeDimension(d) {
  const v = String(d ?? "").trim().toLowerCase();
  if (!v) return "Overworld";
  if (v.startsWith("nether")) return "Nether";
  if (v.startsWith("over")) return "Overworld";
  return d;
}

function normalizeCategory(category) {
  const c = String(category ?? "").trim();
  if (!c) return "Other";

  const lowered = c.toLowerCase();
  if (lowered === "bases" || lowered === "base") return "Base";
  if (lowered.includes("community")) return "Community Feature";
  if (lowered === "farm" || lowered === "farms") return "Farm";
  if (lowered === "portal" || lowered === "portals") return "Portal";
  if (lowered === "shop" || lowered === "shops") return "Shop";
  if (lowered === "other") return "Other";

  return c;
}

function normalizePathKind(kind) {
  const k = String(kind ?? "").trim().toLowerCase();
  if (!k) return "nether_path";
  if (k === "ice" || k === "icerail" || k === "ice_rail" || k === "ice-rail") return "ice_rail";
  if (k === "nether" || k === "path" || k === "nether_path" || k === "nether-path") return "nether_path";
  return k;
}

function friendlyPathKind(kind) {
  const k = normalizePathKind(kind);
  if (k === "ice_rail") return "Ice Railway";
  if (k === "nether_path") return "Nether Pathway";
  return k;
}

// -----------------------------
// STYLES & POPUPS
// -----------------------------
function pathStyle(p) {
  const kind = normalizePathKind(p.kind);

  // Blue for ice railway
  if (kind === "ice_rail") {
    return { color: "#2b6cff", weight: 3, opacity: 0.95 };
  }

  // Dark red for nether pathway
  return { color: "#bb2935", weight: 3, opacity: 0.95 };
}

function buildPoiPopupHtml(p) {
  const owner = p.owner ? `<div><strong>Owner:</strong> ${escapeHtml(p.owner)}</div>` : "";
  const notes = p.notes ? `<div style="margin-top:6px">${escapeHtml(p.notes)}</div>` : "";

  return `
    <strong>${escapeHtml(p.name ?? "(Unnamed)")}</strong><br/>
    <em>${escapeHtml(p.category ?? "")}</em><br/>
    <div>XYZ: ${p.x}, ${p.y}, ${p.z}</div>
    <div><strong>Dimension:</strong> ${escapeHtml(p.dimension)}</div>
    ${owner}
    ${notes}
  `;
}

function buildPathPopupHtml(p) {
  const from = p.from || {};
  const to = p.to || {};
  const kindLabel = friendlyPathKind(p.kind);

  const notes = p.notes ? `<div style="margin-top:6px">${escapeHtml(p.notes)}</div>` : "";

  return `
    <strong>${escapeHtml(p.name ?? "Path")}</strong><br/>
    <em>${escapeHtml(kindLabel)}</em><br/>
    <div>From: ${from.x}, ${from.z} → To: ${to.x}, ${to.z}</div>
    ${notes}
  `;
}

// -----------------------------
// HELPERS
// -----------------------------
function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}
