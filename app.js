console.log("Waystone Atlas loaded");

// -----------------------------
// MAP CONFIG
// -----------------------------
const MAPS = {
  Overworld: {
    image: "world.jpg",
    //bounds: { minX: -5159, maxX: 5157, minZ: -2611, maxZ: 2609 }
    bounds: { minX: -6069, maxX: 6067, minZ: -3072, maxZ: 3070 }
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

// -----------------------------
// LEAFLET SETUP
// -----------------------------
const map = L.map("map", {
  crs: L.CRS.Simple,
  minZoom: -4,
  zoom: -2,
});

// Convert Minecraft coords -> Leaflet coords
function mcToLatLng(x, z) {
  return [-z, x];
}

// Layers
let imageOverlay = null;
const poiLayer = L.layerGroup().addTo(map);
const pathLayer = L.layerGroup().addTo(map);

// Marker index (prevents stale references)
const poiMarkers = new Map(); // key: "x,z" -> Leaflet layer (marker or circleMarker)

// Data
let allPois = [];
let allPaths = [];

// UI
const mapSelect = document.getElementById("map-select");
const searchInput = document.getElementById("search");
const listEl = document.getElementById("poi-list");

let currentDimension = mapSelect.value || "Overworld";
let currentSearch = "";

// Portal icon (pixel-sized; auto-resizes with zoom like circles)
const portalIcon = L.divIcon({
  className: "portal-icon-wrapper",
  iconSize: [12, 22],   // width, height in pixels
  iconAnchor: [6, 11],  // center of the icon
  popupAnchor: [0, -12],
  html: `<div class="portal-icon"></div>`
});

// -----------------------------
// LOAD DATA
// -----------------------------
Promise.all([
  fetch("pois.json").then(r => r.json()),
  fetch("paths.json").then(r => r.json())
]).then(([pois, paths]) => {
  allPois = Array.isArray(pois) ? pois : [];
  allPaths = Array.isArray(paths) ? paths : [];

  wireUI();
  renderAll();
}).catch(err => {
  console.error(err);
  alert("Failed to load pois.json or paths.json");
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
    renderDirectory();
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

  if (imageOverlay) map.removeLayer(imageOverlay);

  const b = cfg.bounds;
  const bounds = L.latLngBounds(
    mcToLatLng(b.minX, b.minZ),
    mcToLatLng(b.maxX, b.maxZ)
  );

  imageOverlay = L.imageOverlay(cfg.image, bounds).addTo(map);
  map.fitBounds(bounds);
  map.setMaxBounds(bounds);
}

function renderPOIs() {
  poiLayer.clearLayers();
  poiMarkers.clear();

  visiblePois().forEach(p => {
    const pos = mcToLatLng(p.x, p.z);
    const category = normalizeCategory(p.category);

    let layer;

    if (category === "Portal") {
      // Portals: purple rectangle icon (pixel-based, scales like circle markers)
      layer = L.marker(pos, { icon: portalIcon }).addTo(poiLayer);
    } else {
      // Default circle for everything else
      layer = L.circleMarker(pos, {
        radius: 6,
        color: "#7b1e2b",
        fillColor: "#c03a4a",
        fillOpacity: 0.9,
        weight: 1,
      }).addTo(poiLayer);
    }

    layer.bindPopup(buildPoiPopup(p));
    poiMarkers.set(`${p.x},${p.z}`, layer);
  });
}

function renderPaths() {
  pathLayer.clearLayers();

  visiblePaths().forEach(p => {
    const { from, to } = p;
    if (!isNum(from?.x) || !isNum(from?.z) || !isNum(to?.x) || !isNum(to?.z)) return;

    // glow
    L.polyline(
      [mcToLatLng(from.x, from.z), mcToLatLng(to.x, to.z)],
      { ...pathStyle(p), weight: 8, opacity: 0.25 }
    ).addTo(pathLayer);

    // main line
    L.polyline(
      [mcToLatLng(from.x, from.z), mcToLatLng(to.x, to.z)],
      pathStyle(p)
    ).addTo(pathLayer);
  });
}

// -----------------------------
// DIRECTORY (POIs ONLY - NO PATHS)
// -----------------------------
function renderDirectory() {
  listEl.innerHTML = "";

  const groups = {};
  visiblePois().forEach(p => {
    const cat = normalizeCategory(p.category);
    groups[cat] ??= [];
    groups[cat].push(p);
  });

  Object.values(groups).forEach(arr =>
    arr.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  );

  const orderedCats = [
    ...CATEGORY_ORDER,
    ...Object.keys(groups).filter(c => !CATEGORY_ORDER.includes(c)).sort()
  ];

  orderedCats.forEach(cat => {
    const items = groups[cat];
    if (!items?.length) return;

    const header = document.createElement("li");
    header.className = "dir-header";
    header.textContent = CATEGORY_LABELS[cat] ?? cat.toUpperCase();
    listEl.appendChild(header);

    items.forEach(p => {
      if (!passesSearch(p)) return;

      const li = document.createElement("li");
      li.className = "dir-item";
      li.innerHTML = `
        ${escapeHtml("- " + (p.name ?? "(Unnamed)"))}
        <span class="sub">${escapeHtml(`${p.x}, ${p.y}, ${p.z}`)}${p.owner ? ` | ${escapeHtml(p.owner)}` : ""}</span>
      `;

      li.addEventListener("click", () => {
        const layer = poiMarkers.get(`${p.x},${p.z}`);
        if (!layer) return;

        // Works for markers (portals) and circleMarkers (everything else)
        const center = (typeof layer.getLatLng === "function")
          ? layer.getLatLng()
          : null;

        if (!center) return;

        map.setView(center, Math.max(map.getZoom(), -1));
        layer.openPopup();
      });

      listEl.appendChild(li);
    });
  });
}

// -----------------------------
// FILTERING / NORMALIZATION
// -----------------------------
function visiblePois() {
  return allPois
    .map(p => ({ ...p, dimension: normalizeDimension(p.dimension) }))
    .filter(p => p.dimension === currentDimension);
}

function visiblePaths() {
  return allPaths
    .map(p => ({ ...p, dimension: normalizeDimension(p.dimension), kind: normalizePathKind(p.kind) }))
    .filter(p => p.dimension === currentDimension);
}

function passesSearch(p) {
  if (!currentSearch) return true;
  return `${p.name ?? ""} ${p.owner ?? ""} ${p.notes ?? ""}`.toLowerCase().includes(currentSearch);
}

function normalizeDimension(d) {
  const v = String(d ?? "").toLowerCase();
  if (v.startsWith("nether")) return "Nether";
  return "Overworld";
}

function normalizeCategory(c) {
  const v = String(c ?? "").toLowerCase();
  if (v.includes("base")) return "Base";
  if (v.includes("farm")) return "Farm";
  if (v.includes("portal")) return "Portal";
  if (v.includes("shop")) return "Shop";
  if (v.includes("community")) return "Community Feature";
  return "Other";
}

function normalizePathKind(k) {
  const v = String(k ?? "").toLowerCase();
  if (v.includes("ice")) return "ice_rail";
  return "nether_path";
}

// -----------------------------
// STYLES / POPUPS
// -----------------------------
function pathStyle(p) {
  if (p.kind === "ice_rail") {
    return { color: "#3d7cff", weight: 4, opacity: 1.0 };
  }
  return { color: "#a31621", weight: 4, opacity: 1.0 };
}

function buildPoiPopup(p) {
  return `
    <strong>${escapeHtml(p.name)}</strong><br/>
    <em>${escapeHtml(p.category)}</em><br/>
    XYZ: ${p.x}, ${p.y}, ${p.z}<br/>
    ${p.owner ? `<strong>Owner:</strong> ${escapeHtml(p.owner)}<br/>` : ""}
    ${p.notes ? escapeHtml(p.notes) : ""}
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
