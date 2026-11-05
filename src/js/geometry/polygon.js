/**
 * Polygon & 2D Geometry Utilities for Architectural Slicing
 * Maquette Slicer Studio
 */

export class PolygonUtils {
  /**
   * Calculate signed area of a 2D polygon ring.
   * Positive = Counter-Clockwise (CCW), Negative = Clockwise (CW).
   * @param {Array<[number, number]>} ring - Array of [x, y] coordinates.
   * @returns {number}
   */
  static getSignedArea(ring) {
    if (!ring || ring.length < 3) return 0;
    let area = 0;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % n];
      area += (x1 * y2 - x2 * y1);
    }
    return area / 2;
  }

  /**
   * Calculate absolute area.
   */
  static getArea(ring) {
    return Math.abs(this.getSignedArea(ring));
  }

  /**
   * Check if ring is Counter-Clockwise.
   */
  static isCCW(ring) {
    return this.getSignedArea(ring) > 0;
  }

  /**
   * Ensure ring has specified winding direction.
   * @param {Array<[number, number]>} ring
   * @param {boolean} ccw - true for CCW, false for CW
   */
  static ensureWinding(ring, ccw = true) {
    const isCurrentCCW = this.isCCW(ring);
    if (isCurrentCCW !== ccw) {
      return [...ring].reverse();
    }
    return ring;
  }

  /**
   * Calculate the exact centroid (Center of Mass) of a polygon.
   * @param {Array<[number, number]>} ring
   * @returns {[number, number]} [cx, cy]
   */
  static getCentroid(ring) {
    if (!ring || ring.length === 0) return [0, 0];
    if (ring.length === 1) return [ring[0][0], ring[0][1]];
    if (ring.length === 2) {
      return [(ring[0][0] + ring[1][0]) / 2, (ring[0][1] + ring[1][1]) / 2];
    }

    let cx = 0;
    let cy = 0;
    let signedArea = 0;
    const n = ring.length;

    for (let i = 0; i < n; i++) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[(i + 1) % n];
      const cross = (x0 * y1 - x1 * y0);
      signedArea += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }

    signedArea *= 0.5;
    if (Math.abs(signedArea) < 1e-9) {
      // Degenerate polygon, fallback to bounding box center or arithmetic mean
      let sumX = 0, sumY = 0;
      for (const [x, y] of ring) {
        sumX += x;
        sumY += y;
      }
      return [sumX / n, sumY / n];
    }

    cx /= (6 * signedArea);
    cy /= (6 * signedArea);
    return [cx, cy];
  }

  /**
   * Calculate 2D Bounding Box of a polygon or array of rings.
   * @param {Array<[number, number]>|Array<Array<[number, number]>>} rings
   * @returns {{minX: number, minY: number, maxX: number, maxY: number, width: number, height: number}}
   */
  static getBounds(rings) {
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;

    const processPoint = ([x, y]) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    };

    if (rings.length > 0 && typeof rings[0][0] === 'number') {
      // Single ring
      rings.forEach(processPoint);
    } else {
      // Multiple rings
      rings.forEach(r => r.forEach(processPoint));
    }

    if (minX === Infinity) {
      return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
    }

    return {
      minX,
      minY,
      maxX,
      maxY,
      width: maxX - minX,
      height: maxY - minY
    };
  }

  /**
   * Point-in-polygon test using ray-casting algorithm.
   * @param {[number, number]} point [px, py]
   * @param {Array<[number, number]>} ring
   * @returns {boolean}
   */
  static isPointInside(point, ring) {
    const [px, py] = point;
    let inside = false;
    const n = ring.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];

      const intersect = ((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  /**
   * Check if ring B is entirely inside ring A.
   * Tests bounding box first, then centroid and representative points.
   * @param {Array<[number, number]>} ringB
   * @param {Array<[number, number]>} ringA
   */
  static isRingInsideRing(ringB, ringA) {
    const bBounds = this.getBounds(ringB);
    const aBounds = this.getBounds(ringA);

    if (bBounds.minX < aBounds.minX || bBounds.maxX > aBounds.maxX ||
        bBounds.minY < aBounds.minY || bBounds.maxY > aBounds.maxY) {
      return false;
    }

    // Test centroid of B
    const centroidB = this.getCentroid(ringB);
    if (!this.isPointInside(centroidB, ringA)) {
      // Test first 3 vertices of B as backup
      let anyInside = false;
      for (let i = 0; i < Math.min(3, ringB.length); i++) {
        if (this.isPointInside(ringB[i], ringA)) {
          anyInside = true;
          break;
        }
      }
      return anyInside;
    }
    return true;
  }

  /**
   * Douglas-Peucker polyline simplification.
   * Keeps sharp architectural corners while eliminating colinear micro-segments.
   * @param {Array<[number, number]>} points
   * @param {number} tolerance (in mm, e.g. 0.05)
   * @returns {Array<[number, number]>}
   */
  static simplify(points, tolerance = 0.05) {
    if (!points || points.length <= 2) return points;

    const sqTolerance = tolerance * tolerance;

    function getSqDistPointToSegment([px, py], [x1, y1], [x2, y2]) {
      let dx = x2 - x1;
      let dy = y2 - y1;
      const lenSq = dx * dx + dy * dy;

      if (lenSq === 0) {
        const dpx = px - x1;
        const dpy = py - y1;
        return dpx * dpx + dpy * dpy;
      }

      let t = ((px - x1) * dx + (py - y1) * dy) / lenSq;
      t = Math.max(0, Math.min(1, t));

      const projX = x1 + t * dx;
      const projY = y1 + t * dy;
      const distSq = (px - projX) * (px - projX) + (py - projY) * (py - projY);
      return distSq;
    }

    function dpRecursive(pts, start, end, kept) {
      let maxDist = 0;
      let index = start;

      for (let i = start + 1; i < end; i++) {
        const dist = getSqDistPointToSegment(pts[i], pts[start], pts[end]);
        if (dist > maxDist) {
          maxDist = dist;
          index = i;
        }
      }

      if (maxDist > sqTolerance) {
        kept[index] = true;
        dpRecursive(pts, start, index, kept);
        dpRecursive(pts, index, end, kept);
      }
    }

    const n = points.length;
    const kept = new Array(n).fill(false);
    kept[0] = true;
    kept[n - 1] = true;

    dpRecursive(points, 0, n - 1, kept);

    const simplified = [];
    for (let i = 0; i < n; i++) {
      if (kept[i]) {
        simplified.push(points[i]);
      }
    }

    return simplified;
  }

  /**
   * Structure layer rings into Outer Islands and their respective Inner Holes.
   * Essential for Three.js ExtrudeGeometry and laser cutting.
   * @param {Array<Array<[number, number]>>} rings
   * @returns {Array<{outer: Array<[number, number]>, holes: Array<Array<[number, number]>>, area: number, bounds: object, centroid: [number, number]}>}
   */
  static groupIslandsAndHoles(rings) {
    if (!rings || rings.length === 0) return [];

    // Filter out tiny noise rings (< 0.1 mm²)
    const validRings = rings
      .map(r => ({ ring: r, area: this.getSignedArea(r), absArea: this.getArea(r) }))
      .filter(item => item.absArea > 0.1);

    if (validRings.length === 0) return [];

    // Separate outer loops from inner holes based on area hierarchy and nesting
    // Sort descending by absolute area so largest encompassing containers come first
    validRings.sort((a, b) => b.absArea - a.absArea);

    const polygons = [];

    for (let i = 0; i < validRings.length; i++) {
      const candidate = validRings[i];
      let parentPolygon = null;

      // Check if candidate is inside any previously identified outer polygon
      for (const poly of polygons) {
        if (this.isRingInsideRing(candidate.ring, poly.outer)) {
          // If it's already inside a hole of parent, it could be an island inside an island
          let insideHole = false;
          for (const hole of poly.holes) {
            if (this.isRingInsideRing(candidate.ring, hole)) {
              insideHole = true;
              break;
            }
          }
          if (!insideHole) {
            parentPolygon = poly;
            break;
          }
        }
      }

      if (parentPolygon) {
        // Candidate is a hole inside parentPolygon
        // Ensure hole has CW winding
        const holeRing = this.ensureWinding(candidate.ring, false);
        parentPolygon.holes.push(holeRing);
      } else {
        // Candidate is an outer island
        // Ensure outer has CCW winding
        const outerRing = this.ensureWinding(candidate.ring, true);
        polygons.push({
          outer: outerRing,
          holes: [],
          area: candidate.absArea,
          bounds: this.getBounds(outerRing),
          centroid: this.getCentroid(outerRing)
        });
      }
    }

    return polygons;
  }
}
