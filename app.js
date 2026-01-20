console.log("Waystone Atlas v2 loaded");

// -----------------------------
// CONFIG
// -----------------------------

// IMPORTANT: Replace Nether bounds with your Mapee "Visible areas" once you export the nether image.
// Overworld bounds are from your message.
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

// Category order + headers (matches your TOC style)
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

// Leaflet expects [y, x]. We use [(-Z), X] so north/south matches Minecraft intuition.
function mcToLatLng(x, z) {
  return [-z, x];
}

// Layers we can clear/rebuild per map
let imageOverlay = null;
const poiLayer = L.layerGroup().addTo(map);
const pathLayer = L.layerGroup().addTo(map);

// Cached data
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
  fetch("paths.json").then(r => r.ok ? r.json() : Promise.reject(new Error("paths.json not found"))),
]).then(([pois, paths]) => {
  allPois = Array.isArray(pois) ? pois : [];
  allPaths = Array.isArray(paths) ? paths : [];

  wireUI();
  renderAll();
}).catch(err => {
  console.error(err);
  alert("Failed to load pois.json or paths.json. Make sure they are in the repo root and you are using a web server.");
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
    renderAllDirectoryOnly();
  });
}

// -----------------------------
// RENDER
// -----------------------------

function renderAll() {
  renderBaseMap();
  renderPOIs();
  renderPaths();
  renderDirectory();
}

function renderBaseMap() {
  const cfg = MAPS[currentDimension];
  if (!cfg) return;

  // remove old overlay
  if (imageOverlay) {
    map.removeLayer(imageOverlay);
    imageOverlay = null;
  }

  const b = cfg.bounds;
  const southWest = mcToLatLng(b.minX, b.minZ);
  const northEast = mcToLatLng(b.maxX, b.maxZ);
  const bounds = L.latLngBounds(southWest, northEast);

  imageOverlay = L.imageOverlay(cfg.image, bounds).addTo(map);

  // optional "crisper" scaling
  // map.getPane("overlayPane").style.imageRendering = "pixelated";

  map.fitBounds(bounds);
  map.setMaxBounds(bounds);
}

function renderPOIs() {
  poiLayer.clearLayers();

  visiblePois().forEach(p => {
    const pos = mcToLatLng(p.x, p.z);

    const marker = L.circleMarker(pos, {
      radius: 6,
      color: "#7b1e2b",
      fillColor: "#c03a4a",
      fillOpacity: 0.9,
      weight: 1,
    }).addTo(poiLayer);

    marker.bindPopup(buildPopupHtml(p));

    // stash marker reference for directory clicks
    p.__marker = marker;
    p.__pos = pos;
  });
}

function renderPaths() {
  pathLayer.clearLayers();

  // Only draw paths matching current dimension (Nether highways, etc.)
  allPaths
    .filter(p => normalizeDimension(p.dimension) === currentDimension)
    .forEach(p => {
      const from = p.from || {};
      const to = p.to || {};
      if (!isNum(from.x) || !isNum(from.z) || !isNum(to.x) || !isNum(to.z)) return;

      const line = L.polyline(
        [mcToLatLng(from.x, from.z), mcToLatLng(to.x, to.z)],
        {
          weight: 3,
          opacity: 0.9,
          // Keep it simple. If you want “highway glow”, we can style later.
        }
      ).addTo(pathLayer);

      if (p.name || p.notes) {
        line.bindPopup(`
          <strong>${escapeHtml(p.name ?? "Path")}</strong><br/>
          ${p.type ? `<em>${escapeHtml(p.type)}</em><br/>` : ""}
          ${p.notes ? `<div style="margin-top:6px">${escapeHtml(p.notes)}</div>` : ""}
          <div style="margin-top:6px">From: ${from.x}, ${from.z} → To: ${to.x}, ${to.z}</div>
        `);
      }
    });
}

function renderDirectory() {
  listEl.innerHTML = "";

  // Group visible POIs by category
  const groups = {};
  visiblePois().forEach(p => {
    const cat = normalizeCategory(p.category);
    groups[cat] ??= [];
    groups[cat].push(p);
  });

  // Sort within categories
  Object.values(groups).forEach(arr => arr.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""))));

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
      // search filter (directory only)
      if (currentSearch) {
        const hay = `${p.name ?? ""} ${p.owner ?? ""} ${p.notes ?? ""}`.toLowerCase();
        if (!hay.includes(currentSearch)) return;
      }

      const li = document.createElement("li");
      li.className = "dir-item";
      li.innerHTML = `
        ${escapeHtml("– " + (p.name ?? "(Unnamed)"))}
        <span class="sub">${escapeHtml(`${p.x}, ${p.y}, ${p.z}`)}${p.owner ? ` • ${escapeHtml(p.owner)}` : ""}</span>
      `;

      li.addEventListener("click", () => {
        if (!p.__pos || !p.__marker) return;
        map.setView(p.__pos, Math.max(map.getZoom(), -1));
        p.__marker.openPopup();
      });

      listEl.appendChild(li);
    });
  });
}

// If only search changed, don’t rebuild markers/paths/map
function renderAllDirectoryOnly() {
  renderDirectory();
}

// -----------------------------
// DATA FILTERING
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

  // allow custom categories
  return c;
}

// -----------------------------
// POPUPS / HELPERS
// -----------------------------

function buildPopupHtml(p) {
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

function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function isNum(v) {
  return typeof v === "number" && Number.isFinite(v);
}
