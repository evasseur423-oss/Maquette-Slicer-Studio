/**
 * High-Precision Geometric Slicing Engine for Architectural Physical Models
 * Maquette Slicer Studio
 */

import * as THREE from 'three';
import { PolygonUtils } from './polygon.js';

export class SlicerEngine {
  /**
   * Slice a 3D Mesh / Group according to architectural parameters.
   * @param {THREE.Mesh|THREE.Group} object3D - Loaded Three.js mesh or group
   * @param {Object} options
   * @param {string} options.sourceUnit - 'm', 'cm', or 'mm'
   * @param {number} options.scale - Scale denominator (e.g. 200 for 1:200)
   * @param {number} options.materialThickness - Material plate thickness in mm (e.g. 1.5)
   * @param {Function} [options.onProgress] - Optional progress callback (0.0 to 1.0)
   * @returns {Object} Slicing result
   */
  static sliceModel(object3D, options = {}) {
    const {
      sourceUnit = 'm',
      scale = 200,
      materialThickness = 1.5,
      stepMode = 'material', // 'material' | 'contour'
      contourStepM = 1.0,
      baseMode = 'none', // 'none' (Relief pur), 'single' (1 plaque), 'pedestal' (complet)
      onProgress = null
    } = options;

    // 1. Unit conversion factor to millimeters
    let unitToMm = 1000; // default meters -> mm
    if (sourceUnit === 'cm') unitToMm = 10;
    if (sourceUnit === 'mm') unitToMm = 1;

    // 2. Extract all world triangles from the mesh
    const triangles = this.extractTriangles(object3D);
    if (triangles.length === 0) {
      throw new Error("Aucun triangle valide trouvé dans le maillage 3D.");
    }

    // 3. Compute original mesh bounds in raw units
    const rawBounds = this.computeTrianglesBounds(triangles);
    const rawWidth = rawBounds.maxX - rawBounds.minX;
    const rawHeight = rawBounds.maxY - rawBounds.minY;
    const rawDepth = rawBounds.maxZ - rawBounds.minZ;

    // Real world source dimensions (in source units, e.g. meters)
    const sourceDimensions = {
      x: rawWidth,
      y: rawHeight,
      z: rawDepth
    };

    // Real dimensions in millimeters
    const realMm = {
      x: rawWidth * unitToMm,
      y: rawHeight * unitToMm,
      z: rawDepth * unitToMm
    };

    // Real dimensions in meters
    const realMeters = {
      x: realMm.x / 1000,
      y: realMm.y / 1000,
      z: realMm.z / 1000
    };

    // Real height represented by one layer in meters
    let layerRealHeightM = (materialThickness * scale) / 1000;
    if (stepMode === 'contour' && contourStepM > 0) {
      layerRealHeightM = contourStepM;
    }

    // Target physical model dimensions in millimeters
    const physicalDimensionsMm = {
      x: realMm.x / scale,
      y: realMm.y / scale,
      z: realMm.z / scale
    };

    // Number of strata (layers)
    let totalLayers = Math.max(1, Math.round(realMeters.y / layerRealHeightM));
    // Hard cap for performance safety
    if (totalLayers > 150) totalLayers = 150;

    // Update physical height to match strata stack
    const physicalTotalHeightMm = totalLayers * materialThickness;
    physicalDimensionsMm.y = physicalTotalHeightMm;

    // Target physical model dimensions in centimeters
    const physicalDimensionsCm = {
      x: physicalDimensionsMm.x / 10,
      y: physicalTotalHeightMm / 10,
      z: physicalDimensionsMm.z / 10
    };

    // 4. Transform triangles to Physical Model Millimeters:
    // Centered horizontally around (0, 0), and resting on the ground plane (minY = 0)
    const scaleFactorToPhys = (1 / scale) * unitToMm;
    const centerX = (rawBounds.minX + rawBounds.maxX) / 2;
    const centerZ = (rawBounds.minZ + rawBounds.maxZ) / 2;
    const minY = rawBounds.minY;

    // In source unit space, each layer represents rawStep
    const rawStep = (layerRealHeightM * 1000) / unitToMm;

    // 5. Slice each stratum
    const layers = [];
    const stepProgress = onProgress ? (1 / totalLayers) : 0;

    for (let layerIdx = 0; layerIdx < totalLayers; layerIdx++) {
      // Cut plane in raw coordinates (source mesh units)
      const rawCutY = minY + (layerIdx + 0.5) * rawStep;
      const elevationBaseMm = layerIdx * materialThickness;
      const realElevationM = layerIdx * layerRealHeightM;

      // Intersect all raw triangles with plane Y = rawCutY
      const rawSegments = this.intersectTrianglesWithPlane(triangles, rawCutY);

      // Transform 2D segments to physical model millimeters centered around (0, 0)
      const physSegments = [];
      for (const seg of rawSegments) {
        physSegments.push([
          [
            (seg[0][0] - centerX) * scaleFactorToPhys,
            (seg[0][1] - centerZ) * scaleFactorToPhys
          ],
          [
            (seg[1][0] - centerX) * scaleFactorToPhys,
            (seg[1][1] - centerZ) * scaleFactorToPhys
          ]
        ]);
      }

      // Chain segments into closed polygon rings
      const rings = this.chainSegments(physSegments, 0.08);

      // Group into outer boundaries and inner holes
      const rawPolygons = PolygonUtils.groupIslandsAndHoles(rings);

      // Simplify polygons slightly to clean collinear vertices while keeping sharp corners
      const polygons = rawPolygons.map(poly => ({
        outer: PolygonUtils.simplify(poly.outer, 0.04),
        holes: poly.holes.map(h => PolygonUtils.simplify(h, 0.04)),
        area: poly.area,
        bounds: poly.bounds,
        centroid: poly.centroid
      }));

      layers.push({
        index: layerIdx,
        number: layerIdx + 1,
        elevationMm: elevationBaseMm,
        elevationTopMm: (layerIdx + 1) * materialThickness,
        yCut: elevationBaseMm + materialThickness / 2,
        realElevationM: realElevationM,
        polygons: polygons,
        guidePolygons: [] // Populated in next step
      });

      if (onProgress) {
        onProgress((layerIdx + 1) * stepProgress);
      }
    }

    // 6. Base trimming according to baseMode ('none' | 'single' | 'pedestal')
    let finalLayers = layers;
    if (baseMode !== 'pedestal' && layers.length > 1) {
      // Find consecutive bottom layers that are pure identical rectangular bounding plates
      const bboxArea = physicalDimensionsMm.x * physicalDimensionsMm.z;
      let identicalBaseCount = 0;
      for (let i = 0; i < layers.length - 1; i++) {
        const l = layers[i];
        if (l.polygons.length === 1 && l.polygons[0].holes.length === 0) {
          const poly = l.polygons[0];
          // Check if polygon is a full bounding box rectangle (outer length <= 6 and area >= 95% bbox)
          if (poly.outer.length <= 6 && poly.area >= bboxArea * 0.95) {
            identicalBaseCount++;
            continue;
          }
        }
        break;
      }

      if (identicalBaseCount > 0) {
        if (baseMode === 'none') {
          // Drop all identical flat base layers to keep only the pure terrain relief
          if (identicalBaseCount < finalLayers.length) {
            finalLayers = finalLayers.slice(identicalBaseCount);
          }
        } else if (baseMode === 'single') {
          // Keep exactly 1 base layer
          if (identicalBaseCount > 1) {
            finalLayers = finalLayers.slice(identicalBaseCount - 1);
          }
        }
      }
    }

    // Re-index layers and recalculate physical elevations
    for (let i = 0; i < finalLayers.length; i++) {
      finalLayers[i].index = i;
      finalLayers[i].number = i + 1;
      finalLayers[i].elevationMm = i * materialThickness;
      finalLayers[i].elevationTopMm = (i + 1) * materialThickness;
      finalLayers[i].yCut = finalLayers[i].elevationMm + materialThickness / 2;
    }

    // Update physical height to match final strata stack
    const finalPhysicalHeightMm = finalLayers.length * materialThickness;
    physicalDimensionsMm.y = finalPhysicalHeightMm;
    physicalDimensionsCm.y = finalPhysicalHeightMm / 10;

    // 7. Generate Alignment Guides:
    // The alignment guide on layer K is the perimeter contour of layer K+1
    for (let i = 0; i < finalLayers.length - 1; i++) {
      const nextLayer = finalLayers[i + 1];
      finalLayers[i].guidePolygons = nextLayer.polygons.map(p => ({
        outer: [...p.outer],
        holes: p.holes.map(h => [...h])
      }));
    }

    return {
      success: true,
      summary: {
        totalLayers: finalLayers.length,
        sourceDimensions,
        sourceUnit,
        scale,
        scaleRatio: `1:${scale}`,
        materialThicknessMm: materialThickness,
        stepMode,
        contourStepM: layerRealHeightM,
        baseMode,
        physicalDimensionsMm,
        physicalDimensionsCm,
        layerRealHeightM,
        triangleCount: triangles.length
      },
      layers: finalLayers,
      physicalBoundsMm: {
        width: physicalDimensionsMm.x,
        height: physicalDimensionsMm.y,
        depth: physicalDimensionsMm.z
      }
    };
  }

  /**
   * Extract all triangles in world coordinates from a Three.js Mesh or Group.
   */
  static extractTriangles(object3D) {
    const triangles = [];
    object3D.updateMatrixWorld(true);

    object3D.traverse((child) => {
      if (child.isMesh && child.geometry) {
        const geom = child.geometry;
        const positionAttr = geom.attributes.position;
        if (!positionAttr) return;

        const indexAttr = geom.index;
        const worldMatrix = child.matrixWorld;

        const vA = new THREE.Vector3();
        const vB = new THREE.Vector3();
        const vC = new THREE.Vector3();

        if (indexAttr) {
          const count = indexAttr.count;
          for (let i = 0; i < count; i += 3) {
            const iA = indexAttr.getX(i);
            const iB = indexAttr.getX(i + 1);
            const iC = indexAttr.getX(i + 2);

            vA.fromBufferAttribute(positionAttr, iA).applyMatrix4(worldMatrix);
            vB.fromBufferAttribute(positionAttr, iB).applyMatrix4(worldMatrix);
            vC.fromBufferAttribute(positionAttr, iC).applyMatrix4(worldMatrix);

            triangles.push([
              [vA.x, vA.y, vA.z],
              [vB.x, vB.y, vB.z],
              [vC.x, vC.y, vC.z]
            ]);
          }
        } else {
          const count = positionAttr.count;
          for (let i = 0; i < count; i += 3) {
            vA.fromBufferAttribute(positionAttr, i).applyMatrix4(worldMatrix);
            vB.fromBufferAttribute(positionAttr, i + 1).applyMatrix4(worldMatrix);
            vC.fromBufferAttribute(positionAttr, i + 2).applyMatrix4(worldMatrix);

            triangles.push([
              [vA.x, vA.y, vA.z],
              [vB.x, vB.y, vB.z],
              [vC.x, vC.y, vC.z]
            ]);
          }
        }
      }
    });

    return triangles;
  }

  /**
   * Compute 3D bounding box for an array of triangles.
   */
  static computeTrianglesBounds(triangles) {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < triangles.length; i++) {
      const tri = triangles[i];
      for (let j = 0; j < 3; j++) {
        const [x, y, z] = tri[j];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }

    return { minX, minY, minZ, maxX, maxY, maxZ };
  }

  /**
   * Intersect an array of 3D triangles with horizontal plane Y = yCut.
   * Produces directed 2D segments [ [x1, z1], [x2, z2] ].
   */
  static intersectTrianglesWithPlane(triangles, yCut) {
    const segments = [];

    for (let i = 0; i < triangles.length; i++) {
      const [v0, v1, v2] = triangles[i];

      // Quick bounding check
      const y0 = v0[1], y1 = v1[1], y2 = v2[1];
      const minY = Math.min(y0, y1, y2);
      const maxY = Math.max(y0, y1, y2);

      if (yCut < minY || yCut > maxY) {
        continue;
      }

      // Check intersections on 3 edges
      const edgeHits = [];

      function checkEdge(A, B) {
        const Ay = A[1], By = B[1];
        if ((Ay <= yCut && By > yCut) || (By <= yCut && Ay > yCut)) {
          const t = (yCut - Ay) / (By - Ay);
          const px = A[0] + t * (B[0] - A[0]);
          const pz = A[2] + t * (B[2] - A[2]);
          edgeHits.push([px, pz]);
        }
      }

      checkEdge(v0, v1);
      checkEdge(v1, v2);
      checkEdge(v2, v0);

      if (edgeHits.length >= 2) {
        // Take unique pair
        const p1 = edgeHits[0];
        const p2 = edgeHits[1];

        // Discard 0-length segments
        const dx = p2[0] - p1[0];
        const dz = p2[1] - p1[1];
        if (dx * dx + dz * dz > 1e-8) {
          // Compute triangle normal to properly orient the segment
          const e1x = v1[0] - v0[0], e1y = v1[1] - v0[1], e1z = v1[2] - v0[2];
          const e2x = v2[0] - v0[0], e2y = v2[1] - v0[1], e2z = v2[2] - v0[2];
          const nx = e1y * e2z - e1z * e2y;
          const nz = e1x * e2y - e1y * e2x;

          // Cross product of normal (nx, ny, nz) with Up vector (0, 1, 0) gives tangent (-nz, 0, nx)
          const dirX = -nz;
          const dirZ = nx;

          const dot = dx * dirX + dz * dirZ;
          if (dot >= 0) {
            segments.push([p1, p2]);
          } else {
            segments.push([p2, p1]);
          }
        }
      }
    }

    return segments;
  }

  /**
   * Chain segments into closed polygon rings using bidirectional spatial hashing.
   * Handles non-manifold, flipped triangles, and open contours robustly.
   * @param {Array<[[number, number], [number, number]]>} segments
   * @param {number} tolerance
   * @returns {Array<Array<[number, number]>>}
   */
  static chainSegments(segments, tolerance = 0.08) {
    if (!segments || segments.length === 0) return [];

    const tolSq = tolerance * tolerance;
    const cellSize = tolerance * 4;

    function getCellKey(x, z) {
      return `${Math.floor(x / cellSize)},${Math.floor(z / cellSize)}`;
    }

    // Bidirectional spatial hash indexing BOTH endpoints of each segment
    const hash = new Map();
    const used = new Array(segments.length).fill(false);

    for (let i = 0; i < segments.length; i++) {
      const [p0, p1] = segments[i];
      const k0 = getCellKey(p0[0], p0[1]);
      const k1 = getCellKey(p1[0], p1[1]);

      if (!hash.has(k0)) hash.set(k0, []);
      hash.get(k0).push({ segIdx: i, end: 0 });

      if (!hash.has(k1)) hash.set(k1, []);
      hash.get(k1).push({ segIdx: i, end: 1 });
    }

    function findNextSegment(currentEnd) {
      const cx = currentEnd[0];
      const cz = currentEnd[1];
      const baseCellX = Math.floor(cx / cellSize);
      const baseCellZ = Math.floor(cz / cellSize);

      let bestMatch = null;
      let bestDistSq = Infinity;

      // Search 3x3 neighboring cells
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${baseCellX + dx},${baseCellZ + dz}`;
          const list = hash.get(key);
          if (list) {
            for (let k = 0; k < list.length; k++) {
              const item = list[k];
              if (!used[item.segIdx]) {
                const seg = segments[item.segIdx];
                const pt = item.end === 0 ? seg[0] : seg[1];
                const dX = pt[0] - cx;
                const dZ = pt[1] - cz;
                const distSq = dX * dX + dZ * dZ;

                if (distSq < tolSq * 9 && distSq < bestDistSq) {
                  bestDistSq = distSq;
                  bestMatch = item;
                }
              }
            }
          }
        }
      }

      return bestMatch;
    }

    const rings = [];

    for (let i = 0; i < segments.length; i++) {
      if (used[i]) continue;

      used[i] = true;
      const ring = [segments[i][0], segments[i][1]];
      let currentEnd = segments[i][1];
      const ringStart = segments[i][0];

      let maxIterations = segments.length;
      while (maxIterations-- > 0) {
        // Check if loop is closed back to start
        const dX = currentEnd[0] - ringStart[0];
        const dZ = currentEnd[1] - ringStart[1];
        if (ring.length >= 3 && (dX * dX + dZ * dZ) < tolSq * 4) {
          // Closed loop!
          break;
        }

        const match = findNextSegment(currentEnd);
        if (match) {
          used[match.segIdx] = true;
          const nextSeg = segments[match.segIdx];
          // If connected at end 0 (seg[0]), append seg[1].
          // If connected at end 1 (seg[1]), segment is reverse oriented, so append seg[0]!
          const nextPt = match.end === 0 ? nextSeg[1] : nextSeg[0];
          ring.push(nextPt);
          currentEnd = nextPt;
        } else {
          // Open contour reached dead end
          // Only close if endpoints are actually within closing range (prevent internal cutting chords)
          if (ring.length >= 4 && (dX * dX + dZ * dZ) < tolSq * 16) {
            ring.push([ringStart[0], ringStart[1]]);
          }
          break;
        }
      }

      // Valid closed loop has at least 3 distinct vertices and noticeable area
      if (ring.length >= 3) {
        rings.push(ring);
      }
    }

    return rings;
  }
}
