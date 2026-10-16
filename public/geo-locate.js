// Auto-locate a photo on the pixel map from its EXIF GPS data.
//
// The map is a stylized drawing with Manhattan rotated upright, so a plain
// lat/lng projection doesn't line up. geo_fit.json holds, per map region
// (m = Manhattan, x = Bronx, b = Brooklyn + Queens), an affine transform from
// local km coordinates to grid cells, fitted against real borough outlines,
// plus simplified borough outlines used to decide which transform applies.
// Regenerate it with scripts/fit_geo.py if map_data.json changes.

const GEO_LAT0 = 40.75;
const GEO_LNG0 = -73.95;
const GEO_KM_X = 111.32 * Math.cos(GEO_LAT0 * Math.PI / 180);
const GEO_KM_Y = 110.57;
const GEO_SHORE_TOLERANCE_KM = 0.5; // photos taken on piers, bridges, ferries
const GEO_MAX_SNAP_CELLS = 8;       // e.g. upper Bronx falls off the top of the map

let geoFitPromise = null;

function loadGeoFit() {
    if (!geoFitPromise) {
        geoFitPromise = fetch('/assets/geo_fit.json')
            .then((res) => res.json())
            .catch((error) => {
                geoFitPromise = null;
                throw error;
            });
    }
    return geoFitPromise;
}

function toKm(lat, lng) {
    return [(lng - GEO_LNG0) * GEO_KM_X, (lat - GEO_LAT0) * GEO_KM_Y];
}

// Rings are flat [lat, lng, lat, lng, ...] arrays.
function ringContains(ring, lat, lng) {
    let inside = false;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const yi = ring[i], xi = ring[i + 1], yj = ring[j], xj = ring[j + 1];
        if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

function ringDistanceKm(ring, px, py) {
    let best = Infinity;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
        const [ax, ay] = toKm(ring[j], ring[j + 1]);
        const [bx, by] = toKm(ring[i], ring[i + 1]);
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
        best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
    }
    return best;
}

function findRegion(fit, lat, lng) {
    for (const [code, rings] of Object.entries(fit.rings)) {
        if (rings.some((ring) => ringContains(ring, lat, lng))) return code;
    }
    const [px, py] = toKm(lat, lng);
    let nearest = null;
    let nearestDist = GEO_SHORE_TOLERANCE_KM;
    for (const [code, rings] of Object.entries(fit.rings)) {
        for (const ring of rings) {
            const d = ringDistanceKm(ring, px, py);
            if (d < nearestDist) {
                nearestDist = d;
                nearest = code;
            }
        }
    }
    return nearest;
}

// Returns { x, y } grid cell for a lat/lng, or null if it's off the map.
function latLngToPixel(fit, grid, lat, lng) {
    const code = findRegion(fit, lat, lng);
    if (!code) return null;

    const [kx, ky] = toKm(lat, lng);
    const p = fit.affine[code];
    const col = p[0] * kx + p[1] * ky + p[2];
    const row = p[3] * kx + p[4] * ky + p[5];

    // Snap to the nearest cell drawn as the same region.
    let best = null;
    let bestDist = GEO_MAX_SNAP_CELLS;
    for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[y].length; x++) {
            if (grid[y][x] !== code) continue;
            const d = Math.hypot(x + 0.5 - col, y + 0.5 - row);
            if (d < bestDist) {
                bestDist = d;
                best = { x, y };
            }
        }
    }
    return best;
}

// --- Minimal EXIF GPS reader (JPEG APP1 and PNG eXIf) ---

function readTiffGps(view, start) {
    const little = view.getUint16(start) === 0x4949;
    const u16 = (o) => view.getUint16(start + o, little);
    const u32 = (o) => view.getUint32(start + o, little);

    const findTag = (ifd, tag) => {
        const count = u16(ifd);
        for (let i = 0; i < count; i++) {
            const entry = ifd + 2 + i * 12;
            if (u16(entry) === tag) return entry;
        }
        return null;
    };
    const rationals = (entry, n) => {
        const offset = u32(entry + 8);
        const out = [];
        for (let i = 0; i < n; i++) {
            const den = u32(offset + i * 8 + 4);
            out.push(den ? u32(offset + i * 8) / den : 0);
        }
        return out;
    };
    const ascii = (entry) => String.fromCharCode(view.getUint8(start + entry + 8));

    const ifd0 = u32(4);
    const gpsPointer = findTag(ifd0, 0x8825);
    if (gpsPointer === null) return null;
    const gpsIfd = u32(gpsPointer + 8);

    const latRef = findTag(gpsIfd, 0x0001);
    const lat = findTag(gpsIfd, 0x0002);
    const lngRef = findTag(gpsIfd, 0x0003);
    const lng = findTag(gpsIfd, 0x0004);
    if (lat === null || lng === null) return null;

    const dms = (entry) => {
        const [d, m, s] = rationals(entry, 3);
        return d + m / 60 + s / 3600;
    };
    let latitude = dms(lat);
    let longitude = dms(lng);
    if (latRef !== null && ascii(latRef) === 'S') latitude = -latitude;
    if (lngRef !== null && ascii(lngRef) === 'W') longitude = -longitude;
    if (!latitude && !longitude) return null;
    return { lat: latitude, lng: longitude };
}

function findTiffStart(view) {
    // JPEG: scan markers for APP1 "Exif\0\0"
    if (view.getUint16(0) === 0xFFD8) {
        let offset = 2;
        while (offset + 4 <= view.byteLength) {
            const marker = view.getUint16(offset);
            const size = view.getUint16(offset + 2);
            if (marker === 0xFFE1 && view.getUint32(offset + 4) === 0x45786966) {
                return offset + 10;
            }
            if (marker === 0xFFDA || (marker & 0xFF00) !== 0xFF00) break;
            offset += 2 + size;
        }
        return null;
    }
    // PNG: look for an eXIf chunk
    if (view.getUint32(0) === 0x89504E47) {
        let offset = 8;
        while (offset + 8 <= view.byteLength) {
            const length = view.getUint32(offset);
            if (view.getUint32(offset + 4) === 0x65584966) return offset + 8;
            if (view.getUint32(offset + 4) === 0x49444154) break; // IDAT: metadata is over
            offset += 12 + length;
        }
    }
    return null;
}

async function readPhotoGps(file) {
    try {
        // EXIF lives near the start of the file; PNG eXIf usually does too.
        const buffer = await file.slice(0, 512 * 1024).arrayBuffer();
        const view = new DataView(buffer);
        const tiffStart = findTiffStart(view);
        if (tiffStart === null) return null;
        return readTiffGps(view, tiffStart);
    } catch (error) {
        // Truncated or malformed metadata: treat as no location.
        return null;
    }
}

// Resolves to { x, y } or null. Never rejects.
async function locatePhotoPixel(file, grid) {
    const gps = await readPhotoGps(file);
    if (!gps || !grid || !grid.length) return null;
    try {
        const fit = await loadGeoFit();
        return latLngToPixel(fit, grid, gps.lat, gps.lng);
    } catch (error) {
        console.error('Failed to locate photo:', error);
        return null;
    }
}

window.locatePhotoPixel = locatePhotoPixel;
window.latLngToPixel = latLngToPixel;
window.loadGeoFit = loadGeoFit;
