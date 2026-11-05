/**
 * Architectural Laser Sheet Bin-Packing Engine
 * Maquette Slicer Studio
 */

import { PolygonUtils } from '../geometry/polygon.js';

export class SheetPacker {
  /**
   * Predefined standard architectural sheet formats (in mm)
   */
  static FORMATS = {
    'LASER_600x400': { name: 'Plateau Laser 600 × 400 mm (Standard)', width: 600, height: 400 },
    'LASER_900x600': { name: 'Plateau Laser 900 × 600 mm (Grand format)', width: 900, height: 600 },
    'LASER_1200x900': { name: 'Plateau Laser 1200 × 900 mm (Atelier Pro)', width: 1200, height: 900 },
    'A3': { name: 'Feuille A3 (420 × 297 mm)', width: 420, height: 297 },
    'A2': { name: 'Feuille A2 (594 × 420 mm)', width: 594, height: 420 },
    'A4': { name: 'Feuille A4 (297 × 210 mm)', width: 297, height: 210 },
    'CUSTOM': { name: 'Format Laser Sur Mesure', width: 600, height: 400 }
  };

  /**
   * Pack all sliced strata pieces onto one or multiple physical sheets.
   * @param {Array<Object>} layers - Sliced layers from SlicerEngine
   * @param {Object} options
   * @param {number} options.sheetWidth - Sheet width in mm
   * @param {number} options.sheetHeight - Sheet height in mm
   * @param {number} [options.margin=8] - Margin from sheet edges in mm
   * @param {number} [options.spacing=5] - Spacing between pieces in mm
   * @returns {Object} { sheets: Array, totalSheets: number, unplacedCount: number }
   */
  static packLayers(layers, options = {}) {
    const sheetWidth = options.sheetWidth || 420;
    const sheetHeight = options.sheetHeight || 297;
    const margin = options.margin !== undefined ? options.margin : 8;
    const spacing = options.spacing !== undefined ? options.spacing : 5;

    // Collect all individual cuttable pieces from layers
    // Usually 1 polygon per layer, or multiple if terrain has disconnected islands
    const items = [];

    for (const layer of layers) {
      for (let polyIdx = 0; polyIdx < layer.polygons.length; polyIdx++) {
        const poly = layer.polygons[polyIdx];
        if (!poly.outer || poly.outer.length < 3) continue;

        const bounds = poly.bounds || PolygonUtils.getBounds(poly.outer);
        const centroid = poly.centroid || PolygonUtils.getCentroid(poly.outer);

        // Normalize polygon coordinates relative to its bounding box min (0, 0)
        const localOuter = poly.outer.map(([x, z]) => [x - bounds.minX, z - bounds.minY]);
        const localHoles = poly.holes.map(hole =>
          hole.map(([x, z]) => [x - bounds.minX, z - bounds.minY])
        );

        // Map alignment guides for this piece (if any)
        const localGuides = [];
        if (layer.guidePolygons && layer.guidePolygons.length > 0) {
          for (const guide of layer.guidePolygons) {
            if (guide.outer && guide.outer.length >= 3) {
              localGuides.push({
                outer: guide.outer.map(([x, z]) => [x - bounds.minX, z - bounds.minY]),
                holes: guide.holes.map(h => h.map(([x, z]) => [x - bounds.minX, z - bounds.minY]))
              });
            }
          }
        }

        const localCentroid = [centroid[0] - bounds.minX, centroid[1] - bounds.minY];

        items.push({
          id: `L${layer.number}_P${polyIdx + 1}`,
          layerNumber: layer.number,
          layerIndex: layer.index,
          elevationMm: layer.elevationMm,
          realElevationM: layer.realElevationM,
          width: bounds.width,
          height: bounds.height,
          outer: localOuter,
          holes: localHoles,
          guides: localGuides,
          centroid: localCentroid,
          area: poly.area,
          rotated: false
        });
      }
    }

    // Sort items descending by height, then width (Best-Fit Decreasing Shelf)
    items.sort((a, b) => (b.height * b.width) - (a.height * a.width));

    const usableW = sheetWidth - 2 * margin;
    const usableH = sheetHeight - 2 * margin;

    const sheets = [];
    let currentSheet = {
      sheetIndex: 0,
      sheetNumber: 1,
      width: sheetWidth,
      height: sheetHeight,
      margin: margin,
      items: []
    };
    sheets.push(currentSheet);

    // Shelf packing state on current sheet
    let currentShelfX = margin;
    let currentShelfY = margin;
    let currentShelfHeight = 0;

    for (const item of items) {
      let w = item.width;
      let h = item.height;
      let rotated = false;

      // Check if rotating 90 degrees fits better
      if ((w > usableW || (h > usableH && w <= usableH)) && (h <= usableW && w <= usableH)) {
        rotated = true;
        const temp = w;
        w = h;
        h = temp;
      }

      // Check if piece fits on current shelf
      if (currentShelfX + w > sheetWidth - margin) {
        // Start a new shelf vertically
        currentShelfX = margin;
        currentShelfY += currentShelfHeight + spacing;
        currentShelfHeight = 0;
      }

      // Check if new shelf exceeds current sheet height
      if (currentShelfY + h > sheetHeight - margin) {
        // Start a brand new sheet!
        currentSheet = {
          sheetIndex: sheets.length,
          sheetNumber: sheets.length + 1,
          width: sheetWidth,
          height: sheetHeight,
          margin: margin,
          items: []
        };
        sheets.push(currentSheet);

        currentShelfX = margin;
        currentShelfY = margin;
        currentShelfHeight = 0;
      }

      // Place item at (currentShelfX, currentShelfY)
      const placedOuter = [];
      const placedHoles = [];
      const placedGuides = [];
      let placedCentroid = [0, 0];

      if (rotated) {
        // Rotate 90 degrees: [x, y] -> [y, item.width - x]
        for (const [px, py] of item.outer) {
          placedOuter.push([currentShelfX + py, currentShelfY + (item.width - px)]);
        }
        for (const hole of item.holes) {
          placedHoles.push(hole.map(([px, py]) => [currentShelfX + py, currentShelfY + (item.width - px)]));
        }
        for (const guide of item.guides) {
          placedGuides.push({
            outer: guide.outer.map(([px, py]) => [currentShelfX + py, currentShelfY + (item.width - px)]),
            holes: guide.holes.map(h => h.map(([px, py]) => [currentShelfX + py, currentShelfY + (item.width - px)]))
          });
        }
        placedCentroid = [
          currentShelfX + item.centroid[1],
          currentShelfY + (item.width - item.centroid[0])
        ];
      } else {
        // Standard placement
        for (const [px, py] of item.outer) {
          placedOuter.push([currentShelfX + px, currentShelfY + py]);
        }
        for (const hole of item.holes) {
          placedHoles.push(hole.map(([px, py]) => [currentShelfX + px, currentShelfY + py]));
        }
        for (const guide of item.guides) {
          placedGuides.push({
            outer: guide.outer.map(([px, py]) => [currentShelfX + px, currentShelfY + py]),
            holes: guide.holes.map(h => h.map(([px, py]) => [currentShelfX + px, currentShelfY + py]))
          });
        }
        placedCentroid = [
          currentShelfX + item.centroid[0],
          currentShelfY + item.centroid[1]
        ];
      }

      currentSheet.items.push({
        id: item.id,
        layerNumber: item.layerNumber,
        layerIndex: item.layerIndex,
        label: `#${String(item.layerNumber).padStart(2, '0')}`,
        elevationMm: item.elevationMm,
        realElevationM: item.realElevationM,
        outer: placedOuter,
        holes: placedHoles,
        guides: placedGuides,
        centroid: placedCentroid,
        x: currentShelfX,
        y: currentShelfY,
        width: w,
        height: h,
        rotated: rotated
      });

      // Advance shelf
      currentShelfX += w + spacing;
      if (h > currentShelfHeight) {
        currentShelfHeight = h;
      }
    }

    // Compute material utilization statistics
    let totalPieceAreaMm2 = 0;
    for (const sheet of sheets) {
      for (const it of sheet.items) {
        totalPieceAreaMm2 += (it.area || (it.width * it.height * 0.75));
      }
    }

    const totalSheetAreaMm2 = sheets.length * sheetWidth * sheetHeight;
    const materialYieldPercent = totalSheetAreaMm2 > 0
      ? Math.min(100, (totalPieceAreaMm2 / totalSheetAreaMm2) * 100)
      : 0;

    return {
      sheets,
      totalSheets: sheets.length,
      sheetWidth,
      sheetHeight,
      totalPieces: items.length,
      totalPieceAreaCm2: totalPieceAreaMm2 / 100,
      totalSheetAreaCm2: totalSheetAreaMm2 / 100,
      materialYieldPercent: Math.round(materialYieldPercent),
      wastePercent: Math.round(100 - materialYieldPercent)
    };
  }
}

