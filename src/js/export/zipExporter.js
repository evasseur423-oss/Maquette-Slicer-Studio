/**
 * Client-Side ZIP Archive Packager for Laser Cut Sheets
 * Maquette Slicer Studio
 *
 * Packages all individual laser cutting sheets (SVG or 1:1 Vector PDF) into
 * a single zip file "maquette_decoupe_laser.zip" with automated client-side download.
 */

import { SvgExporter } from './svgExporter.js';
import { PdfExporter } from './pdfExporter.js';

export class ZipExporter {
  /**
   * Get the JSZip constructor in either Node, Browser, or Electron.
   */
  static getJsZipClass() {
    if (typeof window !== 'undefined' && window.JSZip) {
      return window.JSZip;
    }
    if (typeof window !== 'undefined' && window.require) {
      try {
        const mod = window.require('jszip');
        return mod.default || mod;
      } catch (e) {}
    }
    if (typeof globalThis !== 'undefined' && globalThis.JSZip) {
      return globalThis.JSZip;
    }
    return null;
  }

  /**
   * Package all sheets into a single ZIP archive and trigger download.
   * @param {Object} packedResult - Output from SheetPacker.packLayers
   * @param {Object} [options]
   * @param {'svg'|'pdf'} [options.format='svg'] - Target vector format
   * @param {Object} [options.summary] - Architectural summary metadata
   * @param {string} [options.zipFileName='maquette_decoupe_laser.zip']
   * @param {Function} [options.onProgress] - Callback (progress 0..1, message)
   * @returns {Promise<{ blob: Blob, totalFiles: number, filename: string }>}
   */
  static async exportZip(packedResult, options = {}) {
    if (!packedResult || !packedResult.sheets || packedResult.sheets.length === 0) {
      throw new Error("Aucune planche de découpe disponible à exporter.");
    }

    const {
      format = 'svg',
      summary = {},
      zipFileName = 'maquette_decoupe_laser.zip',
      onProgress = () => {}
    } = options;

    const JSZipClass = this.getJsZipClass();
    if (!JSZipClass) {
      throw new Error("Bibliothèque JSZip non disponible.");
    }

    const zip = new JSZipClass();
    const sheets = packedResult.sheets;
    const totalSheets = sheets.length;

    onProgress(0.05, `Initialisation de l'archive (${totalSheets} planches)...`);

    // 1. Generate each individual sheet
    for (let sIdx = 0; sIdx < totalSheets; sIdx++) {
      const sheet = sheets[sIdx];
      const sheetNum = String(sIdx + 1).padStart(2, '0');
      const filename = `planche_${sheetNum}.${format}`;

      const progressRatio = 0.05 + ((sIdx + 1) / totalSheets) * 0.45;
      onProgress(progressRatio, `Génération de la planche ${sIdx + 1}/${totalSheets} (${format.toUpperCase()})...`);

      if (format === 'pdf') {
        const pdfBytes = PdfExporter.generateSingleSheetPDF(sheet, {
          totalSheets: totalSheets
        });
        zip.file(filename, pdfBytes, { binary: true });
      } else {
        // SVG
        const svgContent = SvgExporter.generateSingleSheetSVG(packedResult, sIdx);
        zip.file(filename, svgContent);
      }

      // Small async tick to keep UI responsive
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // 2. Add Manufacturing & Assembly Guide (README)
    const dateStr = new Date().toLocaleString('fr-FR');
    const scaleStr = summary.scaleRatio || (summary.scale ? `1:${summary.scale}` : '1:200');
    const thickStr = summary.materialThicknessMm ? `${summary.materialThicknessMm} mm` : '1.5 mm';
    const totalLayersStr = summary.totalLayers || packedResult.totalPieces || 'N/A';
    const bedStr = `${packedResult.sheetWidth} × ${packedResult.sheetHeight} mm`;

    const readmeContent = [
      `========================================================================`,
      ` MAQUETTE SLICER STUDIO - DOSSIER DE DÉCOUPE LASER ARCHITECTURALE`,
      `========================================================================`,
      `Date de génération      : ${dateStr}`,
      `Format des fichiers     : ${format.toUpperCase()} Vectoriel (Échelle 1:1)`,
      `Nombre de planches      : ${totalSheets} plateau(x)`,
      `Format du plateau laser : ${bedStr}`,
      `Échelle physique        : ${scaleStr}`,
      `Épaisseur de matériau   : ${thickStr}`,
      `Nombre total de strates : ${totalLayersStr}`,
      ``,
      `CONVENTIONS DE COULEURS POUR LE PILOTAGE LASER :`,
      `------------------------------------------------------------------------`,
      `1. ROUGE (#FF0000 / RGB 255, 0, 0) - DÉCOUPE TRAVERSANTE (CUT)`,
      `   * Tracé : Lignes continues 0.1 mm`,
      `   * Action : Découpe laser à 100% de pénétration`,
      `   * Contours extérieurs des strates et réservations / trous intérieurs.`,
      ``,
      `2. BLEU (#0066FF / RGB 0, 102, 255) - GRAVURE SUPERFICIELLE / REPAIR (ENGRAVE)`,
      `   * Tracé : Lignes pointillées ou traits fins 0.1 mm`,
      `   * Action : Gravure vectorielle à faible puissance (marquage sans couper)`,
      `   * Repères de positionnement de la couche suivante (N+1 sur N)`,
      `   * Numéro de strate (#01, #02, etc.) et réticule central de pointage.`,
      ``,
      `3. GRIS (#888888) - BORDURE DE CALAGE PLATEAU`,
      `   * Délimite la zone utile du lit de la machine laser.`,
      `========================================================================`,
      `Fichiers inclus dans cette archive :`,
      ...sheets.map((s, idx) => `  - planche_${String(idx + 1).padStart(2, '0')}.${format} (${s.items.length} pièces imbriquées)`),
      `========================================================================`
    ].join('\r\n');

    zip.file('NOTICE_FABRICATION_LASER.txt', readmeContent);

    // 3. Compress ZIP archive with progress tracking
    onProgress(0.55, "Compression de l'archive ZIP...");

    const zipBlob = await zip.generateAsync(
      {
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      },
      (metadata) => {
        const pct = Math.round(metadata.percent);
        const ratio = 0.55 + (metadata.percent / 100) * 0.45;
        onProgress(ratio, `Compression de l'archive ZIP (${pct}%)...`);
      }
    );

    onProgress(1.0, "Archive prête, démarrage du téléchargement !");

    // 4. Trigger client-side download without page reload
    this.triggerDownload(zipBlob, zipFileName);

    return {
      blob: zipBlob,
      totalFiles: totalSheets + 1,
      filename: zipFileName
    };
  }

  /**
   * Trigger automatic file download in browser or Electron without reloading page.
   * @param {Blob} blob
   * @param {string} filename
   */
  static triggerDownload(blob, filename) {
    if (typeof window === 'undefined') return;

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 2000);
  }
}
