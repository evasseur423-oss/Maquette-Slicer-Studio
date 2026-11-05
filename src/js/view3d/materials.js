/**
 * Architectural Physical Model Materials & Procedural Textures
 * Maquette Slicer Studio
 */

import * as THREE from 'three';

export class ModelMaterials {
  static texturesInitialized = false;
  static textures = {};

  /**
   * Initialize procedural high-res textures for cardboard, wood, and museum board.
   */
  static initTextures() {
    if (this.texturesInitialized) return;

    // 1. Procedural Cardboard / Kraft Texture (Recycled greyboard with fibers)
    const kraftCanvas = document.createElement('canvas');
    kraftCanvas.width = 512;
    kraftCanvas.height = 512;
    const ctxK = kraftCanvas.getContext('2d');

    // Base warm grey/kraft tone
    ctxK.fillStyle = '#84796d';
    ctxK.fillRect(0, 0, 512, 512);

    // Add pulp noise and fiber specks
    const imgDataK = ctxK.getImageData(0, 0, 512, 512);
    const dataK = imgDataK.data;
    for (let i = 0; i < dataK.length; i += 4) {
      const noise = (Math.random() - 0.5) * 35;
      dataK[i] = Math.max(0, Math.min(255, dataK[i] + noise));
      dataK[i + 1] = Math.max(0, Math.min(255, dataK[i + 1] + noise * 0.9));
      dataK[i + 2] = Math.max(0, Math.min(255, dataK[i + 2] + noise * 0.8));
    }
    ctxK.putImageData(imgDataK, 0, 0);

    // Add scattered dark organic fibers
    ctxK.fillStyle = 'rgba(60, 52, 45, 0.4)';
    for (let f = 0; f < 350; f++) {
      const fx = Math.random() * 512;
      const fy = Math.random() * 512;
      const fLen = 3 + Math.random() * 8;
      const fAng = Math.random() * Math.PI;
      ctxK.beginPath();
      ctxK.moveTo(fx, fy);
      ctxK.lineTo(fx + Math.cos(fAng) * fLen, fy + Math.sin(fAng) * fLen);
      ctxK.lineWidth = 1 + Math.random();
      ctxK.stroke();
    }

    const kraftTex = new THREE.CanvasTexture(kraftCanvas);
    kraftTex.wrapS = THREE.RepeatWrapping;
    kraftTex.wrapT = THREE.RepeatWrapping;
    kraftTex.repeat.set(4, 4);

    // 2. Procedural Balsa / Birch Plywood Texture (Subtle blonde wood grain)
    const balsaCanvas = document.createElement('canvas');
    balsaCanvas.width = 512;
    balsaCanvas.height = 512;
    const ctxB = balsaCanvas.getContext('2d');

    // Base light balsa tone
    ctxB.fillStyle = '#eddcc2';
    ctxB.fillRect(0, 0, 512, 512);

    // Grain lines along horizontal axis
    for (let y = 0; y < 512; y++) {
      const wave = Math.sin(y * 0.08) * 0.5 + Math.sin(y * 0.25) * 0.25;
      const tone = 220 + wave * 18 + (Math.random() - 0.5) * 12;
      ctxB.fillStyle = `rgb(${Math.floor(tone)}, ${Math.floor(tone * 0.92)}, ${Math.floor(tone * 0.82)})`;
      ctxB.fillRect(0, y, 512, 1);
    }

    // Add fine longitudinal wood pores
    ctxB.fillStyle = 'rgba(160, 130, 95, 0.15)';
    for (let p = 0; p < 800; p++) {
      const px = Math.random() * 512;
      const py = Math.random() * 512;
      ctxB.fillRect(px, py, 20 + Math.random() * 40, 1);
    }

    const balsaTex = new THREE.CanvasTexture(balsaCanvas);
    balsaTex.wrapS = THREE.RepeatWrapping;
    balsaTex.wrapT = THREE.RepeatWrapping;
    balsaTex.repeat.set(3, 3);

    // 3. Procedural Museum Board Texture (Pure white with subtle stipple/weave)
    const museumCanvas = document.createElement('canvas');
    museumCanvas.width = 256;
    museumCanvas.height = 256;
    const ctxM = museumCanvas.getContext('2d');
    ctxM.fillStyle = '#fafaf9';
    ctxM.fillRect(0, 0, 256, 256);

    const imgDataM = ctxM.getImageData(0, 0, 256, 256);
    const dataM = imgDataM.data;
    for (let i = 0; i < dataM.length; i += 4) {
      const noise = (Math.random() - 0.5) * 10;
      dataM[i] = Math.max(0, Math.min(255, dataM[i] + noise));
      dataM[i + 1] = Math.max(0, Math.min(255, dataM[i + 1] + noise));
      dataM[i + 2] = Math.max(0, Math.min(255, dataM[i + 2] + noise));
    }
    ctxM.putImageData(imgDataM, 0, 0);

    const museumTex = new THREE.CanvasTexture(museumCanvas);
    museumTex.wrapS = THREE.RepeatWrapping;
    museumTex.wrapT = THREE.RepeatWrapping;
    museumTex.repeat.set(6, 6);

    this.textures = {
      kraft: kraftTex,
      balsa: balsaTex,
      museum: museumTex
    };

    this.texturesInitialized = true;
  }

  /**
   * Get physical material by style name.
   * @param {'kraft'|'balsa'|'museum'} style
   * @returns {THREE.Material}
   */
  static getPhysicalMaterial(style = 'kraft') {
    this.initTextures();

    switch (style) {
      case 'balsa':
        return new THREE.MeshStandardMaterial({
          color: 0xeddcc2,
          map: this.textures.balsa,
          roughness: 0.55,
          metalness: 0.02,
          bumpMap: this.textures.balsa,
          bumpScale: 0.05,
          side: THREE.DoubleSide
        });

      case 'museum':
        return new THREE.MeshStandardMaterial({
          color: 0xfafaf9,
          map: this.textures.museum,
          roughness: 0.90,
          metalness: 0.0,
          bumpMap: this.textures.museum,
          bumpScale: 0.02,
          side: THREE.DoubleSide
        });

      case 'kraft':
      default:
        return new THREE.MeshStandardMaterial({
          color: 0x93887b,
          map: this.textures.kraft,
          roughness: 0.88,
          metalness: 0.03,
          bumpMap: this.textures.kraft,
          bumpScale: 0.08,
          side: THREE.DoubleSide
        });
    }
  }

  /**
   * Material for Original Source 3D mesh (architectural clay / technical finish).
   */
  static getOriginalModelMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0x334155, // Architectural Slate Blue
      roughness: 0.65,
      metalness: 0.15,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    });
  }

  /**
   * Glowing laser line material for slice contour indicators on the original model.
   */
  static getLaserLineMaterial(color = 0x06b6d4) {
    return new THREE.LineBasicMaterial({
      color: color,
      linewidth: 2,
      transparent: true,
      opacity: 0.85
    });
  }

  /**
   * Highlight material for currently inspected stratum.
   */
  static getInspectedLayerMaterial() {
    return new THREE.MeshStandardMaterial({
      color: 0xf59e0b, // Amber Gold
      roughness: 0.4,
      metalness: 0.2,
      emissive: 0x78350f,
      emissiveIntensity: 0.35,
      side: THREE.DoubleSide
    });
  }
}
