/**
 * Maquette Slicer Studio - Main Application Controller
 * Architecture, Topography & Laser Fabrication
 */

import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

import { StudioViewport } from './view3d/viewport.js';
import { SlicerEngine } from './geometry/slicer.js';
import { ModelPresets } from './geometry/samples.js';
import { SheetPacker } from './view2d/sheetPacker.js';
import { SheetRenderer } from './view2d/sheetRenderer.js';
import { SvgExporter } from './export/svgExporter.js';
import { DxfExporter } from './export/dxfExporter.js';
import { PdfExporter } from './export/pdfExporter.js';
import { ZipExporter } from './export/zipExporter.js';
import { SheetEditor } from './view2d/sheetEditor.js';
import { TopoMapController } from './topo/mapController.js';

// Electron IPC Bridge (if available)
let ipcRenderer = null;
try {
  if (typeof window !== 'undefined' && window.require) {
    const electron = window.require('electron');
    ipcRenderer = electron.ipcRenderer;
  }
} catch (e) {
  console.log("Running in standard browser environment or context isolation.");
}

class MaquetteApp {
  constructor() {
    // Workflow State
    this.sourceMode = 'local'; // 'local' (offline files & presets) | 'online' (MNT topo)
    this.sourceUnit = 'm';
    this.scale = 200;
    this.materialThickness = 1.5;
    this.materialStyle = 'kraft';
    this.currentPreset = 'topo';

    // Contour Step Configuration
    this.stepMode = 'material'; // 'material' (linked to thickness*scale) | 'contour' (imposed step)
    this.contourStepM = 1.0;

    // Base / Socle Configuration
    this.baseMode = 'none'; // 'none' (Relief pur) | 'single' (1 plaque support) | 'pedestal' (socle complet)

    // Export Configuration
    this.exportFormat = 'svg'; // 'svg' (SVG vectoriel) | 'pdf' (PDF vectoriel 1:1)
    this.isExportingZip = false;

    // Laser Bed Configuration
    this.selectedSheetFormat = 'LASER_600x400';
    this.customBedWidth = 600;
    this.customBedHeight = 400;

    // Geometry & Slicing State
    this.currentMesh = null;
    this.slicingResult = null;
    this.packedResult = null;

    // Animation state
    this.isPlayingStack = false;
    this.playInterval = null;

    // Initialize Viewport and 2D Renderer
    const viewportContainer = document.getElementById('three-canvas-container');
    this.viewport = new StudioViewport(viewportContainer);

    const twodCanvas = document.getElementById('twod-canvas');
    this.sheetRenderer = new SheetRenderer(twodCanvas);

    // Initialize Interactive 2D Sheet Editor
    const editorCanvas = document.getElementById('sheet-editor-canvas');
    const editorWorkbench = document.getElementById('sheet-editor-workbench');
    this.sheetEditor = new SheetEditor({
      canvas: editorCanvas,
      container: editorWorkbench,
      onSave: (sheet, sIdx) => {
        if (this.packedResult && this.packedResult.sheets[sIdx]) {
          this.packedResult.sheets[sIdx] = sheet;
          this.sheetRenderer.render();
        }
      },
      onClose: () => {
        this.closeSheetEditor();
      },
      onToast: (msg) => {
        this.showToast(msg);
      }
    });

    // Initialize Online Topography Map Controller
    this.topoMapController = new TopoMapController({
      containerId: 'topo-map',
      onTerrainGenerated: (mesh, elevationData) => {
        this.onModelLoaded(mesh, `MNT - ${Math.round(elevationData.widthMeters)}×${Math.round(elevationData.depthMeters)}m`);
      }
    });

    this.bindUI();
    this.loadPreset('topo');
  }

  bindUI() {
    // =========================================================================
    // 1. Header Viewport Mode Tabs
    // =========================================================================
    const tabPhys = document.getElementById('tab-mode-phys');
    const tabOrig = document.getElementById('tab-mode-orig');
    const tab2D = document.getElementById('tab-mode-2d');

    const twodContainer = document.getElementById('twod-sheet-container');
    const threedControls = document.getElementById('viewport-3d-controls');

    const switchViewMode = (mode) => {
      tabPhys.classList.toggle('active', mode === 'physical');
      tabOrig.classList.toggle('active', mode === 'original');
      tab2D.classList.toggle('active', mode === '2d');

      const editorWorkbench = document.getElementById('sheet-editor-workbench');

      if (mode === '2d') {
        if (!this.sheetEditor || !this.sheetEditor.isOpen()) {
          twodContainer.style.display = 'block';
          if (editorWorkbench) editorWorkbench.style.display = 'none';
        }
        threedControls.style.display = 'none';
        this.sheetRenderer.render();
      } else {
        if (editorWorkbench) editorWorkbench.style.display = 'none';
        twodContainer.style.display = 'none';
        threedControls.style.display = 'flex';
        this.viewport.setViewMode(mode);
      }
    };

    tabPhys.addEventListener('click', () => switchViewMode('physical'));
    tabOrig.addEventListener('click', () => switchViewMode('original'));
    tab2D.addEventListener('click', () => switchViewMode('2d'));

    // =========================================================================
    // 1b. Custom Dark Frameless Window Controls (Electron)
    // =========================================================================
    const btnWinFullscreen = document.getElementById('btn-win-fullscreen');
    const btnWinMin = document.getElementById('btn-win-min');
    const btnWinMax = document.getElementById('btn-win-max');
    const btnWinClose = document.getElementById('btn-win-close');

    if (btnWinFullscreen) {
      btnWinFullscreen.addEventListener('click', () => {
        if (ipcRenderer) {
          ipcRenderer.invoke('window:fullscreen');
        } else if (!document.fullscreenElement) {
          document.documentElement.requestFullscreen?.();
        } else {
          document.exitFullscreen?.();
        }
      });
    }
    if (btnWinMin) {
      btnWinMin.addEventListener('click', () => {
        if (ipcRenderer) ipcRenderer.invoke('window:minimize');
      });
    }
    if (btnWinMax) {
      btnWinMax.addEventListener('click', () => {
        if (ipcRenderer) ipcRenderer.invoke('window:maximize');
      });
    }
    if (btnWinClose) {
      btnWinClose.addEventListener('click', () => {
        if (ipcRenderer) ipcRenderer.invoke('window:close');
        else window.close();
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'F11' && ipcRenderer) {
        e.preventDefault();
        ipcRenderer.invoke('window:fullscreen');
      }
    });

    // =========================================================================
    // 2. Workflow Source Switcher: Local 3D (Offline) vs Online Topo MNT
    // =========================================================================
    const btnSourceLocal = document.getElementById('source-mode-local');
    const btnSourceOnline = document.getElementById('source-mode-online');
    const panelSourceLocal = document.getElementById('panel-source-local');
    const panelSourceOnline = document.getElementById('panel-source-online');

    const switchSourceMode = (mode) => {
      this.sourceMode = mode;
      btnSourceLocal.classList.toggle('active', mode === 'local');
      btnSourceOnline.classList.toggle('active', mode === 'online');

      if (mode === 'local') {
        panelSourceLocal.style.display = 'block';
        panelSourceOnline.style.display = 'none';
      } else {
        panelSourceLocal.style.display = 'none';
        panelSourceOnline.style.display = 'block';

        // Initialize Leaflet map on first activation
        setTimeout(() => {
          this.topoMapController.init();
          this.initTopoPresetsUI();
        }, 50);
      }
    };

    btnSourceLocal.addEventListener('click', () => switchSourceMode('local'));
    btnSourceOnline.addEventListener('click', () => switchSourceMode('online'));

    // =========================================================================
    // 3. Local 3D Import & Presets (Offline)
    // =========================================================================
    document.getElementById('preset-topo').addEventListener('click', () => this.loadPreset('topo'));
    document.getElementById('preset-villa').addEventListener('click', () => this.loadPreset('villa'));
    document.getElementById('preset-amphi').addEventListener('click', () => this.loadPreset('amphi'));

    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-input');
    const linkBrowse = document.getElementById('link-browse');

    dropzone.addEventListener('click', (e) => {
      if (e.target !== linkBrowse) this.openFilePicker();
    });

    linkBrowse.addEventListener('click', (e) => {
      e.preventDefault();
      this.openFilePicker();
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        this.loadUserFile(e.target.files[0]);
      }
    });

    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => e.preventDefault());

    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        this.loadUserFile(e.dataTransfer.files[0]);
      }
    });

    // Source Unit Selector
    const unitButtons = document.querySelectorAll('[data-unit]');
    unitButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        unitButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.sourceUnit = btn.dataset.unit;

        const labels = { 'm': 'Mètres (m)', 'cm': 'Centimètres (cm)', 'mm': 'Millimètres (mm)' };
        document.getElementById('unit-label').textContent = labels[this.sourceUnit];
        this.updateLiveCalculations();
      });
    });

    // =========================================================================
    // 4. Online Topography MNT Controls
    // =========================================================================
    const topoSearchInput = document.getElementById('topo-search-input');
    const btnTopoSearch = document.getElementById('btn-topo-search');
    const topoSearchResults = document.getElementById('topo-search-results');

    const executeSearch = async () => {
      const q = topoSearchInput.value.trim();
      if (!q) return;

      btnTopoSearch.disabled = true;
      try {
        const results = await this.topoMapController.searchLocation(q);
        topoSearchResults.innerHTML = '';

        if (results.length === 0) {
          topoSearchResults.innerHTML = `<div class="topo-search-result-item" style="color:var(--text-dim);">Aucune localité trouvée pour "${q}"</div>`;
        } else {
          for (const item of results) {
            const row = document.createElement('div');
            row.className = 'topo-search-result-item';
            row.textContent = item.display_name.split(',').slice(0, 3).join(',');
            row.addEventListener('click', () => {
              const lat = parseFloat(item.lat);
              const lon = parseFloat(item.lon);
              this.topoMapController.flyTo(lat, lon, 14);
              topoSearchResults.style.display = 'none';
              topoSearchInput.value = row.textContent;
            });
            topoSearchResults.appendChild(row);
          }
        }
        topoSearchResults.style.display = 'block';
      } catch (err) {
        this.showToast("Erreur lors de la recherche de lieu.");
      } finally {
        btnTopoSearch.disabled = false;
      }
    };

    btnTopoSearch.addEventListener('click', executeSearch);
    topoSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') executeSearch();
    });

    // Hide search results when clicking outside
    document.addEventListener('click', (e) => {
      if (!topoSearchInput.contains(e.target) && !topoSearchResults.contains(e.target)) {
        topoSearchResults.style.display = 'none';
      }
    });

    // Footprint Quick Size Buttons
    const footprintButtons = document.querySelectorAll('.footprint-btn');
    footprintButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        footprintButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const size = parseFloat(btn.dataset.footprint);
        // Set aspect ratio matching standard laser table 3:2 (e.g. 600x400)
        this.topoMapController.setFootprint(size, Math.round(size * 0.75));
      });
    });

    // Vertical Exaggeration Slider
    const topoExaggSlider = document.getElementById('topo-exagg-slider');
    const topoExaggVal = document.getElementById('topo-exagg-val');
    topoExaggSlider.addEventListener('input', () => {
      const val = parseFloat(topoExaggSlider.value);
      topoExaggVal.textContent = `${val.toFixed(2)}×`;
      this.topoMapController.verticalExaggeration = val;
    });

    // Base Margin Slider
    const topoBaseSlider = document.getElementById('topo-base-slider');
    const topoBaseVal = document.getElementById('topo-base-val');
    topoBaseSlider.addEventListener('input', () => {
      const val = parseFloat(topoBaseSlider.value);
      topoBaseVal.textContent = val === 0 ? '0 m (Relief pur)' : `${val} m (Socle surélevé)`;
      this.topoMapController.baseMarginMeters = val;
    });

    // Generate Topography MNT Button
    const btnGenerateTopo = document.getElementById('btn-generate-topo');
    const progressBar = document.getElementById('topo-progress-bar');
    const progressFill = document.getElementById('topo-progress-fill');
    const progressText = document.getElementById('topo-progress-text');

    btnGenerateTopo.addEventListener('click', async () => {
      btnGenerateTopo.disabled = true;
      progressBar.style.display = 'block';
      progressText.style.display = 'block';
      progressFill.style.width = '10%';
      progressText.textContent = "Connexion au flux altimétrique mondial...";

      try {
        await this.topoMapController.generateTerrainMesh((p, msg) => {
          progressFill.style.width = `${Math.round(p * 100)}%`;
          progressText.textContent = msg;
        });

        this.showToast("Topographie MNT générée et tranchée avec succès !");
      } catch (err) {
        console.error(err);
        this.showToast(`Erreur MNT : ${err.message}`);
      } finally {
        setTimeout(() => {
          progressBar.style.display = 'none';
          progressText.style.display = 'none';
          btnGenerateTopo.disabled = false;
        }, 1200);
      }
    });

    // =========================================================================
    // 5. Fabrication Parameters: Scale, Thickness, Contour Step, Laser Bed
    // =========================================================================

    // (A) Scale Selector & Custom Input
    const scaleButtons = document.querySelectorAll('[data-scale]');
    const customScaleInput = document.getElementById('custom-scale-input');
    const scaleBadge = document.getElementById('scale-badge');
    const summaryScaleTag = document.getElementById('summary-scale-tag');
    const pillScale = document.getElementById('pill-scale');

    scaleButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        scaleButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.scale = parseFloat(btn.dataset.scale);
        customScaleInput.value = this.scale;
        scaleBadge.textContent = `1:${this.scale}`;
        summaryScaleTag.textContent = `1:${this.scale}`;
        pillScale.textContent = `1:${this.scale}`;
        this.updateStepLabel();
        this.updateLiveCalculations();
      });
    });

    customScaleInput.addEventListener('input', () => {
      const val = parseFloat(customScaleInput.value);
      if (val > 0) {
        this.scale = val;
        scaleButtons.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.scale) === val));
        scaleBadge.textContent = `1:${this.scale}`;
        summaryScaleTag.textContent = `1:${this.scale}`;
        pillScale.textContent = `1:${this.scale}`;
        this.updateStepLabel();
        this.updateLiveCalculations();
      }
    });

    // (B) Material Thickness Selector & Custom Input
    const thickButtons = document.querySelectorAll('[data-thick]');
    const customThickInput = document.getElementById('custom-thick-input');
    const thicknessBadge = document.getElementById('thickness-badge');
    const pillThick = document.getElementById('pill-thick');

    thickButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        thickButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.materialThickness = parseFloat(btn.dataset.thick);
        customThickInput.value = this.materialThickness;
        thicknessBadge.textContent = `${this.materialThickness} mm`;
        pillThick.textContent = `${this.materialThickness} mm`;
        this.updateStepLabel();
        this.updateLiveCalculations();
      });
    });

    customThickInput.addEventListener('input', () => {
      const val = parseFloat(customThickInput.value);
      if (val > 0) {
        this.materialThickness = val;
        thickButtons.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.thick) === val));
        thicknessBadge.textContent = `${this.materialThickness} mm`;
        pillThick.textContent = `${this.materialThickness} mm`;
        this.updateStepLabel();
        this.updateLiveCalculations();
      }
    });

    // (C) Contour Step Mode (Lié au matériau vs Pas altimétrique imposé)
    const btnModeStepMat = document.getElementById('btn-mode-step-material');
    const btnModeStepContour = document.getElementById('btn-mode-step-contour');
    const contourStepContainer = document.getElementById('contour-step-container');
    const customStepInput = document.getElementById('custom-step-input');
    const stepButtons = document.querySelectorAll('[data-step]');

    btnModeStepMat.addEventListener('click', () => {
      this.stepMode = 'material';
      btnModeStepMat.classList.add('active');
      btnModeStepContour.classList.remove('active');
      contourStepContainer.style.display = 'none';
      this.updateStepLabel();
      this.updateLiveCalculations();
    });

    btnModeStepContour.addEventListener('click', () => {
      this.stepMode = 'contour';
      btnModeStepContour.classList.add('active');
      btnModeStepMat.classList.remove('active');
      contourStepContainer.style.display = 'block';
      this.updateStepLabel();
      this.updateLiveCalculations();
    });

    stepButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        stepButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.contourStepM = parseFloat(btn.dataset.step);
        customStepInput.value = this.contourStepM;
        this.updateStepLabel();
        this.updateLiveCalculations();
      });
    });

    customStepInput.addEventListener('input', () => {
      const val = parseFloat(customStepInput.value);
      if (val > 0) {
        this.contourStepM = val;
        stepButtons.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.step) === val));
        this.updateStepLabel();
        this.updateLiveCalculations();
      }
    });

    // (D) Base / Socle Mode Selector
    const baseButtons = document.querySelectorAll('[data-base]');
    const baseModeBadge = document.getElementById('base-mode-badge');
    const baseLabels = {
      'none': 'Relief pur (Sans socle)',
      'single': '1 Plaque support',
      'pedestal': 'Socle complet'
    };

    baseButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        baseButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.baseMode = btn.dataset.base;
        if (baseModeBadge) {
          baseModeBadge.textContent = baseLabels[this.baseMode] || this.baseMode;
        }
        this.performSlicing();
      });
    });

    // (E) Laser Bed Target Configuration
    const laserBedSelect = document.getElementById('laser-bed-select');
    const sheetFormatSelect = document.getElementById('sheet-format-select');
    const customBedInputs = document.getElementById('custom-bed-inputs');
    const customBedW = document.getElementById('custom-bed-w');
    const customBedH = document.getElementById('custom-bed-h');
    const laserBedBadge = document.getElementById('laser-bed-badge');

    const handleLaserBedChange = (formatKey) => {
      this.selectedSheetFormat = formatKey;
      laserBedSelect.value = formatKey;
      sheetFormatSelect.value = formatKey;

      if (formatKey === 'CUSTOM') {
        customBedInputs.style.display = 'grid';
        this.customBedWidth = parseFloat(customBedW.value) || 600;
        this.customBedHeight = parseFloat(customBedH.value) || 400;
        laserBedBadge.textContent = `${this.customBedWidth} × ${this.customBedHeight} mm`;
      } else {
        customBedInputs.style.display = 'none';
        const info = SheetPacker.FORMATS[formatKey] || SheetPacker.FORMATS['LASER_600x400'];
        laserBedBadge.textContent = `${info.width} × ${info.height} mm`;
      }

      this.repackSheets();
    };

    laserBedSelect.addEventListener('change', () => handleLaserBedChange(laserBedSelect.value));
    sheetFormatSelect.addEventListener('change', () => handleLaserBedChange(sheetFormatSelect.value));

    customBedW.addEventListener('input', () => {
      const val = parseFloat(customBedW.value);
      if (val > 50) {
        this.customBedWidth = val;
        laserBedBadge.textContent = `${this.customBedWidth} × ${this.customBedHeight} mm`;
        this.repackSheets();
      }
    });

    customBedH.addEventListener('input', () => {
      const val = parseFloat(customBedH.value);
      if (val > 50) {
        this.customBedHeight = val;
        laserBedBadge.textContent = `${this.customBedWidth} × ${this.customBedHeight} mm`;
        this.repackSheets();
      }
    });

    // Re-Slice Button
    document.getElementById('btn-re-slice').addEventListener('click', () => {
      this.performSlicing();
    });

    // =========================================================================
    // 6. 3D Inspection & Materials
    // =========================================================================
    const matButtons = document.querySelectorAll('[data-mat]');
    matButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        matButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.materialStyle = btn.dataset.mat;
        this.viewport.setMaterialStyle(this.materialStyle);
      });
    });

    const layerSlider = document.getElementById('layer-slider');
    const layerSliderVal = document.getElementById('layer-slider-val');
    const btnPlayStack = document.getElementById('btn-play-stack');
    const isolateToggle = document.getElementById('isolate-toggle');

    const updateLayerInspection = () => {
      const maxVal = parseInt(layerSlider.value, 10);
      const total = parseInt(layerSlider.max, 10);
      const isIsolated = isolateToggle.checked;

      if (maxVal >= total && !isIsolated) {
        layerSliderVal.textContent = `Toutes les couches (${total}/${total})`;
      } else {
        layerSliderVal.textContent = isIsolated
          ? `Couche isolée : #${String(maxVal).padStart(2, '0')}`
          : `Couches 1 à ${maxVal} (${maxVal}/${total})`;
      }

      this.viewport.setLayerInspection(maxVal - 1, maxVal - 1, isIsolated);
    };

    layerSlider.addEventListener('input', updateLayerInspection);
    isolateToggle.addEventListener('change', updateLayerInspection);

    btnPlayStack.addEventListener('click', () => {
      if (this.isPlayingStack) {
        this.stopStackAnimation();
      } else {
        this.startStackAnimation();
      }
    });

    const explodedSlider = document.getElementById('exploded-slider');
    const explodedSliderVal = document.getElementById('exploded-slider-val');
    explodedSlider.addEventListener('input', () => {
      const gap = parseFloat(explodedSlider.value);
      explodedSliderVal.textContent = `${gap.toFixed(1)} mm`;
      this.viewport.setExplodedGap(gap);
    });

    // 3D Camera Controls
    document.getElementById('btn-view-iso').addEventListener('click', () => {
      this.viewport.camera.position.set(250, 180, 250);
      this.viewport.controls.target.set(0, 30, 0);
      this.viewport.controls.update();
    });

    document.getElementById('btn-view-top').addEventListener('click', () => {
      this.viewport.camera.position.set(0, 350, 0.1);
      this.viewport.controls.target.set(0, 0, 0);
      this.viewport.controls.update();
    });

    document.getElementById('btn-view-front').addEventListener('click', () => {
      this.viewport.camera.position.set(0, 30, 320);
      this.viewport.controls.target.set(0, 30, 0);
      this.viewport.controls.update();
    });

    document.getElementById('btn-view-focus').addEventListener('click', () => {
      this.viewport.focusModel();
    });

    // =========================================================================
    // 7. 2D Cut Sheet Pagination & Display Toggles
    // =========================================================================
    document.getElementById('btn-prev-sheet').addEventListener('click', () => {
      if (this.packedResult && this.sheetRenderer.currentSheetIndex > 0) {
        this.sheetRenderer.setSheetIndex(this.sheetRenderer.currentSheetIndex - 1);
        this.updateSheetPageIndicator();
      }
    });

    document.getElementById('btn-next-sheet').addEventListener('click', () => {
      if (this.packedResult && this.sheetRenderer.currentSheetIndex < this.packedResult.sheets.length - 1) {
        this.sheetRenderer.setSheetIndex(this.sheetRenderer.currentSheetIndex + 1);
        this.updateSheetPageIndicator();
      }
    });

    document.getElementById('btn-fit-sheet').addEventListener('click', () => {
      this.sheetRenderer.fitToScreen();
      this.sheetRenderer.render();
    });

    const toggleCut = document.getElementById('toggle-layer-cut');
    const toggleGuides = document.getElementById('toggle-layer-guides');
    const toggleLabels = document.getElementById('toggle-layer-labels');

    toggleCut.addEventListener('change', () => {
      this.sheetRenderer.showCutLines = toggleCut.checked;
      this.sheetRenderer.render();
    });

    toggleGuides.addEventListener('change', () => {
      this.sheetRenderer.showGuides = toggleGuides.checked;
      this.sheetRenderer.render();
    });

    toggleLabels.addEventListener('change', () => {
      this.sheetRenderer.showLabels = toggleLabels.checked;
      this.sheetRenderer.render();
    });

    // =========================================================================
    // 8. Vector Export Buttons (SVG, DXF & ZIP Archive)
    // =========================================================================
    document.getElementById('btn-export-svg').addEventListener('click', () => {
      this.exportSVG();
    });

    document.getElementById('btn-export-dxf').addEventListener('click', () => {
      this.exportDXF();
    });

    const btnDxfSidebar = document.getElementById('btn-export-dxf-sidebar');
    if (btnDxfSidebar) {
      btnDxfSidebar.addEventListener('click', () => this.exportDXF());
    }

    // Export Format Selector (SVG vs PDF Vectoriel)
    const btnFormatSvg = document.getElementById('btn-format-svg');
    const btnFormatPdf = document.getElementById('btn-format-pdf');
    const exportFormatBadge = document.getElementById('export-format-badge');

    const handleFormatChange = (fmt) => {
      this.exportFormat = fmt;
      btnFormatSvg.classList.toggle('active', fmt === 'svg');
      btnFormatPdf.classList.toggle('active', fmt === 'pdf');
      if (exportFormatBadge) {
        exportFormatBadge.textContent = fmt === 'svg' ? 'SVG Vectoriel' : 'PDF Vectoriel (1:1)';
      }
    };

    if (btnFormatSvg) btnFormatSvg.addEventListener('click', () => handleFormatChange('svg'));
    if (btnFormatPdf) btnFormatPdf.addEventListener('click', () => handleFormatChange('pdf'));

    // Download All Sheets ZIP
    const btnDownloadZip = document.getElementById('btn-download-zip');
    const btnHeaderZip = document.getElementById('btn-header-download-zip');
    if (btnDownloadZip) btnDownloadZip.addEventListener('click', () => this.exportAllSheetsZip());
    if (btnHeaderZip) btnHeaderZip.addEventListener('click', () => this.exportAllSheetsZip());

    // Download Active Sheet Only
    const btnExportCurrentSingle = document.getElementById('btn-export-current-single');
    if (btnExportCurrentSingle) {
      btnExportCurrentSingle.addEventListener('click', () => this.exportCurrentSingleSheet());
    }

    // =========================================================================
    // 9. Interactive 2D Sheet Editor Controls
    // =========================================================================
    // Open Editor Buttons
    const btnOpenEditor = document.getElementById('btn-open-sheet-editor');
    if (btnOpenEditor) {
      btnOpenEditor.addEventListener('click', () => this.openSheetEditor());
    }

    const btnSidebarEdit = document.getElementById('btn-sidebar-edit-sheet');
    if (btnSidebarEdit) {
      btnSidebarEdit.addEventListener('click', () => this.openSheetEditor());
    }

    // Direct Sheet Selector Dropdowns
    const sheetDropdownSelect = document.getElementById('sheet-dropdown-select');
    if (sheetDropdownSelect) {
      sheetDropdownSelect.addEventListener('change', (e) => {
        const idx = parseInt(e.target.value);
        this.sheetRenderer.setSheetIndex(idx);
        this.updateSheetPageIndicator();
      });
    }

    const editorSheetSelect = document.getElementById('editor-sheet-select');
    if (editorSheetSelect) {
      editorSheetSelect.addEventListener('change', (e) => {
        const idx = parseInt(e.target.value);
        this.openSheetEditor(idx);
      });
    }

    // CAD Tool Switchers
    document.getElementById('editor-tool-node')?.addEventListener('click', () => this.sheetEditor.setTool('node'));
    document.getElementById('editor-tool-add')?.addEventListener('click', () => this.sheetEditor.setTool('add-node'));
    document.getElementById('editor-tool-pan')?.addEventListener('click', () => this.sheetEditor.setTool('pan'));

    // Laser Color Palette Actions
    document.getElementById('editor-color-red')?.addEventListener('click', () => this.sheetEditor.setColor('#ff0000'));
    document.getElementById('editor-color-blue')?.addEventListener('click', () => this.sheetEditor.setColor('#0000ff'));
    document.getElementById('editor-color-black')?.addEventListener('click', () => this.sheetEditor.setColor('#000000'));

    // History (Undo / Redo)
    document.getElementById('editor-btn-undo')?.addEventListener('click', () => this.sheetEditor.undo());
    document.getElementById('editor-btn-redo')?.addEventListener('click', () => this.sheetEditor.redo());

    // Validation & Reset Actions
    document.getElementById('editor-btn-reset')?.addEventListener('click', () => this.sheetEditor.resetSheet());
    document.getElementById('editor-btn-save')?.addEventListener('click', () => this.sheetEditor.validateAndClose());
    document.getElementById('editor-btn-close')?.addEventListener('click', () => this.closeSheetEditor());
  }

  /**
   * Populate Preset Chips for iconic landscapes
   */
  initTopoPresetsUI() {
    const list = document.getElementById('topo-presets-list');
    if (!list || list.children.length > 0) return;

    for (const preset of this.topoMapController.presets) {
      const chip = document.createElement('button');
      chip.className = 'topo-preset-chip';
      chip.textContent = preset.name;
      chip.title = preset.desc;
      chip.addEventListener('click', () => {
        document.querySelectorAll('.topo-preset-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.topoMapController.flyTo(preset.lat, preset.lon, 14);
        this.topoMapController.setFootprint(preset.sizeMeters, Math.round(preset.sizeMeters * 0.75));
      });
      list.appendChild(chip);
    }
  }

  /**
   * Update the dynamic label describing the contour elevation step
   */
  updateStepLabel() {
    const label = document.getElementById('step-computed-label');
    if (!label) return;

    if (this.stepMode === 'material') {
      const m = (this.materialThickness * this.scale) / 1000;
      label.textContent = `${m.toFixed(2)} m`;
    } else {
      label.textContent = `${this.contourStepM.toFixed(2)} m`;
    }
  }

  /**
   * Load Built-in Presets
   */
  loadPreset(type) {
    this.currentPreset = type;
    document.getElementById('preset-topo').classList.toggle('active', type === 'topo');
    document.getElementById('preset-villa').classList.toggle('active', type === 'villa');
    document.getElementById('preset-amphi').classList.toggle('active', type === 'amphi');

    let mesh;
    let name;

    if (type === 'villa') {
      mesh = ModelPresets.createArchitecturalVilla();
      name = "Villa Contemporaine";
      this.sourceUnit = 'm';
      this.scale = 100;
      this.materialThickness = 2.0;
    } else if (type === 'amphi') {
      mesh = ModelPresets.createAmphitheater();
      name = "Amphithéâtre";
      this.sourceUnit = 'm';
      this.scale = 100;
      this.materialThickness = 1.5;
    } else {
      mesh = ModelPresets.createTopography();
      name = "Colline Topographique";
      this.sourceUnit = 'm';
      this.scale = 200;
      this.materialThickness = 1.5;
    }

    document.getElementById('mesh-info-badge').textContent = name;
    this.syncControls();

    this.currentMesh = mesh;
    this.viewport.setOriginalMesh(this.currentMesh);

    this.performSlicing();
    this.viewport.focusModel();
  }

  syncControls() {
    // Unit
    document.querySelectorAll('[data-unit]').forEach(b => {
      b.classList.toggle('active', b.dataset.unit === this.sourceUnit);
    });
    const labels = { 'm': 'Mètres (m)', 'cm': 'Centimètres (cm)', 'mm': 'Millimètres (mm)' };
    document.getElementById('unit-label').textContent = labels[this.sourceUnit];

    // Scale
    document.querySelectorAll('[data-scale]').forEach(b => {
      b.classList.toggle('active', parseFloat(b.dataset.scale) === this.scale);
    });
    document.getElementById('custom-scale-input').value = this.scale;
    document.getElementById('scale-badge').textContent = `1:${this.scale}`;
    document.getElementById('summary-scale-tag').textContent = `1:${this.scale}`;
    document.getElementById('pill-scale').textContent = `1:${this.scale}`;

    // Thickness
    document.querySelectorAll('[data-thick]').forEach(b => {
      b.classList.toggle('active', parseFloat(b.dataset.thick) === this.materialThickness);
    });
    document.getElementById('custom-thick-input').value = this.materialThickness;
    document.getElementById('thickness-badge').textContent = `${this.materialThickness} mm`;
    document.getElementById('pill-thick').textContent = `${this.materialThickness} mm`;

    // Step label
    this.updateStepLabel();
  }

  /**
   * File Picker Handler (Electron Dialog or HTML Input)
   */
  async openFilePicker() {
    if (ipcRenderer) {
      try {
        const fileData = await ipcRenderer.invoke('dialog:open-file');
        if (fileData) {
          this.loadModelFromBuffer(fileData.buffer, fileData.ext, fileData.name);
        }
        return;
      } catch (err) {
        console.warn("Electron dialog failed, falling back to input", err);
      }
    }
    document.getElementById('file-input').click();
  }

  loadUserFile(file) {
    const reader = new FileReader();
    const ext = '.' + file.name.split('.').pop().toLowerCase();

    reader.onload = (e) => {
      this.loadModelFromBuffer(e.target.result, ext, file.name);
    };

    if (ext === '.obj') {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  }

  loadModelFromBuffer(bufferOrText, ext, fileName) {
    try {
      let object3D = null;

      if (ext === '.stl') {
        const loader = new STLLoader();
        const geometry = loader.parse(bufferOrText);
        geometry.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7 });
        object3D = new THREE.Mesh(geometry, mat);
      } else if (ext === '.obj') {
        const loader = new OBJLoader();
        object3D = loader.parse(typeof bufferOrText === 'string' ? bufferOrText : new TextDecoder().decode(bufferOrText));
      } else if (ext === '.gltf' || ext === '.glb') {
        const loader = new GLTFLoader();
        loader.parse(bufferOrText, '', (gltf) => {
          this.onModelLoaded(gltf.scene, fileName);
        }, (err) => {
          this.showToast(`Erreur GLTF : ${err.message}`);
        });
        return;
      } else if (ext === '.fbx') {
        const loader = new FBXLoader();
        object3D = loader.parse(bufferOrText, '');
      } else {
        this.showToast(`Format non pris en charge : ${ext}`);
        return;
      }

      if (object3D) {
        this.onModelLoaded(object3D, fileName);
      }
    } catch (err) {
      console.error(err);
      this.showToast(`Erreur de lecture du fichier : ${err.message}`);
    }
  }

  onModelLoaded(object3D, fileName) {
    this.currentMesh = object3D;
    this.currentPreset = null;

    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('mesh-info-badge').textContent = fileName || "Modèle chargé";

    this.viewport.setOriginalMesh(this.currentMesh);
    this.performSlicing();
    this.viewport.focusModel();

    this.showToast(`Modèle "${fileName}" importé et tranché avec succès !`);
  }

  /**
   * Run Slicing Algorithm and Update 3D & 2D views
   */
  performSlicing() {
    if (!this.currentMesh) return;

    try {
      // 1. Slice
      this.slicingResult = SlicerEngine.sliceModel(this.currentMesh, {
        sourceUnit: this.sourceUnit,
        scale: this.scale,
        materialThickness: this.materialThickness,
        stepMode: this.stepMode,
        contourStepM: this.contourStepM,
        baseMode: this.baseMode
      });

      // 2. Build 3D Physical Model
      this.viewport.buildPhysicalModel(this.slicingResult);

      // 3. Update Layer Inspection Slider
      const totalLayers = this.slicingResult.layers.length;
      const layerSlider = document.getElementById('layer-slider');
      layerSlider.max = totalLayers;
      layerSlider.value = totalLayers;
      document.getElementById('layer-slider-val').textContent = `Toutes les couches (${totalLayers}/${totalLayers})`;
      document.getElementById('isolate-toggle').checked = false;

      // 4. Pack onto target laser bed and update stats UI
      this.repackSheets();

    } catch (err) {
      console.error("Slicing error:", err);
      this.showToast(`Erreur de tranchage : ${err.message}`);
    }
  }

  /**
   * Pack layers onto laser bed sheets according to selected format
   */
  repackSheets() {
    if (!this.slicingResult) return;

    let bedW = 600;
    let bedH = 400;

    if (this.selectedSheetFormat === 'CUSTOM') {
      bedW = this.customBedWidth || 600;
      bedH = this.customBedHeight || 400;
    } else {
      const formatInfo = SheetPacker.FORMATS[this.selectedSheetFormat] || SheetPacker.FORMATS['LASER_600x400'];
      bedW = formatInfo.width;
      bedH = formatInfo.height;
    }

    this.packedResult = SheetPacker.packLayers(this.slicingResult.layers, {
      sheetWidth: bedW,
      sheetHeight: bedH,
      margin: 8,
      spacing: 5
    });

    // Create deep snapshots for resetting each sheet without re-slicing
    for (const sheet of this.packedResult.sheets) {
      sheet._originalBackup = JSON.parse(JSON.stringify(sheet.items));
    }

    this.sheetRenderer.setData(this.packedResult, 0);
    this.updateSheetPageIndicator();
    this.updateStatsUI(this.slicingResult.summary, this.packedResult);

    if (this.sheetEditor && this.sheetEditor.isOpen()) {
      const curIdx = Math.min(this.sheetEditor.sheetIndex, this.packedResult.sheets.length - 1);
      this.sheetEditor.openSheet(this.packedResult.sheets[curIdx], curIdx, this.packedResult.sheets.length);
    }
  }

  updateSheetPageIndicator() {
    if (!this.packedResult || !this.packedResult.sheets || this.packedResult.sheets.length === 0) return;
    const cur = this.sheetRenderer.currentSheetIndex;
    const total = this.packedResult.sheets.length;

    const ind = document.getElementById('sheet-page-indicator');
    if (ind) ind.textContent = `Planche ${cur + 1} / ${total}`;

    const dropdown = document.getElementById('sheet-dropdown-select');
    if (dropdown) {
      dropdown.innerHTML = '';
      for (let i = 0; i < total; i++) {
        const s = this.packedResult.sheets[i];
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `Planche ${i + 1}/${total} (${s.items.length} pièces)`;
        if (i === cur) opt.selected = true;
        dropdown.appendChild(opt);
      }
    }

    const editorSelect = document.getElementById('editor-sheet-select');
    if (editorSelect) {
      editorSelect.innerHTML = '';
      for (let i = 0; i < total; i++) {
        const s = this.packedResult.sheets[i];
        const opt = document.createElement('option');
        opt.value = i;
        opt.textContent = `Planche ${i + 1} / ${total} (${s.items.length} pièces)`;
        if (i === cur) opt.selected = true;
        editorSelect.appendChild(opt);
      }
    }
  }

  /**
   * Open dedicated 2D nodal interactive editor for a specific laser sheet.
   * @param {number} [sheetIndex=-1]
   */
  openSheetEditor(sheetIndex = -1) {
    if (!this.packedResult || !this.packedResult.sheets || this.packedResult.sheets.length === 0) {
      this.showToast("Veuillez d'abord trancher un modèle 3D.");
      return;
    }

    const sIdx = sheetIndex >= 0 ? sheetIndex : this.sheetRenderer.currentSheetIndex;
    const validIdx = Math.max(0, Math.min(sIdx, this.packedResult.sheets.length - 1));
    this.sheetRenderer.setSheetIndex(validIdx);
    this.updateSheetPageIndicator();

    // Switch view mode tab to 2D
    const tabPhys = document.getElementById('tab-mode-phys');
    const tabOrig = document.getElementById('tab-mode-orig');
    const tab2D = document.getElementById('tab-mode-2d');
    if (tabPhys) tabPhys.classList.remove('active');
    if (tabOrig) tabOrig.classList.remove('active');
    if (tab2D) tab2D.classList.add('active');

    const twodContainer = document.getElementById('twod-sheet-container');
    const threedControls = document.getElementById('viewport-3d-controls');
    const editorWorkbench = document.getElementById('sheet-editor-workbench');

    if (twodContainer) twodContainer.style.display = 'none';
    if (threedControls) threedControls.style.display = 'none';
    if (editorWorkbench) editorWorkbench.style.display = 'flex';

    this.sheetEditor.openSheet(this.packedResult.sheets[validIdx], validIdx, this.packedResult.sheets.length);
    this.showToast(`Mode Édition activé : Planche #${validIdx + 1} (Déplacement nodal & Couleurs)`);
  }

  /**
   * Close the 2D sheet editor and return to standard preview.
   */
  closeSheetEditor() {
    const twodContainer = document.getElementById('twod-sheet-container');
    const editorWorkbench = document.getElementById('sheet-editor-workbench');

    if (editorWorkbench) editorWorkbench.style.display = 'none';
    if (twodContainer) twodContainer.style.display = 'block';

    this.sheetRenderer.render();
  }

  /**
   * Update Summary Box Numbers and Nesting Statistics
   */
  updateStatsUI(summary, packed) {
    const { physicalDimensionsCm, layerRealHeightM, totalLayers } = summary;

    const dimStr = `${physicalDimensionsCm.x.toFixed(1)} × ${physicalDimensionsCm.z.toFixed(1)} × ${physicalDimensionsCm.y.toFixed(1)} cm`;
    document.getElementById('stat-dimensions').textContent = dimStr;
    document.getElementById('pill-dims').textContent = dimStr;

    // Real elevation per layer formatted nicely
    let elevStr = '';
    if (layerRealHeightM >= 1.0) {
      elevStr = `${layerRealHeightM.toFixed(2)} m par couche`;
    } else {
      elevStr = `${(layerRealHeightM * 100).toFixed(1)} cm par couche`;
    }
    document.getElementById('stat-elevation-per-layer').textContent = elevStr;

    document.getElementById('stat-total-layers').textContent = `${totalLayers} strates`;
    document.getElementById('pill-layers').textContent = totalLayers;

    // Nesting statistics
    if (packed) {
      const sheetCount = packed.totalSheets;
      const bedDimStr = `${packed.sheetWidth}×${packed.sheetHeight}`;
      document.getElementById('stat-sheets-count').textContent = `${sheetCount} ${sheetCount > 1 ? 'planches' : 'planche'} (${bedDimStr})`;
      document.getElementById('stat-material-yield').textContent = `${packed.materialYieldPercent}% (${packed.wastePercent}% chutes)`;

      const exportSheetsBadge = document.getElementById('export-sheets-badge');
      if (exportSheetsBadge) {
        exportSheetsBadge.textContent = `${sheetCount} ${sheetCount > 1 ? 'planches prêtes' : 'planche prête'}`;
      }
    }
  }

  /**
   * Live calculation updates before pressing re-slice
   */
  updateLiveCalculations() {
    this.performSlicing();
  }

  /**
   * Animate stacking / deconstructing stratum by stratum
   */
  startStackAnimation() {
    this.isPlayingStack = true;
    const layerSlider = document.getElementById('layer-slider');
    const playIcon = document.getElementById('play-icon');

    playIcon.innerHTML = `<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>`;

    let currentVal = 1;
    layerSlider.value = 1;
    layerSlider.dispatchEvent(new Event('input'));

    const maxVal = parseInt(layerSlider.max, 10);

    this.playInterval = setInterval(() => {
      currentVal++;
      if (currentVal > maxVal) {
        currentVal = 1;
      }
      layerSlider.value = currentVal;
      layerSlider.dispatchEvent(new Event('input'));
    }, 120);
  }

  stopStackAnimation() {
    this.isPlayingStack = false;
    if (this.playInterval) {
      clearInterval(this.playInterval);
      this.playInterval = null;
    }
    const playIcon = document.getElementById('play-icon');
    playIcon.innerHTML = `<polygon points="5 3 19 12 5 21 5 3"></polygon>`;
  }

  /**
   * Export SVG (Laser-standard: Red #ff0000 cuts, Blue #0066ff engravings)
   */
  async exportSVG() {
    if (!this.packedResult) {
      this.showToast("Veuillez d'abord trancher un modèle 3D.");
      return;
    }

    try {
      const svgContent = SvgExporter.generateSVG(this.packedResult, {
        cutColor: '#ff0000',
        guideColor: '#0066ff',
        labelColor: '#0066ff'
      });
      const defaultFilename = `maquette-topographie-laser-1_${this.scale}.svg`;

      if (ipcRenderer) {
        const res = await ipcRenderer.invoke('dialog:save-file', {
          defaultName: defaultFilename,
          content: svgContent,
          filterType: 'svg'
        });

        if (res.success) {
          this.showToast(`SVG exporté avec succès dans : ${res.filePath}`);
          return;
        } else if (res.canceled) {
          return;
        }
      }

      // Browser Fallback Download
      this.downloadBlob(svgContent, 'image/svg+xml;charset=utf-8', defaultFilename);
      this.showToast(`Fichier "${defaultFilename}" exporté avec succès !`);

    } catch (err) {
      console.error(err);
      this.showToast(`Erreur lors de l'export SVG : ${err.message}`);
    }
  }

  /**
   * Export AutoCAD / Rhino DXF (R12 ASCII: Layer CUT=Red, Layer GUIDE/LABEL=Blue)
   */
  async exportDXF() {
    if (!this.packedResult) {
      this.showToast("Veuillez d'abord trancher un modèle 3D.");
      return;
    }

    try {
      const dxfContent = DxfExporter.generateDXF(this.packedResult);
      const defaultFilename = `maquette-topographie-cao-1_${this.scale}.dxf`;

      if (ipcRenderer) {
        const res = await ipcRenderer.invoke('dialog:save-file', {
          defaultName: defaultFilename,
          content: dxfContent,
          filterType: 'dxf'
        });

        if (res.success) {
          this.showToast(`DXF exporté avec succès dans : ${res.filePath}`);
          return;
        } else if (res.canceled) {
          return;
        }
      }

      // Browser Fallback Download
      this.downloadBlob(dxfContent, 'application/dxf;charset=utf-8', defaultFilename);
      this.showToast(`Fichier "${defaultFilename}" exporté avec succès !`);

    } catch (err) {
      console.error(err);
      this.showToast(`Erreur lors de l'export DXF : ${err.message}`);
    }
  }

  downloadBlob(content, mimeType, filename) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  downloadBinaryBlob(bytes, mimeType, filename) {
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Export all laser cutting sheets bundled in a ZIP archive with progress tracking.
   */
  async exportAllSheetsZip() {
    if (!this.packedResult || !this.packedResult.sheets || this.packedResult.sheets.length === 0) {
      this.showToast("Veuillez d'abord trancher un modèle 3D.");
      return;
    }

    if (this.isExportingZip) return;
    this.isExportingZip = true;

    const progressPanel = document.getElementById('export-progress-panel');
    const progressStatus = document.getElementById('export-progress-status');
    const progressPercent = document.getElementById('export-progress-percent');
    const progressFill = document.getElementById('export-progress-fill');
    const btnZip = document.getElementById('btn-download-zip');
    const btnHeaderZip = document.getElementById('btn-header-download-zip');

    if (progressPanel) progressPanel.style.display = 'block';
    if (btnZip) btnZip.disabled = true;
    if (btnHeaderZip) btnHeaderZip.disabled = true;

    try {
      const totalSheets = this.packedResult.sheets.length;
      const formatUpper = this.exportFormat.toUpperCase();

      await ZipExporter.exportZip(this.packedResult, {
        format: this.exportFormat,
        summary: this.slicingResult ? this.slicingResult.summary : {},
        zipFileName: 'maquette_decoupe_laser.zip',
        onProgress: (ratio, msg) => {
          const pct = Math.round(ratio * 100);
          if (progressPercent) progressPercent.textContent = `${pct}%`;
          if (progressStatus) progressStatus.textContent = msg;
          if (progressFill) progressFill.style.width = `${pct}%`;
        }
      });

      this.showToast(`Archive "maquette_decoupe_laser.zip" téléchargée (${totalSheets} planches ${formatUpper}) !`);
    } catch (err) {
      console.error("ZIP Export error:", err);
      this.showToast(`Erreur lors de la création du ZIP : ${err.message}`);
    } finally {
      setTimeout(() => {
        if (progressPanel) progressPanel.style.display = 'none';
        if (btnZip) btnZip.disabled = false;
        if (btnHeaderZip) btnHeaderZip.disabled = false;
        this.isExportingZip = false;
      }, 1500);
    }
  }

  /**
   * Export single currently active sheet in selected format (SVG or PDF)
   */
  async exportCurrentSingleSheet() {
    if (!this.packedResult || !this.packedResult.sheets) {
      this.showToast("Veuillez d'abord trancher un modèle 3D.");
      return;
    }

    const sIdx = this.sheetRenderer.currentSheetIndex;
    const sheet = this.packedResult.sheets[sIdx];
    if (!sheet) return;

    const sheetNum = String(sIdx + 1).padStart(2, '0');
    const filename = `planche_${sheetNum}.${this.exportFormat}`;

    try {
      if (this.exportFormat === 'pdf') {
        const pdfBytes = PdfExporter.generateSingleSheetPDF(sheet, {
          totalSheets: this.packedResult.sheets.length
        });

        if (ipcRenderer) {
          const res = await ipcRenderer.invoke('dialog:save-file', {
            defaultName: filename,
            content: pdfBytes,
            filterType: 'pdf'
          });
          if (res.success) {
            this.showToast(`Planche #${sIdx + 1} exportée en PDF : ${res.filePath}`);
            return;
          } else if (res.canceled) return;
        }

        this.downloadBinaryBlob(pdfBytes, 'application/pdf', filename);
        this.showToast(`Planche #${sIdx + 1} exportée en PDF vectoriel (1:1) !`);
      } else {
        // SVG
        const svg = SvgExporter.generateSingleSheetSVG(this.packedResult, sIdx);

        if (ipcRenderer) {
          const res = await ipcRenderer.invoke('dialog:save-file', {
            defaultName: filename,
            content: svg,
            filterType: 'svg'
          });
          if (res.success) {
            this.showToast(`Planche #${sIdx + 1} exportée en SVG : ${res.filePath}`);
            return;
          } else if (res.canceled) return;
        }

        this.downloadBlob(svg, 'image/svg+xml;charset=utf-8', filename);
        this.showToast(`Planche #${sIdx + 1} exportée en SVG laser !`);
      }
    } catch (err) {
      console.error(err);
      this.showToast(`Erreur d'export : ${err.message}`);
    }
  }

  showToast(msg) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toast-message');
    toastMsg.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 4500);
  }
}

// Bootstrap application on DOM ready
window.addEventListener('DOMContentLoaded', () => {
  window.app = new MaquetteApp();
});
