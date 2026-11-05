/**
 * 3D Architectural Viewport Manager with Three.js
 * Maquette Slicer Studio
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ModelMaterials } from './materials.js';

export class StudioViewport {
  constructor(containerElement) {
    this.container = containerElement;
    this.viewMode = 'physical'; // 'physical' or 'original'
    this.materialStyle = 'kraft'; // 'kraft', 'balsa', 'museum'
    this.inspectedLayerIndex = -1; // -1 means show all active
    this.maxVisibleLayer = Infinity;
    this.isolateActiveLayer = false;
    this.explodedGap = 0; // mm

    this.slicingData = null;
    this.originalMesh = null;

    this.initScene();
    this.setupLights();
    this.setupGrid();
    this.setupEvents();
    this.animate();
  }

  initScene() {
    // 1. Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e0f11);

    // 2. Camera
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 5000);
    this.camera.position.set(250, 180, 250);

    // 3. Renderer
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.container.appendChild(this.renderer.domElement);

    // 4. Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.05; // Slightly below horizon
    this.controls.minDistance = 5;
    this.controls.maxDistance = 2000;
    this.controls.target.set(0, 30, 0);

    // 5. Root groups for scene elements
    this.originalGroup = new THREE.Group();
    this.originalGroup.name = "OriginalGroup";
    this.scene.add(this.originalGroup);

    this.sliceLinesGroup = new THREE.Group();
    this.sliceLinesGroup.name = "SliceLinesGroup";
    this.scene.add(this.sliceLinesGroup);

    this.physicalModelGroup = new THREE.Group();
    this.physicalModelGroup.name = "PhysicalModelGroup";
    this.scene.add(this.physicalModelGroup);

    this.layerMeshes = []; // Array of { group, index, baseElevation, thickness }
  }

  setupLights() {
    // Soft Ambient Light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    // Key Directional Light with soft shadows
    this.dirLight = new THREE.DirectionalLight(0xfff6ea, 1.4);
    this.dirLight.position.set(200, 350, 150);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.width = 2048;
    this.dirLight.shadow.mapSize.height = 2048;
    this.dirLight.shadow.camera.near = 10;
    this.dirLight.shadow.camera.far = 1000;

    const shadowDist = 200;
    this.dirLight.shadow.camera.left = -shadowDist;
    this.dirLight.shadow.camera.right = shadowDist;
    this.dirLight.shadow.camera.top = shadowDist;
    this.dirLight.shadow.camera.bottom = -shadowDist;
    this.dirLight.shadow.bias = -0.0003;
    this.scene.add(this.dirLight);

    // Fill Light (Cooler tone)
    const fillLight = new THREE.DirectionalLight(0x93c5fd, 0.5);
    fillLight.position.set(-200, 150, -200);
    this.scene.add(fillLight);

    // Rim Light (Sharp architectural edges)
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.4);
    rimLight.position.set(0, 100, -300);
    this.scene.add(rimLight);
  }

  setupGrid() {
    // Ground Grid (mm / cm grid)
    const gridHelper = new THREE.GridHelper(600, 60, 0x3b4252, 0x1e222b);
    gridHelper.position.y = -0.05;
    this.scene.add(gridHelper);

    // Shadow receiver plane on ground
    const shadowPlaneGeom = new THREE.PlaneGeometry(1000, 1000);
    const shadowPlaneMat = new THREE.ShadowMaterial({ opacity: 0.35 });
    const shadowPlane = new THREE.Mesh(shadowPlaneGeom, shadowPlaneMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -0.1;
    shadowPlane.receiveShadow = true;
    this.scene.add(shadowPlane);
  }

  setupEvents() {
    window.addEventListener('resize', () => this.onResize());
  }

  onResize() {
    if (!this.container || !this.renderer) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(() => this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Set the Original 3D Model in the viewport.
   */
  setOriginalMesh(meshOrGroup) {
    // Clear previous
    while (this.originalGroup.children.length > 0) {
      this.originalGroup.remove(this.originalGroup.children[0]);
    }

    this.originalMesh = meshOrGroup;
    if (this.originalMesh) {
      this.originalGroup.add(this.originalMesh);
    }
  }

  /**
   * Build the Physical Extruded Model and Cutting Lines from Slicing Data.
   */
  buildPhysicalModel(slicingResult) {
    this.slicingData = slicingResult;

    // Clear previous
    while (this.physicalModelGroup.children.length > 0) {
      this.physicalModelGroup.remove(this.physicalModelGroup.children[0]);
    }
    while (this.sliceLinesGroup.children.length > 0) {
      this.sliceLinesGroup.remove(this.sliceLinesGroup.children[0]);
    }
    this.layerMeshes = [];

    const { layers, summary } = slicingResult;
    const thickness = summary.materialThicknessMm;
    const physMat = ModelMaterials.getPhysicalMaterial(this.materialStyle);
    const lineMat = ModelMaterials.getLaserLineMaterial(0x06b6d4);

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      const layerGroup = new THREE.Group();
      layerGroup.name = `Layer_${layer.number}`;
      layerGroup.userData = {
        layerIndex: i,
        elevationBase: layer.elevationMm,
        thickness: thickness
      };

      // 1. Physical 3D Extrusion for each polygon
      for (const poly of layer.polygons) {
        if (!poly.outer || poly.outer.length < 3) continue;

        const shape = new THREE.Shape();
        // Outer loop (X, Z mapped to Shape X, Y)
        const [x0, z0] = poly.outer[0];
        shape.moveTo(x0, z0);
        for (let ptIdx = 1; ptIdx < poly.outer.length; ptIdx++) {
          const [px, pz] = poly.outer[ptIdx];
          shape.lineTo(px, pz);
        }
        shape.closePath();

        // Inner holes
        for (const holeRing of poly.holes) {
          if (holeRing.length < 3) continue;
          const holePath = new THREE.Path();
          const [hx0, hz0] = holeRing[0];
          holePath.moveTo(hx0, hz0);
          for (let hIdx = 1; hIdx < holeRing.length; hIdx++) {
            const [hx, hz] = holeRing[hIdx];
            holePath.lineTo(hx, hz);
          }
          holePath.closePath();
          shape.holes.push(holePath);
        }

        // Extrude along Y
        const extrudeSettings = {
          steps: 1,
          depth: thickness,
          bevelEnabled: true,
          bevelThickness: 0.1,
          bevelSize: 0.1,
          bevelOffset: -0.05,
          bevelSegments: 2
        };

        const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        // Rotate so extrusion depth is along Y axis (Up)
        geom.rotateX(Math.PI / 2);
        // Translate to layer elevation
        geom.translate(0, layer.elevationMm + thickness, 0);

        const mesh = new THREE.Mesh(geom, physMat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData = { layerIndex: i };
        layerGroup.add(mesh);
      }

      this.physicalModelGroup.add(layerGroup);
      this.layerMeshes.push({
        group: layerGroup,
        index: i,
        elevationBase: layer.elevationMm,
        thickness: thickness
      });

      // 2. Cut lines on Original Model (Glowing laser rings at cut height)
      for (const poly of layer.polygons) {
        if (!poly.outer || poly.outer.length < 3) continue;
        const linePts = [];
        for (const [px, pz] of poly.outer) {
          linePts.push(new THREE.Vector3(px, layer.yCut, pz));
        }
        linePts.push(new THREE.Vector3(poly.outer[0][0], layer.yCut, poly.outer[0][1]));

        const lineGeom = new THREE.BufferGeometry().setFromPoints(linePts);
        const line = new THREE.Line(lineGeom, lineMat);
        this.sliceLinesGroup.add(line);
      }
    }

    this.updateVisibilityAndTransforms();
  }

  /**
   * Set View Mode: 'physical' (Maquette physique) or 'original' (Modèle 3D source + coupes).
   */
  setViewMode(mode) {
    this.viewMode = mode;
    this.updateVisibilityAndTransforms();
  }

  /**
   * Set Material Style for Physical Model: 'kraft', 'balsa', 'museum'.
   */
  setMaterialStyle(style) {
    this.materialStyle = style;
    const newMat = ModelMaterials.getPhysicalMaterial(style);
    const inspectedMat = ModelMaterials.getInspectedLayerMaterial();

    for (const item of this.layerMeshes) {
      const isInspected = (item.index === this.inspectedLayerIndex);
      item.group.traverse((child) => {
        if (child.isMesh) {
          child.material = isInspected ? inspectedMat : newMat;
        }
      });
    }
  }

  /**
   * Set layer inspection / slicing slider.
   * @param {number} maxLayerIdx - Highest visible layer index (0 to totalLayers-1, or Infinity for all)
   * @param {number} inspectedIdx - Specific selected layer index
   * @param {boolean} isolateOnly - If true, show only the inspected layer
   */
  setLayerInspection(maxLayerIdx, inspectedIdx = -1, isolateOnly = false) {
    this.maxVisibleLayer = maxLayerIdx;
    this.inspectedLayerIndex = inspectedIdx;
    this.isolateActiveLayer = isolateOnly;
    this.updateVisibilityAndTransforms();
  }

  /**
   * Set Exploded View gap in mm (spreads layers vertically).
   */
  setExplodedGap(gapMm) {
    this.explodedGap = Math.max(0, gapMm);
    this.updateVisibilityAndTransforms();
  }

  /**
   * Update visibility, colors, and vertical offsets for all layers.
   */
  updateVisibilityAndTransforms() {
    const isPhysical = (this.viewMode === 'physical');

    // Toggle main groups
    this.physicalModelGroup.visible = isPhysical;
    this.originalGroup.visible = !isPhysical;
    this.sliceLinesGroup.visible = !isPhysical;

    if (!isPhysical) return;

    const baseMat = ModelMaterials.getPhysicalMaterial(this.materialStyle);
    const inspectedMat = ModelMaterials.getInspectedLayerMaterial();

    for (let i = 0; i < this.layerMeshes.length; i++) {
      const item = this.layerMeshes[i];
      let visible = true;

      if (this.isolateActiveLayer) {
        visible = (i === this.inspectedLayerIndex);
      } else {
        visible = (i <= this.maxVisibleLayer);
      }

      item.group.visible = visible;

      // Exploded view Y offset
      const extraY = i * this.explodedGap;
      item.group.position.y = extraY;

      // Highlight inspected layer
      const isInspected = (i === this.inspectedLayerIndex);
      item.group.traverse((child) => {
        if (child.isMesh) {
          child.material = isInspected ? inspectedMat : baseMat;
        }
      });
    }
  }

  /**
   * Focus camera smoothly on current model bounds.
   */
  focusModel() {
    let bbox = new THREE.Box3();

    if (this.viewMode === 'physical' && this.physicalModelGroup.children.length > 0) {
      bbox.setFromObject(this.physicalModelGroup);
    } else if (this.originalMesh) {
      bbox.setFromObject(this.originalMesh);
    } else {
      bbox.set(new THREE.Vector3(-100, 0, -100), new THREE.Vector3(100, 50, 100));
    }

    if (bbox.isEmpty()) return;

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    bbox.getCenter(center);
    bbox.getSize(size);

    const maxDim = Math.max(size.x, size.y, size.z, 50);
    const fov = this.camera.fov * (Math.PI / 180);
    let cameraDist = maxDim / (2 * Math.tan(fov / 2));
    cameraDist *= 1.6;

    this.controls.target.copy(center);
    this.camera.position.set(center.x + cameraDist * 0.7, center.y + cameraDist * 0.6, center.z + cameraDist * 0.8);
    this.camera.lookAt(center);
    this.controls.update();
  }
}
