/**
 * Interactive Leaflet Map & Bounding Box Controller for Topographic MNT
 * Maquette Slicer Studio
 */

import { ElevationProvider } from './elevationProvider.js';

export class TopoMapController {
  constructor(options = {}) {
    this.containerId = options.containerId || 'topo-map';
    this.onTerrainGenerated = options.onTerrainGenerated || (() => {});
    this.map = null;
    this.bboxLayer = null;
    this.markerLayer = null;

    // Curated iconic topographic sites
    this.presets = [
      {
        name: "Chamonix - Mont-Blanc",
        desc: "Relief alpin emblématique, aiguilles et vallées glaciaires",
        lat: 45.9237,
        lon: 6.8694,
        sizeMeters: 1200
      },
      {
        name: "Mont Ventoux (Sommet)",
        desc: "Géant de Provence, calcaire blanc et crête isolée",
        lat: 44.1741,
        lon: 5.2794,
        sizeMeters: 1400
      },
      {
        name: "Gorges du Verdon",
        desc: "Canyon spectaculaire avec falaises verticales",
        lat: 43.7431,
        lon: 6.3686,
        sizeMeters: 1000
      },
      {
        name: "Falaises d'Étretat",
        desc: "Littoral normand, arches et falaises de craie",
        lat: 49.7075,
        lon: 0.2045,
        sizeMeters: 800
      },
      {
        name: "Montagne Sainte-Victoire",
        desc: "Massif calcaire provençal cher à Paul Cézanne",
        lat: 43.5325,
        lon: 5.5806,
        sizeMeters: 1500
      },
      {
        name: "Dune du Pilat & Bassin",
        desc: "Plus haute dune de sable d'Europe face à l'océan",
        lat: 44.5897,
        lon: -1.2144,
        sizeMeters: 1000
      }
    ];

    // Current State
    this.currentCenter = { lat: 45.9237, lon: 6.8694 };
    this.footprintWidthM = 800;
    this.footprintDepthM = 600;
    this.gridResolution = 70; // 70x70 sampling grid
    this.verticalExaggeration = 1.0;
    this.baseMarginMeters = 0.0;
    this.isGenerating = false;
  }

  /**
   * Initialize Leaflet Map
   */
  init() {
    const mapElement = document.getElementById(this.containerId);
    if (!mapElement) {
      console.warn(`Map container #${this.containerId} not found.`);
      return;
    }

    if (this.map) {
      this.map.invalidateSize();
      return;
    }

    // Leaflet global check
    if (typeof window.L === 'undefined') {
      console.error("Leaflet library not loaded.");
      return;
    }

    // Create Leaflet instance
    this.map = window.L.map(this.containerId, {
      center: [this.currentCenter.lat, this.currentCenter.lon],
      zoom: 14,
      zoomControl: true,
      attributionControl: false
    });

    // Basemap Layers (100% Free, No API key required, Zero watermarks)
    const osmStandard = window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://openstreetmap.org" target="_blank">OpenStreetMap</a>'
    });

    const topoRelief = window.L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      maxZoom: 17,
      subdomains: 'abc',
      attribution: '&copy; <a href="https://opentopomap.org" target="_blank">OpenTopoMap</a>'
    });

    const esriSatellite = window.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri &mdash; Aerial Imagery'
    });

    // Default to OpenStreetMap Standard
    osmStandard.addTo(this.map);

    // Interactive Basemap Layer Switcher (Top Right)
    const baseMaps = {
      "Plan OpenStreetMap": osmStandard,
      "Relief Topo (Courbes)": topoRelief,
      "Satellite (Imagerie)": esriSatellite
    };
    window.L.control.layers(baseMaps, null, { position: 'topright' }).addTo(this.map);

    // Attribution
    window.L.control.attribution({ position: 'bottomright' })
      .addAttribution('&copy; <a href="https://openstreetmap.org" target="_blank">OSM</a> | OpenTopoMap | Esri')
      .addTo(this.map);

    // Initial bounding box
    this.updateBoundingBox();

    // Map Events
    this.map.on('move', () => {
      const center = this.map.getCenter();
      this.currentCenter = { lat: center.lat, lon: center.lng };
      this.updateBoundingBox();
    });

    // Invalidate size once visible
    setTimeout(() => {
      this.map.invalidateSize();
    }, 250);
  }

  /**
   * Compute geographic coordinates of the bounding box centered on map center
   */
  getBoundingBox() {
    const lat = this.currentCenter.lat;
    const lon = this.currentCenter.lon;

    // Approximate 1 deg lat = 111,320 meters
    const metersPerDegreeLat = 111320;
    // 1 deg lon = 111,320 * cos(lat) meters
    const metersPerDegreeLon = 111320 * Math.cos((lat * Math.PI) / 180);

    const deltaLat = (this.footprintDepthM / 2) / metersPerDegreeLat;
    const deltaLon = (this.footprintWidthM / 2) / metersPerDegreeLon;

    return {
      south: lat - deltaLat,
      north: lat + deltaLat,
      west: lon - deltaLon,
      east: lon + deltaLon
    };
  }

  /**
   * Update visual rectangle on the Leaflet map
   */
  updateBoundingBox() {
    if (!this.map || typeof window.L === 'undefined') return;

    const bbox = this.getBoundingBox();
    const bounds = [
      [bbox.south, bbox.west],
      [bbox.north, bbox.east]
    ];

    if (this.bboxLayer) {
      this.bboxLayer.setBounds(bounds);
    } else {
      this.bboxLayer = window.L.rectangle(bounds, {
        color: '#f59e0b',
        weight: 2,
        fillColor: '#f59e0b',
        fillOpacity: 0.18,
        dashArray: '4, 4'
      }).addTo(this.map);
    }

    this.updateInfoDisplay(bbox);
  }

  /**
   * Update UI badges and dimensions display
   */
  updateInfoDisplay(bbox) {
    const widthEl = document.getElementById('topo-footprint-width-label');
    const depthEl = document.getElementById('topo-footprint-depth-label');
    const coordsEl = document.getElementById('topo-coords-label');

    if (widthEl) widthEl.textContent = `${Math.round(this.footprintWidthM)} m`;
    if (depthEl) depthEl.textContent = `${Math.round(this.footprintDepthM)} m`;
    if (coordsEl) {
      coordsEl.textContent = `${this.currentCenter.lat.toFixed(4)}°N, ${this.currentCenter.lon.toFixed(4)}°E`;
    }
  }

  /**
   * Set footprint dimensions in meters
   */
  setFootprint(widthMeters, depthMeters) {
    this.footprintWidthM = Math.max(100, Math.min(10000, widthMeters));
    this.footprintDepthM = Math.max(100, Math.min(10000, depthMeters));
    this.updateBoundingBox();
  }

  /**
   * Navigate map to a given center
   */
  flyTo(lat, lon, zoom = 14) {
    this.currentCenter = { lat, lon };
    if (this.map) {
      this.map.flyTo([lat, lon], zoom, { duration: 1.2 });
    }
  }

  /**
   * Search location via Nominatim API
   */
  async searchLocation(query) {
    if (!query || query.trim().length < 2) return [];

    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      query
    )}&limit=5`;

    try {
      const res = await fetch(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'MaquetteSlicerStudio/1.0'
        }
      });
      if (!res.ok) throw new Error("Erreur de géocodage");
      const data = await res.json();
      return data;
    } catch (err) {
      console.warn("Geocoding failed:", err);
      return [];
    }
  }

  /**
   * Generate 3D Topographic Mesh and send to Slicer
   */
  async generateTerrainMesh(onProgress = () => {}) {
    if (this.isGenerating) return;
    this.isGenerating = true;

    try {
      const bbox = this.getBoundingBox();

      onProgress(0.1, "Calcul de l'emprise et échantillonnage...");

      const elevationData = await ElevationProvider.fetchElevationGrid(bbox, {
        gridX: this.gridResolution,
        gridZ: this.gridResolution,
        onProgress: (p, msg) => {
          onProgress(0.1 + p * 0.7, msg);
        }
      });

      onProgress(0.85, "Génération du maillage solide 3D...");

      const mesh = ElevationProvider.createSolidTerrainMesh(elevationData, {
        verticalExaggeration: this.verticalExaggeration,
        baseMarginMeters: this.baseMarginMeters,
        name: `MNT_${Math.round(this.footprintWidthM)}x${Math.round(this.footprintDepthM)}m`
      });

      onProgress(1.0, "Prêt !");

      if (this.onTerrainGenerated) {
        this.onTerrainGenerated(mesh, elevationData);
      }

      return { mesh, elevationData };
    } catch (err) {
      console.error("Terrain generation error:", err);
      throw err;
    } finally {
      this.isGenerating = false;
    }
  }
}
