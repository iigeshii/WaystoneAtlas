console.log("Waystone Atlas loaded");

// -----------------------------
// CONFIG
// -----------------------------

// Minecraft bounds from Mapee "Visible areas"
const WORLD_BOUNDS = {
  minX: -5159,
  maxX:  5157,
  minZ: -2611,
  maxZ:  2609,
};

// Map image (kept generic on purpose)
const IMAGE_URL = "world.jpg";

// Category display order + headings (matches your format)
const CATEGORY_ORDER = [
  "Base",
  "Community Feature",
  "Farm",
  "Other",
  "Portal",
  "Shop",
];

const CATEGORY_LABELS = {
  "Base": "🏠 BASES",
  "Community Feature": "🐴 COMMUNITY FEATURES",
  "Farm": "🌾 FARMS",
  "Other": "🪦 OTHER",
  "Portal": "🔥 PORTALS",
  "Shop": "🛒 SHOPS",
};

// -----------------------------
// MAP SETUP
// -----------------------------

const map = L.map("map", {
  crs: L.CRS.Simple,
  minZoom: -4,
  zoom: -2,
});

// Leaflet expects [y, x]. We treat that as [Z, X].
// Fix north/south inversion by negating Z.
function mcToLatLng(x, z) {
  return [-z, x];
}

const southWest = mcToLatLng(WORLD_BOUNDS.minX, WORLD_BOUNDS.minZ);
const northEast = mcToLatLng(WORLD_BOUNDS.maxX, WORLD_BOUNDS.maxZ);
const bounds = L.latLngBounds(southWest, northEast);

L.imageOverlay(IMAGE_URL, bounds).addTo(map);
map.fitBounds(bounds);
map.setMaxBounds(bounds);

// -----------------------------
// LOAD POIS
// -----------------------------

fetch("pois.json")
  .then(r => {
    if (!r.ok) throw new Error("pois.json not found or unreadable");
    return r.json();
  })
  .then(pois => renderPOIs(pois))
  .catch(err => {
    console.error(err);
    alert("Failed to load POIs. Check data/pois.json and run via http://localhost:8000/web/");
  });

// -----------------------------
// RENDER
// -----------------------------

function renderPOIs(pois) {
  // Create markers first, group directory entries second
  const list = document.getElementById("poi-list");
  list.innerHTML = "";

  // Group POIs by category
  const groups = {};
  pois.forEach(p => {
    const cat = normalizeCategory(p.category);
    groups[cat] ??= [];
    groups[cat].push(p);
  });

  // Sort POIs within each category by name
  Object.values(groups).forEach(arr => {
    arr.sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
  });

  // Render categories in preferred order, then any extras
  const orderedCats = [
    ...CATEGORY_ORDER,
    ...Object.keys(groups).filter(c => !CATEGORY_ORDER.includes(c)).sort(),
  ];

  orderedCats.forEach(cat => {
    const items = groups[cat];
    if (!items || items.length === 0) return;

    // Category header
    const header = document.createElement("li");
    header.textContent = CATEGORY_LABELS[cat] ?? cat.toUpperCase();
    header.className = "dir-header";
    list.appendChild(header);

    // Items under category
    items.forEach(p => {
      const pos = mcToLatLng(p.x, p.z);

      // Marker
      const marker = L.circleMarker(pos, {
        radius: 6,
        color: "#7b1e2b",
        fillColor: "#c03a4a",
        fillOpacity: 0.9,
        weight: 1,
      }).addTo(map);

      marker.bindPopup(buildPopupHtml(p));

      // Directory entry
      const li = document.createElement("li");
      li.className = "dir-item";
      li.textContent = "– " + (p.name ?? "(Unnamed)");
      li.onclick = () => {
        map.setView(pos, Math.max(map.getZoom(), -1));
        marker.openPopup();
      };

      list.appendChild(li);
    });
  });
}

// -----------------------------
// HELPERS
// -----------------------------

function buildPopupHtml(p) {
  const name = escapeHtml(p.name);
  const cat = escapeHtml(normalizeCategory(p.category));
  const owner = p.owner ? `<div><strong>Owner:</strong> ${escapeHtml(p.owner)}</div>` : "";
  const notes = p.notes ? `<div style="margin-top:6px">${escapeHtml(p.notes)}</div>` : "";

  // Coordinates (Minecraft XYZ)
  const coords = `XYZ: ${p.x}, ${p.y}, ${p.z}`;

  return `
    <strong>${name}</strong><br/>
    <em>${cat}</em><br/>
    ${coords}
    ${owner}
    ${notes}
  `;
}

function normalizeCategory(category) {
  const c = String(category ?? "").trim();

  // If you keep categories consistent you won’t need this,
  // but it helps prevent small variations from splitting groups.
  const lowered = c.toLowerCase();

  if (!c) return "Other";
  if (lowered === "bases" || lowered === "base") return "Base";
  if (lowered.includes("community")) return "Community Feature";
  if (lowered === "farm" || lowered === "farms") return "Farm";
  if (lowered === "portal" || lowered === "portals") return "Portal";
  if (lowered === "shop" || lowered === "shops") return "Shop";
  if (lowered === "other") return "Other";

  // Unknown categories are allowed (they’ll appear after the ordered ones)
  return c;
}

function escapeHtml(v) {
  return String(v ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
