/**
 * Interactive 2D Cut Sheet Preview Canvas
 * Maquette Slicer Studio
 */

export class SheetRenderer {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');

    this.packedResult = null;
    this.currentSheetIndex = 0;

    // View transform
    this.scale = 1.0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.isPanning = false;
    this.startPan = { x: 0, y: 0 };

    this.showGuides = true;
    this.showLabels = true;
    this.showCutLines = true;

    this.setupEvents();
  }

  setupEvents() {
    // Resize observer
    window.addEventListener('resize', () => {
      this.resizeCanvas();
      this.render();
    });

    // Mouse wheel zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const newScale = Math.max(0.2, Math.min(15, this.scale * zoomFactor));

      this.offsetX = mouseX - (mouseX - this.offsetX) * (newScale / this.scale);
      this.offsetY = mouseY - (mouseY - this.offsetY) * (newScale / this.scale);
      this.scale = newScale;

      this.render();
    });

    // Drag to pan
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) { // Left click
        this.isPanning = true;
        this.startPan = { x: e.clientX - this.offsetX, y: e.clientY - this.offsetY };
        this.canvas.style.cursor = 'grabbing';
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        this.offsetX = e.clientX - this.startPan.x;
        this.offsetY = e.clientY - this.startPan.y;
        this.render();
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isPanning) {
        this.isPanning = false;
        this.canvas.style.cursor = 'grab';
      }
    });
  }

  resizeCanvas() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const width = parent.clientWidth || 800;
    const height = parent.clientHeight || 500;

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  /**
   * Set packed sheet data and reset view.
   */
  setData(packedResult, sheetIndex = 0) {
    this.packedResult = packedResult;
    this.currentSheetIndex = Math.min(sheetIndex, (packedResult?.sheets?.length || 1) - 1);
    this.resizeCanvas();
    this.fitToScreen();
    this.render();
  }

  setSheetIndex(index) {
    if (!this.packedResult || !this.packedResult.sheets[index]) return;
    this.currentSheetIndex = index;
    this.render();
  }

  fitToScreen() {
    if (!this.packedResult || !this.packedResult.sheets[this.currentSheetIndex]) return;
    const sheet = this.packedResult.sheets[this.currentSheetIndex];

    const padding = 40;
    const availW = this.canvas.width - padding * 2;
    const availH = this.canvas.height - padding * 2;

    const scaleX = availW / sheet.width;
    const scaleY = availH / sheet.height;
    this.scale = Math.min(scaleX, scaleY, 4.0);

    this.offsetX = (this.canvas.width - sheet.width * this.scale) / 2;
    this.offsetY = (this.canvas.height - sheet.height * this.scale) / 2;
  }

  render() {
    this.resizeCanvas();
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Clear background
    ctx.fillStyle = '#141518';
    ctx.fillRect(0, 0, w, h);

    if (!this.packedResult || !this.packedResult.sheets || this.packedResult.sheets.length === 0) {
      ctx.fillStyle = '#64748b';
      ctx.font = '14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText("Aucune planche générée. Lancez le tranchage pour prévisualiser.", w / 2, h / 2);
      return;
    }

    const sheet = this.packedResult.sheets[this.currentSheetIndex];
    if (!sheet) return;

    ctx.save();
    // Apply camera transform (World mm to Screen px)
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    // 1. Draw Physical Board / Sheet Background
    ctx.fillStyle = '#1f2229'; // Dark architectural cutting mat / plate background
    ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
    ctx.shadowBlur = 25 / this.scale;
    ctx.shadowOffsetY = 6 / this.scale;
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    ctx.shadowColor = 'transparent';

    // Sheet Border & Grid
    ctx.strokeStyle = '#3b4252';
    ctx.lineWidth = 1 / this.scale;
    ctx.strokeRect(0, 0, sheet.width, sheet.height);

    // Usable Area Margin Line (dashed grey)
    ctx.strokeStyle = '#2b303c';
    ctx.setLineDash([4 / this.scale, 4 / this.scale]);
    ctx.strokeRect(sheet.margin, sheet.margin, sheet.width - 2 * sheet.margin, sheet.height - 2 * sheet.margin);
    ctx.setLineDash([]);

    // Grid ticks (every 50mm and 10mm)
    ctx.strokeStyle = '#252932';
    ctx.lineWidth = 0.5 / this.scale;
    for (let x = 50; x < sheet.width; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, sheet.height);
      ctx.stroke();
    }
    for (let y = 50; y < sheet.height; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(sheet.width, y);
      ctx.stroke();
    }

    // 2. Draw Items on Sheet
    for (const item of sheet.items) {
      // (A) Alignment Guides (Pointillés fins bleus : couche N+1 sur couche N)
      if (this.showGuides && item.guides && item.guides.length > 0) {
        ctx.lineWidth = 1.0 / this.scale;
        ctx.setLineDash([4 / this.scale, 3 / this.scale]);

        for (let gIdx = 0; gIdx < item.guides.length; gIdx++) {
          const guide = item.guides[gIdx];
          const gColor = (item.guidesColors && item.guidesColors[gIdx]) || '#3b82f6';
          ctx.strokeStyle = gColor;

          if (guide.outer && guide.outer.length >= 3) {
            ctx.beginPath();
            ctx.moveTo(guide.outer[0][0], guide.outer[0][1]);
            for (let i = 1; i < guide.outer.length; i++) {
              ctx.lineTo(guide.outer[i][0], guide.outer[i][1]);
            }
            ctx.closePath();
            ctx.stroke();
          }

          // Guide holes
          for (const hole of guide.holes) {
            if (hole.length >= 3) {
              ctx.beginPath();
              ctx.moveTo(hole[0][0], hole[0][1]);
              for (let i = 1; i < hole.length; i++) {
                ctx.lineTo(hole[i][0], hole[i][1]);
              }
              ctx.closePath();
              ctx.stroke();
            }
          }
        }
        ctx.setLineDash([]);
      }

      // (B) Outer Cut Lines (Trait continu rouge vif de découpe laser ou couleur personnalisée)
      if (this.showCutLines && item.outer && item.outer.length >= 3) {
        ctx.strokeStyle = item.outerColor || '#ef4444'; // Laser Red or Custom
        ctx.lineWidth = 1.5 / this.scale;

        // Outer perimeter
        ctx.beginPath();
        ctx.moveTo(item.outer[0][0], item.outer[0][1]);
        for (let i = 1; i < item.outer.length; i++) {
          ctx.lineTo(item.outer[i][0], item.outer[i][1]);
        }
        ctx.closePath();
        ctx.stroke();

        // Inner cut holes
        if (item.holes && item.holes.length > 0) {
          for (let hIdx = 0; hIdx < item.holes.length; hIdx++) {
            const hole = item.holes[hIdx];
            if (hole.length >= 3) {
              ctx.strokeStyle = (item.holesColors && item.holesColors[hIdx]) || item.outerColor || '#ef4444';
              ctx.beginPath();
              ctx.moveTo(hole[0][0], hole[0][1]);
              for (let i = 1; i < hole.length; i++) {
                ctx.lineTo(hole[i][0], hole[i][1]);
              }
              ctx.closePath();
              ctx.stroke();
            }
          }
        }
      }

      // (C) Automatic Numbering & Label (Numéro de strate au centre)
      if (this.showLabels && item.centroid) {
        const [cx, cy] = item.centroid;

        // Small crosshair indicator
        ctx.strokeStyle = '#10b981'; // Green engraving/marking
        ctx.lineWidth = 0.8 / this.scale;
        const cross = 2.5;
        ctx.beginPath();
        ctx.moveTo(cx - cross, cy);
        ctx.lineTo(cx + cross, cy);
        ctx.moveTo(cx, cy - cross);
        ctx.lineTo(cx, cy + cross);
        ctx.stroke();

        // Text label
        const fontSize = Math.max(3.5, Math.min(8.0, 5.0));
        ctx.font = `600 ${fontSize}px "JetBrains Mono", monospace`;
        ctx.fillStyle = '#f8fafc';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(item.label, cx, cy - 2.5);

        // Subtitle with elevation
        ctx.font = `400 ${fontSize * 0.65}px "JetBrains Mono", monospace`;
        ctx.fillStyle = '#94a3b8';
        ctx.fillText(`+${item.elevationMm.toFixed(1)}mm`, cx, cy + 5.5);
      }
    }

    ctx.restore();

    // 3. Draw On-Screen Overlays (Scale Ruler and Sheet Info)
    this.renderOverlay(sheet);
  }

  renderOverlay(sheet) {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Top-left sheet indicator
    ctx.fillStyle = 'rgba(14, 15, 17, 0.85)';
    ctx.strokeStyle = '#2b2c32';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(16, 16, 260, 46, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = '600 13px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Planche ${sheet.sheetNumber} / ${this.packedResult.sheets.length}`, 28, 36);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '400 11px "JetBrains Mono", monospace';
    ctx.fillText(`${sheet.width} × ${sheet.height} mm (${sheet.items.length} pièces)`, 28, 52);

    // Bottom-left 2D scale bar
    const barMm = 50; // 50 mm in real scale
    const barPx = barMm * this.scale;
    if (barPx > 20 && barPx < w / 2) {
      const rx = 20;
      const ry = h - 24;

      ctx.fillStyle = 'rgba(14, 15, 17, 0.85)';
      ctx.beginPath();
      ctx.roundRect(rx - 8, ry - 22, barPx + 16, 30, 4);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(rx, ry);
      ctx.lineTo(rx + barPx, ry);
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.font = '500 10px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('50 mm', rx + barPx / 2, ry - 6);
    }
  }
}
