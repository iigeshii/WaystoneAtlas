# Crimson Cuckoo Coven Map

Static, public, read-only map using a Mapee-exported image + POIs in Minecraft XYZ.

## Run locally
From repo root:
- Python: `python -m http.server 8000`
Then open:
- http://localhost:8000/web/

## Add a POI
Edit `data/pois.json` and add `{ "name", "x", "y", "z", "type", "notes" }`.

## Update map image
Replace `web/world.png` and adjust bounds in `web/app.js`.
