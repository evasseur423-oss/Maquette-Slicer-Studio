/**
 * Production-Ready Vector PDF Exporter for Laser Cutters and CAD
 * Maquette Slicer Studio
 *
 * Generates 1:1 scale, unpixelated vector PDF documents matching laser bed dimensions.
 * Strict fabrication standards:
 * - Red (#ff0000, 0.1mm): Through cut lines
 * - Blue (#0066ff, 0.1mm, dashed): Alignment guides & layer number engraving
 * - Gray (#888888, 0.2mm): Sheet border reference
 */

export class PdfExporter {
  /**
   * Get the jsPDF constructor in either Node, Browser, or Electron.
   */
  static getJsPdfClass() {
    if (typeof window !== 'undefined' && window.jspdf && window.jspdf.jsPDF) {
      return window.jspdf.jsPDF;
    }
    if (typeof window !== 'undefined' && window.require) {
      try {
        const mod = window.require('jspdf');
        return mod.jsPDF || mod.default || mod;
      } catch (e) {}
    }
    if (typeof globalThis !== 'undefined' && globalThis.jspdf && globalThis.jspdf.jsPDF) {
      return globalThis.jspdf.jsPDF;
    }
    return null;
  }

  /**
   * Generate a standalone 1:1 vector PDF document for a single laser sheet.
   * @param {Object} sheet - Sheet object from SheetPacker.packLayers
   * @param {Object} [options]
   * @param {number} [options.totalSheets=1]
   * @param {string} [options.cutColor='red']
   * @param {string} [options.guideColor='blue']
   * @returns {Uint8Array} Binary PDF bytes
   */
  static generateSingleSheetPDF(sheet, options = {}) {
    const JsPDF = this.getJsPdfClass();
    if (!JsPDF) {
      throw new Error("Bibliothèque jsPDF non chargée.");
    }

    const {
      totalSheets = 1,
      cutRgb = [255, 0, 0],       // Pure Red for cutting
      guideRgb = [0, 102, 255],   // Pure Blue for alignment guides
      labelRgb = [0, 102, 255],   // Pure Blue for engraving numbers
      borderRgb = [136, 136, 136] // Gray for bed border
    } = options;

    const sheetW = sheet.width || 600;
    const sheetH = sheet.height || 400;
    const isLandscape = sheetW >= sheetH;

    // Create 1:1 scale document matching exact laser bed dimensions
    const doc = new JsPDF({
      orientation: isLandscape ? 'landscape' : 'portrait',
      unit: 'mm',
      format: [Math.min(sheetW, sheetH), Math.max(sheetW, sheetH)],
      compress: true,
      putOnlyUsedFonts: true
    });

    // 1. Bed Border Reference & Header (Gray)
    doc.setDrawColor(borderRgb[0], borderRgb[1], borderRgb[2]);
    doc.setLineWidth(0.2);
    doc.rect(0, 0, sheetW, sheetH, 'S');

    doc.setTextColor(borderRgb[0], borderRgb[1], borderRgb[2]);
    doc.setFontSize(7);
    doc.text(
      `PLANCHE ${sheet.sheetNumber || 1}/${totalSheets} - ${sheetW}×${sheetH} mm - MAQUETTE SLICER STUDIO`,
      8,
      6
    );

    // 2. Alignment Guides Layer (Blue Dashed Lines)
    doc.setLineWidth(0.1);
    doc.setLineDashPattern([2, 2], 0);

    for (const item of sheet.items) {
      if (item.guides && item.guides.length > 0) {
        for (let gIdx = 0; gIdx < item.guides.length; gIdx++) {
          const guide = item.guides[gIdx];
          const gRgb = this.colorToRgb((item.guidesColors && item.guidesColors[gIdx]), guideRgb);
          doc.setDrawColor(gRgb[0], gRgb[1], gRgb[2]);

          if (guide.outer && guide.outer.length >= 3) {
            this.drawVectorRing(doc, guide.outer);
          }
          if (guide.holes && guide.holes.length > 0) {
            for (const hole of guide.holes) {
              if (hole.length >= 3) {
                this.drawVectorRing(doc, hole);
              }
            }
          }
        }
      }
    }

    // Reset line dash pattern for solid lines
    doc.setLineDashPattern([], 0);

    // 3. Layer Numbers & Centering Crosshairs (Blue Engraving)
    doc.setDrawColor(labelRgb[0], labelRgb[1], labelRgb[2]);
    doc.setTextColor(labelRgb[0], labelRgb[1], labelRgb[2]);
    doc.setLineWidth(0.1);

    for (const item of sheet.items) {
      if (item.centroid) {
        const [cx, cy] = item.centroid;

        // Centering crosshair (4mm cross)
        doc.line(cx - 2, cy, cx + 2, cy);
        doc.line(cx, cy - 2, cx, cy + 2);

        // Stratum label
        doc.setFontSize(9);
        doc.text(String(item.label || `#${item.layerIndex + 1}`), cx, cy - 1.5, { align: 'center' });

        // Elevation tag
        doc.setFontSize(6);
        const elevText = item.elevationMm !== undefined ? `+${item.elevationMm.toFixed(1)}mm` : '';
        if (elevText) {
          doc.text(elevText, cx, cy + 4.0, { align: 'center' });
        }
      }
    }

    // 4. Cut Lines Layer (Continuous Red 0.1mm Stroke or Custom Laser Color)
    doc.setLineWidth(0.1);

    for (const item of sheet.items) {
      const outerRgb = this.colorToRgb(item.outerColor, cutRgb);
      doc.setDrawColor(outerRgb[0], outerRgb[1], outerRgb[2]);
      if (item.outerColor && item.outerColor.toLowerCase() === '#0000ff') {
        doc.setLineDashPattern([2, 2], 0);
      } else {
        doc.setLineDashPattern([], 0);
      }

      if (item.outer && item.outer.length >= 3) {
        this.drawVectorRing(doc, item.outer);
      }
      if (item.holes && item.holes.length > 0) {
        for (let hIdx = 0; hIdx < item.holes.length; hIdx++) {
          const hole = item.holes[hIdx];
          if (hole.length >= 3) {
            const holeRgb = this.colorToRgb((item.holesColors && item.holesColors[hIdx]) || item.outerColor, cutRgb);
            doc.setDrawColor(holeRgb[0], holeRgb[1], holeRgb[2]);
            this.drawVectorRing(doc, hole);
          }
        }
      }
    }
    doc.setLineDashPattern([], 0);

    // Return binary ArrayBuffer / Uint8Array
    const buffer = doc.output('arraybuffer');
    return new Uint8Array(buffer);
  }

  /**
   * Draw a closed vector polygon ring into jsPDF using native PDF vector operators.
   * @param {jsPDF} doc
   * @param {Array<[number, number]>} points
   */
  static drawVectorRing(doc, points) {
    if (!points || points.length < 2) return;

    if (typeof doc.path === 'function') {
      const ops = [];
      ops.push({ op: 'm', c: [points[0][0], points[0][1]] });
      for (let i = 1; i < points.length; i++) {
        ops.push({ op: 'l', c: [points[i][0], points[i][1]] });
      }
      ops.push({ op: 'h', c: [] });
      doc.path(ops);
      doc.stroke();
    } else {
      // Fallback to sequential lines if path() is not present
      for (let i = 0; i < points.length; i++) {
        const next = (i + 1) % points.length;
        doc.line(points[i][0], points[i][1], points[next][0], points[next][1]);
      }
    }
  }

  /**
   * Convert hex color string to RGB array [r, g, b].
   * @param {string} color
   * @param {Array<number>} defaultRgb
   * @returns {Array<number>}
   */
  static colorToRgb(color, defaultRgb = [255, 0, 0]) {
    if (!color || typeof color !== 'string') return defaultRgb;
    const hex = color.trim().replace(/^#/, '');
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16)
      ];
    } else if (hex.length >= 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16)
      ];
    }
    return defaultRgb;
  }
}

