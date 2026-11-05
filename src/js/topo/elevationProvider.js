/**
 * Elevation Data Provider & MNT 3D Mesh Generator
 * Maquette Slicer Studio
 *
 * Supports:
 * 1. AWS S3 Terrarium Elevation Tiles (Global DEM, R*256 + G + B/256 - 32768)
 * 2. Open-Meteo Elevation API (High reliability fallback based on Copernicus 90m / SRTM)
 * 3. Procedural Fractal Relief (Offline fallback if no internet connection is available)
 */

import * as THREE from 'three';

export class ElevationProvider {
  /**
   * Convert latitude & longitude to Web Mercator tile coordinates
   */
  static latLonToTile(lat, lon, zoom) {
    const latRad = (lat * Math.PI) / 180;
    const n = Math.pow(2, zoom);
    const x = Math.floor(((lon + 180) / 360) * n);
    const y = Math.floor(((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n);
    return { x, y };
  }

  /**
   * Convert Web Mercator tile coordinates back to lat/lon (top-left corner of tile)
   */
  static tileToLatLon(x, y, zoom) {
    const n = Math.pow(2, zoom);
    const lon = (x / n) * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
    const lat = (latRad * 180) / Math.PI;
    return { lat, lon };
  }

  /**
   * Calculate approximate ground distance in meters between two lat/lon points (Haversine formula)
   */
  static distanceInMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Fetch elevation grid for a given bounding box.
   * Tries Terrarium tiles first, then Open-Meteo API, then procedural fallback.
   *
   * @param {Object} bbox { south, west, north, east } in degrees
   * @param {Object} options
   * @param {number} [options.gridX=70] Number of sampling points along East-West
   * @param {number} [options.gridZ=70] Number of sampling points along North-South
   * @param {Function} [options.onProgress] Callback with percentage and message
   * @returns {Promise<Object>} { matrix, widthMeters, depthMeters, minElev, maxElev, source }
   */
  static async fetchElevationGrid(bbox, options = {}) {
    const {
      gridX = 70,
      gridZ = 70,
      onProgress = () => {}
    } = options;

    const { south, west, north, east } = bbox;

    // Real dimensions in meters
    const centerLat = (north + south) / 2;
    const widthMeters = this.distanceInMeters(centerLat, west, centerLat, east);
    const depthMeters = this.distanceInMeters(south, (west + east) / 2, north, (west + east) / 2);

    let result = null;

    // 1. Try AWS S3 Terrarium tiles
    try {
      onProgress(0.15, "Connexion au flux MNT Terrarium AWS...");
      result = await this.fetchFromTerrarium(bbox, gridX, gridZ, (p) => {
        onProgress(0.15 + p * 0.6, "Téléchargement des tuiles d'élévation...");
      });
      if (result) {
        result.source = "Terrarium AWS S3 (Global DEM)";
      }
    } catch (err) {
      console.warn("Terrarium fetch failed, trying Open-Meteo fallback:", err);
    }

    // 2. Try Open-Meteo elevation API fallback
    if (!result) {
      try {
        onProgress(0.4, "Requête API Altimétrique Copernicus/SRTM...");
        result = await this.fetchFromOpenMeteo(bbox, gridX, gridZ);
        if (result) {
          result.source = "Open-Meteo Elevation API (Copernicus 90m)";
        }
      } catch (err) {
        console.warn("Open-Meteo fetch failed, using procedural fallback:", err);
      }
    }

    // 3. Fallback to realistic procedural relief
    if (!result) {
      onProgress(0.8, "Génération d'un relief topographique synthétique...");
      result = this.generateProceduralGrid(bbox, gridX, gridZ);
      result.source = "Relief Topographique Hors-Ligne (Synthétique)";
    }

    result.widthMeters = widthMeters;
    result.depthMeters = depthMeters;

    onProgress(1.0, "Matrice d'élévation prête !");
    return result;
  }

  /**
   * Fetch elevation from AWS S3 Terrarium tiles
   */
  static async fetchFromTerrarium(bbox, gridX, gridZ, onProgress = () => {}) {
    const { south, west, north, east } = bbox;

    // Choose zoom level based on area width:
    // Large areas (e.g. 5-10km): zoom 12
    // Medium areas (e.g. 1-4km): zoom 13-14
    // Small areas (< 1km): zoom 14-15
    const centerLat = (north + south) / 2;
    const spanKm = this.distanceInMeters(centerLat, west, centerLat, east) / 1000;
    let zoom = 13;
    if (spanKm > 10) zoom = 11;
    else if (spanKm > 4) zoom = 12;
    else if (spanKm > 1.5) zoom = 13;
    else zoom = 14;

    const tileMin = this.latLonToTile(north, west, zoom); // Note: north has smaller y
    const tileMax = this.latLonToTile(south, east, zoom);

    const minTileX = Math.min(tileMin.x, tileMax.x);
    const maxTileX = Math.max(tileMin.x, tileMax.x);
    const minTileY = Math.min(tileMin.y, tileMax.y);
    const maxTileY = Math.max(tileMin.y, tileMax.y);

    const tilesWide = maxTileX - minTileX + 1;
    const tilesHigh = maxTileY - minTileY + 1;

    // Limit safety in case of huge bounding box
    if (tilesWide > 6 || tilesHigh > 6) {
      throw new Error("Emprise trop vaste pour le zoom Terrarium sélectionné.");
    }

    // Create a composite canvas for the tiles
    const tileSize = 256;
    const canvas = document.createElement('canvas');
    canvas.width = tilesWide * tileSize;
    canvas.height = tilesHigh * tileSize;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    let loadedCount = 0;
    const totalTiles = tilesWide * tilesHigh;

    // Load all required tiles
    const tilePromises = [];
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      for (let tx = minTileX; tx <= maxTileX; tx++) {
        const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${tx}/${ty}.png`;
        const p = this.loadImage(url)
          .then((img) => {
            const posX = (tx - minTileX) * tileSize;
            const posY = (ty - minTileY) * tileSize;
            ctx.drawImage(img, posX, posY);
            loadedCount++;
            onProgress(loadedCount / totalTiles);
          })
          .catch((err) => {
            console.warn(`Tile failed: ${url}`, err);
          });
        tilePromises.push(p);
      }
    }

    await Promise.all(tilePromises);

    if (loadedCount === 0) {
      throw new Error("Impossible de charger les tuiles Terrarium.");
    }

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = imageData.data;

    // Map each grid point to canvas pixel and extract elevation
    const matrix = [];
    let minElev = Infinity;
    let maxElev = -Infinity;

    for (let j = 0; j < gridZ; j++) {
      const row = [];
      // j=0 is south, j=gridZ-1 is north (or vice-versa, let's keep j=0 south, j=gridZ-1 north)
      const lat = south + (j / (gridZ - 1)) * (north - south);

      for (let i = 0; i < gridX; i++) {
        const lon = west + (i / (gridX - 1)) * (east - west);

        // Convert (lat, lon) to canvas pixel coordinates
        const n = Math.pow(2, zoom);
        const latRad = (lat * Math.PI) / 180;
        const globalTileX = ((lon + 180) / 360) * n;
        const globalTileY = ((1 - Math.asinh(Math.tan(latRad)) / Math.PI) / 2) * n;

        const pixelX = Math.round((globalTileX - minTileX) * tileSize);
        const pixelY = Math.round((globalTileY - minTileY) * tileSize);

        const clampedX = Math.max(0, Math.min(canvas.width - 1, pixelX));
        const clampedY = Math.max(0, Math.min(canvas.height - 1, pixelY));

        const idx = (clampedY * canvas.width + clampedX) * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];

        // Terrarium elevation formula in meters:
        // elevation = (R * 256 + G + B / 256) - 32768
        const elevation = (r * 256 + g + b / 256) - 32768;

        row.push(elevation);
        if (elevation < minElev) minElev = elevation;
        if (elevation > maxElev) maxElev = elevation;
      }
      matrix.push(row);
    }

    return {
      matrix,
      minElev,
      maxElev,
      elevationSpan: maxElev - minElev,
      gridX,
      gridZ
    };
  }

  /**
   * Fetch elevation from Open-Meteo Elevation API
   */
  static async fetchFromOpenMeteo(bbox, gridX, gridZ) {
    const { south, west, north, east } = bbox;

    // Sample coordinates
    const lats = [];
    const lons = [];

    for (let j = 0; j < gridZ; j++) {
      const lat = south + (j / (gridZ - 1)) * (north - south);
      for (let i = 0; i < gridX; i++) {
        const lon = west + (i / (gridX - 1)) * (east - west);
        lats.push(lat.toFixed(5));
        lons.push(lon.toFixed(5));
      }
    }

    // Open-Meteo query string length safe limit (~100 coordinates per request to avoid HTTP 414)
    const batchSize = 100;
    const allElevations = [];

    for (let start = 0; start < lats.length; start += batchSize) {
      const end = Math.min(start + batchSize, lats.length);
      const batchLats = lats.slice(start, end).join(',');
      const batchLons = lons.slice(start, end).join(',');

      const url = `https://api.open-meteo.com/v1/elevation?latitude=${batchLats}&longitude=${batchLons}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Open-Meteo returned status ${response.status}`);
      }
      const data = await response.json();
      if (!data.elevation || !Array.isArray(data.elevation)) {
        throw new Error("Réponse altimétrique invalide.");
      }
      allElevations.push(...data.elevation);
    }

    const matrix = [];
    let minElev = Infinity;
    let maxElev = -Infinity;

    for (let j = 0; j < gridZ; j++) {
      const row = [];
      for (let i = 0; i < gridX; i++) {
        const idx = j * gridX + i;
        const elev = allElevations[idx] !== undefined && allElevations[idx] !== null ? allElevations[idx] : 100;
        row.push(elev);
        if (elev < minElev) minElev = elev;
        if (elev > maxElev) maxElev = elev;
      }
      matrix.push(row);
    }

    return {
      matrix,
      minElev,
      maxElev,
      elevationSpan: maxElev - minElev,
      gridX,
      gridZ
    };
  }

  /**
   * Procedural terrain generator if offline
   */
  static generateProceduralGrid(bbox, gridX, gridZ) {
    const matrix = [];
    let minElev = Infinity;
    let maxElev = -Infinity;

    for (let j = 0; j < gridZ; j++) {
      const row = [];
      const v = j / (gridZ - 1);
      for (let i = 0; i < gridX; i++) {
        const u = i / (gridX - 1);

        // Multi-frequency hill and valley synthesis
        let h = 450;
        h += 120 * Math.sin(u * Math.PI * 2 + 0.5) * Math.cos(v * Math.PI * 2.2);
        h += 80 * Math.sin(u * 5.5 + v * 4.2);
        h += 45 * Math.cos(u * 9.1 - v * 8.4);
        h += 200 * Math.exp(-((u - 0.65) ** 2 + (v - 0.4) ** 2) / 0.05); // Central mountain peak

        row.push(h);
        if (h < minElev) minElev = h;
        if (h > maxElev) maxElev = h;
      }
      matrix.push(row);
    }

    return {
      matrix,
      minElev,
      maxElev,
      elevationSpan: maxElev - minElev,
      gridX,
      gridZ
    };
  }

  /**
   * Helper to load an image via Promise with crossOrigin
   */
  static loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error(`Échec du chargement de l'image : ${url}`));
      img.src = url;
    });
  }

  /**
   * Convert an elevation matrix into a solid, watertight Three.js Mesh.
   * - Top surface: THREE.PlaneGeometry with vertex Y displacements in real meters.
   * - Side skirts & bottom plate: Closed base (manifold solid) for clean horizontal plane intersection.
   *
   * @param {Object} elevationData - Output from fetchElevationGrid
   * @param {Object} options
   * @param {number} [options.verticalExaggeration=1.0] Factor to multiply altitude
   * @param {number} [options.baseMarginMeters=5.0] Height buffer below lowest terrain point
   * @param {string} [options.name='Terrain_Topographique']
   * @returns {THREE.Mesh} Solid 3D terrain mesh
   */
  static createSolidTerrainMesh(elevationData, options = {}) {
    const {
      verticalExaggeration = 1.0,
      baseMarginMeters = 0.0,
      name = 'Topographie_MNT'
    } = options;

    const {
      matrix,
      widthMeters,
      depthMeters,
      minElev,
      maxElev,
      gridX,
      gridZ
    } = elevationData;

    const segX = gridX - 1;
    const segZ = gridZ - 1;

    // Lowest base plate elevation (0 margin means lowest terrain point rests on Y = 0)
    const baseElevation = minElev - Math.max(0, baseMarginMeters);

    // Top surface vertices
    const topVertices = [];
    const topIndices = [];

    // PlaneGeometry layout centered horizontally on X and Z
    const halfW = widthMeters / 2;
    const halfD = depthMeters / 2;

    for (let j = 0; j < gridZ; j++) {
      const z = -halfD + (j / segZ) * depthMeters;
      for (let i = 0; i < gridX; i++) {
        const x = -halfW + (i / segX) * widthMeters;
        const rawElev = matrix[j][i];
        // Relative height above the reference base level
        const y = Math.max(0, (rawElev - baseElevation) * verticalExaggeration);
        topVertices.push(x, y, z);
      }
    }

    // Top surface indices
    for (let j = 0; j < segZ; j++) {
      for (let i = 0; i < segX; i++) {
        const a = j * gridX + i;
        const b = j * gridX + (i + 1);
        const c = (j + 1) * gridX + i;
        const d = (j + 1) * gridX + (i + 1);

        // Two triangles per quad (counter-clockwise top normal)
        topIndices.push(a, c, b);
        topIndices.push(b, c, d);
      }
    }

    // Now build full watertight mesh (Top surface + Bottom flat plate + 4 Side skirts)
    const vertices = [...topVertices];
    const indices = [...topIndices];
    const topVertexCount = topVertices.length / 3;

    // Bottom plate vertices: same X and Z coordinates, but Y = 0 (the reference ground level)
    for (let k = 0; k < topVertexCount; k++) {
      const vx = topVertices[k * 3];
      const vz = topVertices[k * 3 + 2];
      vertices.push(vx, 0, vz);
    }

    // Bottom plate indices (reversed winding for outward/downward normal)
    for (let t = 0; t < topIndices.length; t += 3) {
      indices.push(topVertexCount + topIndices[t + 2]);
      indices.push(topVertexCount + topIndices[t + 1]);
      indices.push(topVertexCount + topIndices[t]);
    }

    // Side skirts along 4 boundaries:
    // 1. South edge (j = 0, z = -halfD)
    for (let i = 0; i < segX; i++) {
      const t1 = i;
      const t2 = i + 1;
      const b1 = topVertexCount + t1;
      const b2 = topVertexCount + t2;
      indices.push(t1, b1, t2);
      indices.push(t2, b1, b2);
    }

    // 2. North edge (j = segZ, z = +halfD)
    const northOffset = segZ * gridX;
    for (let i = 0; i < segX; i++) {
      const t1 = northOffset + i;
      const t2 = northOffset + i + 1;
      const b1 = topVertexCount + t1;
      const b2 = topVertexCount + t2;
      indices.push(t1, t2, b1);
      indices.push(t2, b2, b1);
    }

    // 3. West edge (i = 0, x = -halfW)
    for (let j = 0; j < segZ; j++) {
      const t1 = j * gridX;
      const t2 = (j + 1) * gridX;
      const b1 = topVertexCount + t1;
      const b2 = topVertexCount + t2;
      indices.push(t1, t2, b1);
      indices.push(t2, b2, b1);
    }

    // 4. East edge (i = segX, x = +halfW)
    for (let j = 0; j < segZ; j++) {
      const t1 = j * gridX + segX;
      const t2 = (j + 1) * gridX + segX;
      const b1 = topVertexCount + t1;
      const b2 = topVertexCount + t2;
      indices.push(t1, b1, t2);
      indices.push(t2, b1, b2);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
      color: 0x3b82f6,
      roughness: 0.8,
      metalness: 0.1,
      flatShading: false
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    // Attach metadata for the slicer and physical calculator
    mesh.userData = {
      isMNT: true,
      source: elevationData.source,
      widthMeters,
      depthMeters,
      minElev,
      maxElev,
      elevationSpan: (maxElev - minElev) * verticalExaggeration,
      verticalExaggeration,
      baseMarginMeters,
      defaultUnit: 'm'
    };

    return mesh;
  }
}
