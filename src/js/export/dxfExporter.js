/**
 * Professional AutoCAD DXF (R12 ASCII) Exporter for Laser Cutters and CAD
 * Maquette Slicer Studio
 */

export class DxfExporter {
  /**
   * Export cut sheets to standardized AutoCAD DXF format.
   * Compatible with AutoCAD, Rhino 3D, Illustrator, LightBurn, RDWorks, etc.
   * @param {Object} packedResult - Output from SheetPacker.packLayers
   * @param {Object} [options]
   * @param {number} [options.singleSheetIndex=-1] - If >= 0, export single sheet; otherwise all side-by-side
   * @returns {string} Standard ASCII DXF
   */
  static generateDXF(packedResult, options = {}) {
    if (!packedResult || !packedResult.sheets || packedResult.sheets.length === 0) {
      throw new Error("Aucune planche à exporter.");
    }

    const { singleSheetIndex = -1 } = options;
    const sheetsToExport = singleSheetIndex >= 0
      ? [packedResult.sheets[singleSheetIndex]]
      : packedResult.sheets;

    const sheetSpacing = 40; // 40 mm between sheets
    const sheetW = packedResult.sheetWidth;
    const sheetH = packedResult.sheetHeight;

    let dxf = '';

    // 1. HEADER SECTION
    dxf += '0\nSECTION\n2\nHEADER\n';
    dxf += '9\n$ACADVER\n1\nAC1009\n'; // AutoCAD R12 standard (universal compatibility)
    dxf += '9\n$INSUNITS\n70\n4\n';   // 4 = Millimeters
    dxf += '0\nENDSEC\n';

    // 2. TABLES SECTION (Linetypes and Layers)
    dxf += '0\nSECTION\n2\nTABLES\n';

    // Linetype Table
    dxf += '0\nTABLE\n2\nLTYPE\n70\n2\n';
    // Continuous
    dxf += '0\nLTYPE\n2\nCONTINUOUS\n70\n0\n3\nSolid line\n72\n65\n73\n0\n40\n0.0\n';
    // Dashed
    dxf += '0\nLTYPE\n2\nDASHED\n70\n0\n3\nDashed line __ __ __\n72\n65\n73\n2\n40\n4.0\n49\n2.5\n49\n-1.5\n';
    dxf += '0\nENDTAB\n';

    // Layer Table
    dxf += '0\nTABLE\n2\nLAYER\n70\n4\n';
    // Layer 0
    dxf += '0\nLAYER\n2\n0\n70\n0\n62\n7\n6\nCONTINUOUS\n';
    // Layer CUT (Color 1 = Red)
    dxf += '0\nLAYER\n2\nCUT\n70\n0\n62\n1\n6\nCONTINUOUS\n';
    // Layer GUIDE (Color 5 = Blue, Linetype DASHED)
    dxf += '0\nLAYER\n2\nGUIDE\n70\n0\n62\n5\n6\nDASHED\n';
    // Layer LABEL (Color 5 = Blue for laser engraving)
    dxf += '0\nLAYER\n2\nLABEL\n70\n0\n62\n5\n6\nCONTINUOUS\n';
    // Layer FRAME (Color 8 = Dark Grey)
    dxf += '0\nLAYER\n2\nFRAME\n70\n0\n62\n8\n6\nCONTINUOUS\n';
    dxf += '0\nENDTAB\n';

    dxf += '0\nENDSEC\n';

    // 3. ENTITIES SECTION
    dxf += '0\nSECTION\n2\nENTITIES\n';

    for (let sIdx = 0; sIdx < sheetsToExport.length; sIdx++) {
      const sheet = sheetsToExport[sIdx];
      const sheetOffsetX = sIdx * (sheetW + sheetSpacing);

      // (A) Sheet Outer Frame
      this.writeClosedPolyline(
        [
          [sheetOffsetX, 0],
          [sheetOffsetX + sheet.width, 0],
          [sheetOffsetX + sheet.width, sheet.height],
          [sheetOffsetX, sheet.height]
        ],
        'FRAME',
        dxfChunk => { dxf += dxfChunk; }
      );

      // Sheet title text at bottom left
      this.writeText(
        sheetOffsetX + 10,
        -8,
        3.5,
        `PLANCHE ${sheet.sheetNumber}/${sheetsToExport.length} - ${sheet.width}x${sheet.height}mm`,
        'FRAME',
        dxfChunk => { dxf += dxfChunk; }
      );

      // (B) Draw Pieces on Sheet
      for (const item of sheet.items) {
        // CAD coordinates: invert Y so origin is bottom-left
        const toCad = ([px, py]) => [
          sheetOffsetX + px,
          sheet.height - py
        ];

        // 1. ALIGNMENT GUIDES (Layer: GUIDE, Color: Blue, Dashed)
        if (item.guides && item.guides.length > 0) {
          for (const guide of item.guides) {
            if (guide.outer && guide.outer.length >= 3) {
              const cadOuter = guide.outer.map(toCad);
              this.writeClosedPolyline(cadOuter, 'GUIDE', c => { dxf += c; });
            }
            for (const hole of guide.holes) {
              if (hole.length >= 3) {
                const cadHole = hole.map(toCad);
                this.writeClosedPolyline(cadHole, 'GUIDE', c => { dxf += c; });
              }
            }
          }
        }

        // 2. CUT LINES (Layer: CUT, Color: Red, Continuous)
        if (item.outer && item.outer.length >= 3) {
          const cadOuter = item.outer.map(toCad);
          this.writeClosedPolyline(cadOuter, 'CUT', c => { dxf += c; });
        }
        for (const hole of item.holes) {
          if (hole.length >= 3) {
            const cadHole = hole.map(toCad);
            this.writeClosedPolyline(cadHole, 'CUT', c => { dxf += c; });
          }
        }

        // 3. LABELS & NUMBERING (Layer: LABEL, Color: Green)
        if (item.centroid) {
          const [cx, cy] = toCad(item.centroid);
          // Label text
          this.writeText(cx, cy - 1.5, 3.5, item.label, 'LABEL', c => { dxf += c; });
          this.writeText(cx, cy - 4.5, 2.0, `+${item.elevationMm.toFixed(1)}mm`, 'LABEL', c => { dxf += c; });

          // Crosshair point
          this.writeLine(cx - 2, cy, cx + 2, cy, 'LABEL', c => { dxf += c; });
          this.writeLine(cx, cy - 2, cx, cy + 2, 'LABEL', c => { dxf += c; });
        }
      }
    }

    dxf += '0\nENDSEC\n';

    // 4. END OF FILE
    dxf += '0\nEOF\n';
    return dxf;
  }

  static writeClosedPolyline(points, layerName, append) {
    if (!points || points.length < 2) return;

    let chunk = '0\nPOLYLINE\n';
    chunk += `8\n${layerName}\n`;
    chunk += '66\n1\n'; // Entities follow flag
    chunk += '70\n1\n'; // 1 = Closed polyline
    append(chunk);

    for (let i = 0; i < points.length; i++) {
      let v = '0\nVERTEX\n';
      v += `8\n${layerName}\n`;
      v += `10\n${points[i][0].toFixed(3)}\n`;
      v += `20\n${points[i][1].toFixed(3)}\n`;
      v += '30\n0.0\n';
      append(v);
    }

    append('0\nSEQEND\n');
  }

  static writeLine(x1, y1, x2, y2, layerName, append) {
    let chunk = '0\nLINE\n';
    chunk += `8\n${layerName}\n`;
    chunk += `10\n${x1.toFixed(3)}\n`;
    chunk += `20\n${y1.toFixed(3)}\n`;
    chunk += '30\n0.0\n';
    chunk += `11\n${x2.toFixed(3)}\n`;
    chunk += `20\n${y2.toFixed(3)}\n`;
    chunk += '31\n0.0\n';
    append(chunk);
  }

  static writeText(x, y, height, textStr, layerName, append) {
    let chunk = '0\nTEXT\n';
    chunk += `8\n${layerName}\n`;
    chunk += `10\n${x.toFixed(3)}\n`;
    chunk += `20\n${y.toFixed(3)}\n`;
    chunk += '30\n0.0\n';
    chunk += `40\n${height.toFixed(2)}\n`;
    chunk += `1\n${textStr}\n`;
    chunk += '72\n1\n'; // Horizontal alignment: 1 = Centered
    chunk += `11\n${x.toFixed(3)}\n`;
    chunk += `21\n${y.toFixed(3)}\n`;
    chunk += '31\n0.0\n';
    append(chunk);
  }
}
