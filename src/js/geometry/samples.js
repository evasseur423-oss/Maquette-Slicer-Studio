/**
 * Built-in Architectural 3D Sample Presets
 * Maquette Slicer Studio
 */

import * as THREE from 'three';

export class ModelPresets {
  /**
   * Procedural Topography with hills, ridges, and building plateau.
   * Typical architectural site contour model (approx 60m x 45m x 16m).
   */
  static createTopography() {
    const width = 60;
    const depth = 45;
    const segX = 70;
    const segZ = 55;

    const geometry = new THREE.PlaneGeometry(width, depth, segX, segZ);
    geometry.rotateX(-Math.PI / 2); // Lay flat on XZ plane

    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);

      // Multi-frequency natural hill topography
      let h = 0;
      // Main ridge
      h += 8.5 * Math.sin(x * 0.05 + 0.3) * Math.cos(z * 0.06);
      // Secondary hill
      h += 5.5 * Math.exp(-((x - 10) ** 2 + (z + 6) ** 2) / 160);
      // Gentle undulating slope
      h += 3.0 * Math.sin(x * 0.03 + z * 0.04);
      h += 1.5 * Math.cos(x * 0.08 - z * 0.07);

      pos.setY(i, h);
    }

    // Normalize so lowest terrain vertex touches exactly Y = 0 (Relief pur, no artificial pedestal)
    let minH = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < minH) minH = y;
    }
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, pos.getY(i) - minH);
    }

    geometry.computeVertexNormals();

    // Add closed bottom base so it's a solid block
    const solidGeom = this.addBaseToTerrain(geometry, width, depth, segX, segZ);

    const material = new THREE.MeshStandardMaterial({
      color: 0x4a5568,
      roughness: 0.85,
      metalness: 0.1,
      flatShading: false
    });

    const mesh = new THREE.Mesh(solidGeom, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = "Preset_Topographie";
    mesh.userData.defaultUnit = "m";
    mesh.userData.defaultScale = 200;
    mesh.userData.defaultThickness = 1.5;

    return mesh;
  }

  /**
   * Helper to close terrain sides and base into a solid manifold mesh.
   */
  static addBaseToTerrain(topGeom, width, depth, segX, segZ) {
    // Merge top surface with side skirts and bottom plate
    const topPos = topGeom.attributes.position;
    const vertices = [];
    const indices = [];

    // Copy top vertices
    for (let i = 0; i < topPos.count; i++) {
      vertices.push(topPos.getX(i), topPos.getY(i), topPos.getZ(i));
    }

    // Top faces
    const topIndices = topGeom.index;
    for (let i = 0; i < topIndices.count; i++) {
      indices.push(topIndices.getX(i));
    }

    const nx = segX + 1;
    const nz = segZ + 1;
    const topCount = topPos.count;

    // Bottom vertices (Y = 0)
    for (let i = 0; i < topPos.count; i++) {
      vertices.push(topPos.getX(i), 0, topPos.getZ(i));
    }

    // Bottom faces (reversed winding for downward normal)
    for (let i = 0; i < topIndices.count; i += 3) {
      indices.push(topCount + topIndices.getX(i + 2));
      indices.push(topCount + topIndices.getX(i + 1));
      indices.push(topCount + topIndices.getX(i));
    }

    // Side skirts along 4 boundaries:
    // 1. South edge (z = -depth/2, j = 0)
    for (let i = 0; i < segX; i++) {
      const t1 = i;
      const t2 = i + 1;
      const b1 = topCount + t1;
      const b2 = topCount + t2;
      indices.push(t1, b1, t2);
      indices.push(t2, b1, b2);
    }
    // 2. North edge (z = +depth/2, j = segZ)
    const northOffset = segZ * nx;
    for (let i = 0; i < segX; i++) {
      const t1 = northOffset + i;
      const t2 = northOffset + i + 1;
      const b1 = topCount + t1;
      const b2 = topCount + t2;
      indices.push(t1, t2, b1);
      indices.push(t2, b2, b1);
    }
    // 3. West edge (x = -width/2, i = 0)
    for (let j = 0; j < segZ; j++) {
      const t1 = j * nx;
      const t2 = (j + 1) * nx;
      const b1 = topCount + t1;
      const b2 = topCount + t2;
      indices.push(t1, t2, b1);
      indices.push(t2, b2, b1);
    }
    // 4. East edge (x = +width/2, i = segX)
    for (let j = 0; j < segZ; j++) {
      const t1 = j * nx + segX;
      const t2 = (j + 1) * nx + segX;
      const b1 = topCount + t1;
      const b2 = topCount + t2;
      indices.push(t1, b1, t2);
      indices.push(t2, b1, b2);
    }

    const solid = new THREE.BufferGeometry();
    solid.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    solid.setIndex(indices);
    solid.computeVertexNormals();
    return solid;
  }

  /**
   * Modern Architectural Terraced Villa
   * Stepped volumes, cantilevers, central courtyard, and roof garden.
   */
  static createArchitecturalVilla() {
    const group = new THREE.Group();
    group.name = "Preset_Villa_Architecte";
    group.userData.defaultUnit = "m";
    group.userData.defaultScale = 100;
    group.userData.defaultThickness = 2.0;

    const villaMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      roughness: 0.6,
      metalness: 0.1
    });

    // Base podium / garden terrace
    const podiumGeom = new THREE.BoxGeometry(32, 2.0, 24);
    podiumGeom.translate(0, 1.0, 0);
    const podium = new THREE.Mesh(podiumGeom, villaMat);
    group.add(podium);

    // Ground floor main volume (L-shaped with courtyard)
    const wing1Geom = new THREE.BoxGeometry(20, 3.5, 9);
    wing1Geom.translate(-4, 3.75, 4);
    const wing1 = new THREE.Mesh(wing1Geom, villaMat);
    group.add(wing1);

    const wing2Geom = new THREE.BoxGeometry(9, 3.5, 16);
    wing2Geom.translate(7.5, 3.75, -0.5);
    const wing2 = new THREE.Mesh(wing2Geom, villaMat);
    group.add(wing2);

    // Cantilevered upper floor
    const upperFloorGeom = new THREE.BoxGeometry(22, 3.2, 11);
    upperFloorGeom.translate(1, 7.1, -2);
    const upperFloor = new THREE.Mesh(upperFloorGeom, villaMat);
    group.add(upperFloor);

    // Rooftop penthouse & shade pergola structure
    const penthouseGeom = new THREE.BoxGeometry(11, 2.8, 8);
    penthouseGeom.translate(-2, 10.1, -1.5);
    const penthouse = new THREE.Mesh(penthouseGeom, villaMat);
    group.add(penthouse);

    // Cantilevered terrace slab
    const terraceSlabGeom = new THREE.BoxGeometry(14, 0.5, 12);
    terraceSlabGeom.translate(-7, 5.5, -3);
    const terraceSlab = new THREE.Mesh(terraceSlabGeom, villaMat);
    group.add(terraceSlab);

    return group;
  }

  /**
   * Concentric Stepped Urban Amphitheater
   * Classic architectural study of curved tiered seating and central stage.
   */
  static createAmphitheater() {
    const group = new THREE.Group();
    group.name = "Preset_Amphitheatre";
    group.userData.defaultUnit = "m";
    group.userData.defaultScale = 100;
    group.userData.defaultThickness = 1.5;

    const amphiMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.7,
      metalness: 0.1
    });

    // Base plaza slab
    const baseGeom = new THREE.CylinderGeometry(24, 25, 1.5, 48);
    baseGeom.translate(0, 0.75, 0);
    const base = new THREE.Mesh(baseGeom, amphiMat);
    group.add(base);

    // Stepped tiers
    const tierCount = 9;
    const startRadius = 6.0;
    const tierWidth = 1.6;
    const tierHeight = 0.9;

    for (let i = 0; i < tierCount; i++) {
      const innerR = startRadius + i * tierWidth;
      const outerR = innerR + tierWidth;
      const tierH = 1.5 + (i + 1) * tierHeight;

      // Arc of 220 degrees
      const ringGeom = new THREE.CylinderGeometry(
        outerR,
        outerR,
        tierH,
        36,
        1,
        false,
        -Math.PI * 0.6,
        Math.PI * 1.2
      );
      ringGeom.translate(0, tierH / 2, 0);
      const tierMesh = new THREE.Mesh(ringGeom, amphiMat);
      group.add(tierMesh);
    }

    // Stage backdrop block
    const stageWallGeom = new THREE.BoxGeometry(18, 7, 3);
    stageWallGeom.translate(0, 3.5, 8.5);
    const stageWall = new THREE.Mesh(stageWallGeom, amphiMat);
    group.add(stageWall);

    return group;
  }
}
