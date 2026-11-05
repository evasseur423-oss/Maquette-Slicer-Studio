/**
 * Interactive 2D Laser Cut Sheet Editor (Nodal CAD Workspace)
 * Maquette Slicer Studio
 *
 * Dedicated full-fidelity 2D vector editor for laser cutting sheets:
 * - Nodal editing (drag vertices, dynamic segment adaptation)
 * - Node insertion (double-click, Alt+click, or tool) and deletion (Right-click or Delete key)
 * - Laser convention line coloring (Cut #FF0000, Engrave #0000FF, Mark #000000)
 * - Undo / Redo history management (Ctrl+Z / Ctrl+Y)
 * - Pan & Zoom navigation (mouse wheel, middle click, space + drag)
 * - Validation & Reset without recalculating the 3D terrain/model
 */

export class SheetEditor {
  /**
   * @param {Object} options
   * @param {HTMLCanvasElement} options.canvas
   * @param {HTMLElement} [options.container]
   * @param {Function} [options.onSave]
   * @param {Function} [options.onClose]
   * @param {Function} [options.onToast]
   */
  constructor(options = {}) {
    this.canvas = options.canvas;
    this.ctx = this.canvas.getContext('2d');
    this.container = options.container || this.canvas.parentElement;
    this.onSave = options.onSave || (() => {});
    this.onClose = options.onClose || (() => {});
    this.onToast = options.onToast || (() => {});

    // Active sheet data
    this.sheet = null;
    this.sheetIndex = 0;
    this.totalSheets = 1;
    this.originalItemsSnapshot = null;

    // View transform
    this.scale = 1.0;
    this.offsetX = 0;
    this.offsetY = 0;
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };
    this.isSpacePressed = false;

    // Editable paths derived from sheet items
    this.paths = [];

    // Interaction state
    this.activeTool = 'node'; // 'node' | 'add-node' | 'pan'
    this.activeColor = '#ff0000'; // '#ff0000' (Cut) | '#0000ff' (Engrave) | '#000000' (Mark)
    this.selectedPath = null;
    this.selectedNode = null; // { path, vertexIndex }
    this.hoveredNode = null; // { path, vertexIndex }
    this.hoveredSegment = null; // { path, segmentIndex, projPoint: [x,y] }
    this.draggedNode = null; // { path, vertexIndex, startPos: [x, y] }

    // History (Undo / Redo stacks)
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = 50;

    // Mouse world pos
    this.mouseWorld = [0, 0];

    this.setupEvents();
  }

  setupEvents() {
    if (typeof window === 'undefined' || !this.canvas) return;

    // Resize observer
    window.addEventListener('resize', () => {
      if (this.isOpen()) {
        this.resizeCanvas();
        this.render();
      }
    });

    // Mouse wheel zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
      const newScale = Math.max(0.2, Math.min(25, this.scale * zoomFactor));

      this.offsetX = mouseX - (mouseX - this.offsetX) * (newScale / this.scale);
      this.offsetY = mouseY - (mouseY - this.offsetY) * (newScale / this.scale);
      this.scale = newScale;

      this.render();
    }, { passive: false });

    // Mouse down
    this.canvas.addEventListener('mousedown', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const [wx, wy] = this.screenToWorld(sx, sy);

      // 1. Pan with Middle click (button 1) OR Space + Left click OR Pan tool
      if (e.button === 1 || (e.button === 0 && (this.isSpacePressed || this.activeTool === 'pan'))) {
        this.isPanning = true;
        this.panStart = { x: e.clientX - this.offsetX, y: e.clientY - this.offsetY };
        this.canvas.style.cursor = 'grabbing';
        return;
      }

      // 2. Right click on a node: Delete vertex
      if (e.button === 2) {
        e.preventDefault();
        const hitNode = this.findNodeAtScreen(sx, sy);
        if (hitNode) {
          this.deleteVertex(hitNode.path, hitNode.vertexIndex);
        }
        return;
      }

      // 3. Left click actions
      if (e.button === 0) {
        // (A) Check if clicking on an existing node
        const hitNode = this.findNodeAtScreen(sx, sy);
        if (hitNode) {
          this.pushHistory();
          this.selectedPath = hitNode.path;
          this.selectedNode = { path: hitNode.path, vertexIndex: hitNode.vertexIndex };
          this.draggedNode = {
            path: hitNode.path,
            vertexIndex: hitNode.vertexIndex,
            startPos: [...hitNode.path.points[hitNode.vertexIndex]]
          };
          this.render();
          this.updateHUD();
          return;
        }

        // (B) Check if clicking on a segment with Insert Tool or Alt key
        if (this.activeTool === 'add-node' || e.altKey) {
          const hitSeg = this.findSegmentAtScreen(sx, sy);
          if (hitSeg) {
            this.pushHistory();
            this.insertVertex(hitSeg.path, hitSeg.segmentIndex, hitSeg.projPoint);
            return;
          }
        }

        // (C) Check if selecting a path/contour
        const hitPath = this.findPathAtScreen(sx, sy);
        if (hitPath) {
          this.selectedPath = hitPath;
          this.selectedNode = null;
          this.render();
          this.updateHUD();
          return;
        }

        // (D) Clicked empty background: clear selection or start pan
        this.selectedPath = null;
        this.selectedNode = null;
        this.isPanning = true;
        this.panStart = { x: e.clientX - this.offsetX, y: e.clientY - this.offsetY };
        this.canvas.style.cursor = 'grabbing';
        this.render();
        this.updateHUD();
      }
    });

    // Double-click: Insert node on segment
    this.canvas.addEventListener('dblclick', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const hitSeg = this.findSegmentAtScreen(sx, sy);
      if (hitSeg) {
        this.pushHistory();
        this.insertVertex(hitSeg.path, hitSeg.segmentIndex, hitSeg.projPoint);
      }
    });

    // Prevent default context menu on right click inside canvas
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
    });

    // Window Mouse Move
    window.addEventListener('mousemove', (e) => {
      if (!this.isOpen()) return;

      const rect = this.canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const [wx, wy] = this.screenToWorld(sx, sy);
      this.mouseWorld = [wx, wy];

      if (this.isPanning) {
        this.offsetX = e.clientX - this.panStart.x;
        this.offsetY = e.clientY - this.panStart.y;
        this.render();
        this.updateCoordsHUD(wx, wy);
        return;
      }

      if (this.draggedNode) {
        // Dragging active node in real time
        const points = this.draggedNode.path.points;
        const vIdx = this.draggedNode.vertexIndex;

        // Keep inside sheet bounds with small margin
        const boundedX = Math.max(0, Math.min(this.sheet.width, wx));
        const boundedY = Math.max(0, Math.min(this.sheet.height, wy));

        points[vIdx][0] = parseFloat(boundedX.toFixed(2));
        points[vIdx][1] = parseFloat(boundedY.toFixed(2));

        this.render();
        this.updateCoordsHUD(boundedX, boundedY);
        return;
      }

      // Hover detection
      let needRender = false;

      const hitNode = this.findNodeAtScreen(sx, sy);
      if (hitNode !== this.hoveredNode) {
        this.hoveredNode = hitNode;
        needRender = true;
      }

      if (!this.hoveredNode) {
        const hitSeg = this.findSegmentAtScreen(sx, sy);
        if (hitSeg !== this.hoveredSegment) {
          this.hoveredSegment = hitSeg;
          needRender = true;
        }
      } else {
        if (this.hoveredSegment) {
          this.hoveredSegment = null;
          needRender = true;
        }
      }

      // Cursor styling
      if (this.activeTool === 'pan' || this.isSpacePressed) {
        this.canvas.style.cursor = 'grab';
      } else if (this.hoveredNode) {
        this.canvas.style.cursor = 'move';
      } else if (this.hoveredSegment && (this.activeTool === 'add-node' || e.altKey)) {
        this.canvas.style.cursor = 'copy';
      } else if (this.hoveredSegment) {
        this.canvas.style.cursor = 'pointer';
      } else {
        this.canvas.style.cursor = 'default';
      }

      if (needRender) {
        this.render();
      }

      this.updateCoordsHUD(wx, wy);
    });

    // Window Mouse Up
    window.addEventListener('mouseup', () => {
      if (this.isPanning) {
        this.isPanning = false;
        this.canvas.style.cursor = this.activeTool === 'pan' ? 'grab' : 'default';
      }
      if (this.draggedNode) {
        this.draggedNode = null;
        this.render();
      }
    });

    // Keyboard Shortcuts
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen()) return;

      // Do not trigger shortcuts when typing in inputs
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;

      if (e.code === 'Space') {
        this.isSpacePressed = true;
        this.canvas.style.cursor = 'grab';
      }

      // Undo: Ctrl+Z or Cmd+Z
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        this.undo();
        return;
      }

      // Redo: Ctrl+Y or Ctrl+Shift+Z
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) {
        e.preventDefault();
        this.redo();
        return;
      }

      // Delete / Backspace: delete selected vertex
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.selectedNode) {
          e.preventDefault();
          this.deleteVertex(this.selectedNode.path, this.selectedNode.vertexIndex);
        }
      }

      // Escape: clear selection or close
      if (e.key === 'Escape') {
        if (this.selectedNode || this.selectedPath) {
          this.selectedNode = null;
          this.selectedPath = null;
          this.render();
          this.updateHUD();
        }
      }

      // Quick tool shortcuts
      if (e.key === 'v' || e.key === 'V') this.setTool('node');
      if (e.key === 'i' || e.key === 'I' || e.key === '+') this.setTool('add-node');
      if (e.key === 'h' || e.key === 'H') this.setTool('pan');
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space') {
        this.isSpacePressed = false;
        this.canvas.style.cursor = 'default';
      }
    });
  }

  isOpen() {
    return this.container && this.container.style.display !== 'none';
  }

  /**
   * Open the editor for a specific sheet.
   * @param {Object} sheet - Sheet object from packedResult
   * @param {number} sheetIndex - Index of sheet
   * @param {number} totalSheets - Total sheets in project
   */
  openSheet(sheet, sheetIndex = 0, totalSheets = 1) {
    if (!sheet) return;
    this.sheet = sheet;
    this.sheetIndex = sheetIndex;
    this.totalSheets = totalSheets;

    // Snapshot original state for the "Réinitialiser" action
    if (!this.sheet._originalBackup) {
      this.sheet._originalBackup = JSON.parse(JSON.stringify(this.sheet.items));
    }
    this.originalItemsSnapshot = this.sheet._originalBackup;

    // Reset interaction & history
    this.undoStack = [];
    this.redoStack = [];
    this.selectedPath = null;
    this.selectedNode = null;
    this.hoveredNode = null;
    this.hoveredSegment = null;
    this.draggedNode = null;
    this.activeTool = 'node';

    this.buildEditablePaths();
    this.resizeCanvas();
    this.fitToScreen();
    this.render();
    this.updateHUD();
  }

  /**
   * Build editable path representations directly pointing to item coordinates.
   */
  buildEditablePaths() {
    this.paths = [];
    if (!this.sheet || !this.sheet.items) return;

    for (let itemIdx = 0; itemIdx < this.sheet.items.length; itemIdx++) {
      const item = this.sheet.items[itemIdx];
      const itemLabel = item.label || `Strate #${itemIdx + 1}`;

      // 1. Outer perimeter (Cut contour)
      if (item.outer && item.outer.length >= 3) {
        this.paths.push({
          id: `item_${itemIdx}_outer`,
          item: item,
          kind: 'outer',
          subIndex: 0,
          points: item.outer,
          color: item.outerColor || '#ff0000',
          label: itemLabel
        });
      }

      // 2. Inner cut holes
      if (item.holes && item.holes.length > 0) {
        for (let hIdx = 0; hIdx < item.holes.length; hIdx++) {
          const hole = item.holes[hIdx];
          if (hole.length >= 3) {
            this.paths.push({
              id: `item_${itemIdx}_hole_${hIdx}`,
              item: item,
              kind: 'hole',
              subIndex: hIdx,
              points: hole,
              color: (item.holesColors && item.holesColors[hIdx]) || item.outerColor || '#ff0000',
              label: `${itemLabel} (trou ${hIdx + 1})`
            });
          }
        }
      }

      // 3. Alignment Guides (Laser engraving)
      if (item.guides && item.guides.length > 0) {
        for (let gIdx = 0; gIdx < item.guides.length; gIdx++) {
          const guide = item.guides[gIdx];
          if (guide.outer && guide.outer.length >= 3) {
            this.paths.push({
              id: `item_${itemIdx}_guide_${gIdx}`,
              item: item,
              kind: 'guide',
              subIndex: gIdx,
              points: guide.outer,
              color: (item.guidesColors && item.guidesColors[gIdx]) || '#0000ff',
              label: `${itemLabel} (repère ${gIdx + 1})`
            });
          }
        }
      }
    }
  }

  resizeCanvas() {
    if (!this.container) return;
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 600;
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  fitToScreen() {
    if (!this.sheet) return;
    const padding = 50;
    const availW = this.canvas.width - padding * 2;
    const availH = this.canvas.height - padding * 2;

    const scaleX = availW / this.sheet.width;
    const scaleY = availH / this.sheet.height;
    this.scale = Math.min(scaleX, scaleY, 6.0);

    this.offsetX = (this.canvas.width - this.sheet.width * this.scale) / 2;
    this.offsetY = (this.canvas.height - this.sheet.height * this.scale) / 2;
  }

  worldToScreen(wx, wy) {
    return [
      wx * this.scale + this.offsetX,
      wy * this.scale + this.offsetY
    ];
  }

  screenToWorld(sx, sy) {
    return [
      (sx - this.offsetX) / this.scale,
      (sy - this.offsetY) / this.scale
    ];
  }

  // =========================================================================
  // Hit Testing Helpers
  // =========================================================================

  findNodeAtScreen(sx, sy) {
    const thresholdPx = 10;
    let closest = null;
    let minDistance = thresholdPx;

    for (const path of this.paths) {
      for (let i = 0; i < path.points.length; i++) {
        const [nx, ny] = this.worldToScreen(path.points[i][0], path.points[i][1]);
        const dist = Math.hypot(sx - nx, sy - ny);
        if (dist <= minDistance) {
          minDistance = dist;
          closest = { path, vertexIndex: i };
        }
      }
    }
    return closest;
  }

  findSegmentAtScreen(sx, sy) {
    const thresholdPx = 8;
    let closest = null;
    let minDistance = thresholdPx;

    for (const path of this.paths) {
      const pts = path.points;
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const next = (i + 1) % n;
        const [x1, y1] = this.worldToScreen(pts[i][0], pts[i][1]);
        const [x2, y2] = this.worldToScreen(pts[next][0], pts[next][1]);

        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) continue;

        let t = ((sx - x1) * dx + (sy - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));

        const projScreenX = x1 + t * dx;
        const projScreenY = y1 + t * dy;
        const dist = Math.hypot(sx - projScreenX, sy - projScreenY);

        if (dist <= minDistance) {
          minDistance = dist;
          const [projWorldX, projWorldY] = this.screenToWorld(projScreenX, projScreenY);
          closest = {
            path,
            segmentIndex: i,
            projPoint: [parseFloat(projWorldX.toFixed(2)), parseFloat(projWorldY.toFixed(2))]
          };
        }
      }
    }
    return closest;
  }

  findPathAtScreen(sx, sy) {
    // Check if point is inside polygon or near its edges
    const [wx, wy] = this.screenToWorld(sx, sy);
    for (const path of this.paths) {
      if (this.isPointInsidePolygon([wx, wy], path.points)) {
        return path;
      }
    }
    // Fallback: check segment proximity
    const hitSeg = this.findSegmentAtScreen(sx, sy);
    return hitSeg ? hitSeg.path : null;
  }

  isPointInsidePolygon(point, polygon) {
    const [x, y] = point;
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i][0], yi = polygon[i][1];
      const xj = polygon[j][0], yj = polygon[j][1];
      const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // =========================================================================
  // Nodal Editing Mutations
  // =========================================================================

  insertVertex(path, segmentIndex, projPoint) {
    const pts = path.points;
    pts.splice(segmentIndex + 1, 0, projPoint);
    this.selectedPath = path;
    this.selectedNode = { path, vertexIndex: segmentIndex + 1 };
    this.render();
    this.updateHUD();
    this.onToast(`Nouveau sommet inséré sur ${path.label} (Total: ${pts.length} sommets).`);
  }

  deleteVertex(path, vertexIndex) {
    const pts = path.points;
    if (pts.length <= 3) {
      this.onToast("Un contour fermé doit contenir au moins 3 sommets.");
      return;
    }
    this.pushHistory();
    pts.splice(vertexIndex, 1);
    this.selectedNode = null;
    this.render();
    this.updateHUD();
    this.onToast(`Sommet supprimé de ${path.label} (Reste: ${pts.length} sommets).`);
  }

  setPathColor(path, newColor) {
    if (!path) return;
    this.pushHistory();

    const item = path.item;
    path.color = newColor;

    if (path.kind === 'outer') {
      item.outerColor = newColor;
    } else if (path.kind === 'hole') {
      item.holesColors = item.holesColors || [];
      item.holesColors[path.subIndex] = newColor;
    } else if (path.kind === 'guide') {
      item.guidesColors = item.guidesColors || [];
      item.guidesColors[path.subIndex] = newColor;
    }

    this.render();
    this.updateHUD();

    const colorName = newColor.toLowerCase() === '#ff0000'
      ? 'Découpe Complète (Rouge)'
      : (newColor.toLowerCase() === '#0000ff' ? 'Gravure Vectorielle (Bleu)' : 'Gravure Surfacique (Noir)');
    this.onToast(`Type appliqué : ${colorName}`);
  }

  setTool(tool) {
    this.activeTool = tool;
    this.updateToolButtons();
    this.render();
  }

  setColor(color) {
    this.activeColor = color;
    if (this.selectedPath) {
      this.setPathColor(this.selectedPath, color);
    }
    this.updateColorButtons();
  }

  // =========================================================================
  // History Management (Undo / Redo)
  // =========================================================================

  pushHistory() {
    if (!this.sheet || !this.sheet.items) return;
    const snapshot = JSON.parse(JSON.stringify(this.sheet.items));
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.updateHistoryButtons();
  }

  undo() {
    if (this.undoStack.length === 0) return;
    const currentSnapshot = JSON.parse(JSON.stringify(this.sheet.items));
    this.redoStack.push(currentSnapshot);

    const prevItems = this.undoStack.pop();
    this.sheet.items = prevItems;
    this.buildEditablePaths();
    this.selectedNode = null;
    this.selectedPath = null;
    this.render();
    this.updateHUD();
    this.updateHistoryButtons();
    this.onToast("Annulation effectuée (Ctrl+Z).");
  }

  redo() {
    if (this.redoStack.length === 0) return;
    const currentSnapshot = JSON.parse(JSON.stringify(this.sheet.items));
    this.undoStack.push(currentSnapshot);

    const nextItems = this.redoStack.pop();
    this.sheet.items = nextItems;
    this.buildEditablePaths();
    this.selectedNode = null;
    this.selectedPath = null;
    this.render();
    this.updateHUD();
    this.updateHistoryButtons();
    this.onToast("Rétablissement effectué (Ctrl+Y).");
  }

  resetSheet() {
    if (!this.originalItemsSnapshot) return;
    this.pushHistory();
    this.sheet.items = JSON.parse(JSON.stringify(this.originalItemsSnapshot));
    this.buildEditablePaths();
    this.selectedNode = null;
    this.selectedPath = null;
    this.render();
    this.updateHUD();
    this.onToast(`Planche #${this.sheetIndex + 1} réinitialisée aux tracés d'origine.`);
  }

  validateAndClose() {
    // Notify application that sheet edits are committed
    this.onSave(this.sheet, this.sheetIndex);
    this.onToast(`Planche #${this.sheetIndex + 1} enregistrée pour l'export vectoriel !`);
    this.onClose();
  }

  // =========================================================================
  // Main Render Loop
  // =========================================================================

  render() {
    this.resizeCanvas();
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Background
    ctx.fillStyle = '#0f1115';
    ctx.fillRect(0, 0, w, h);

    if (!this.sheet) return;

    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);

    const sheetW = this.sheet.width || 600;
    const sheetH = this.sheet.height || 400;
    const margin = this.sheet.margin || 8;

    // 1. Physical Sheet Mat Background
    ctx.fillStyle = '#1c1f26';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 30 / this.scale;
    ctx.shadowOffsetY = 8 / this.scale;
    ctx.fillRect(0, 0, sheetW, sheetH);
    ctx.shadowColor = 'transparent';

    // Sheet Border
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.0 / this.scale;
    ctx.strokeRect(0, 0, sheetW, sheetH);

    // Usable Margin
    ctx.strokeStyle = '#334155';
    ctx.setLineDash([4 / this.scale, 4 / this.scale]);
    ctx.strokeRect(margin, margin, sheetW - 2 * margin, sheetH - 2 * margin);
    ctx.setLineDash([]);

    // 10mm & 50mm Laser Bed Grid
    ctx.strokeStyle = '#262a34';
    ctx.lineWidth = 0.5 / this.scale;
    for (let x = 10; x < sheetW; x += 10) {
      if (x % 50 === 0) continue;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, sheetH);
      ctx.stroke();
    }
    for (let y = 10; y < sheetH; y += 10) {
      if (y % 50 === 0) continue;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(sheetW, y);
      ctx.stroke();
    }

    ctx.strokeStyle = '#3b4252';
    ctx.lineWidth = 0.8 / this.scale;
    for (let x = 50; x < sheetW; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, sheetH);
      ctx.stroke();
    }
    for (let y = 50; y < sheetH; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(sheetW, y);
      ctx.stroke();
    }

    // 2. Draw Paths / Contours
    for (const path of this.paths) {
      const isSelected = path === this.selectedPath;
      const pts = path.points;
      if (pts.length < 2) continue;

      // Selection Halo / Glow
      if (isSelected) {
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
        ctx.lineWidth = 6.0 / this.scale;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
          ctx.lineTo(pts[i][0], pts[i][1]);
        }
        ctx.closePath();
        ctx.stroke();
      }

      // Contour Stroke
      ctx.strokeStyle = path.color || '#ff0000';
      ctx.lineWidth = isSelected ? 2.0 / this.scale : 1.4 / this.scale;

      if (path.kind === 'guide') {
        ctx.setLineDash([3 / this.scale, 2 / this.scale]);
      } else {
        ctx.setLineDash([]);
      }

      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 3. Draw Stratum Labels & Centroids
    for (const item of this.sheet.items) {
      if (item.centroid) {
        const [cx, cy] = item.centroid;
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 0.8 / this.scale;

        // Centering crosshair
        const cross = 2.5;
        ctx.beginPath();
        ctx.moveTo(cx - cross, cy);
        ctx.lineTo(cx + cross, cy);
        ctx.moveTo(cx, cy - cross);
        ctx.lineTo(cx, cy + cross);
        ctx.stroke();

        ctx.fillStyle = '#38bdf8';
        ctx.font = `bold ${Math.max(8, 12 / this.scale)}px 'JetBrains Mono', monospace`;
        ctx.textAlign = 'center';
        ctx.fillText(item.label || '', cx, cy - 2.5);
      }
    }

    // 4. Ghost Segment Insertion Indicator
    if (this.hoveredSegment && !this.draggedNode) {
      const [gx, gy] = this.hoveredSegment.projPoint;
      ctx.fillStyle = '#06b6d4';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5 / this.scale;

      ctx.beginPath();
      ctx.arc(gx, gy, 5.0 / this.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Tooltip hint on hover
      ctx.fillStyle = '#06b6d4';
      ctx.font = `${Math.max(8, 9 / this.scale)}px sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText('+ Ajouter sommet (Dbl-clic)', gx + 8 / this.scale, gy - 4 / this.scale);
    }

    // 5. Draw Nodal Handles (Vertices / Anchors)
    for (const path of this.paths) {
      const isPathSelected = path === this.selectedPath;
      const pts = path.points;

      for (let i = 0; i < pts.length; i++) {
        const [vx, vy] = pts[i];
        const isHovered = this.hoveredNode && this.hoveredNode.path === path && this.hoveredNode.vertexIndex === i;
        const isSelected = this.selectedNode && this.selectedNode.path === path && this.selectedNode.vertexIndex === i;

        let radius = 4.0 / this.scale;
        let fillColor = '#1e293b';
        let strokeColor = path.color || '#ff0000';
        let strokeWidth = 1.2 / this.scale;

        if (isSelected) {
          radius = 6.0 / this.scale;
          fillColor = '#f59e0b';
          strokeColor = '#ffffff';
          strokeWidth = 2.0 / this.scale;
        } else if (isHovered) {
          radius = 5.5 / this.scale;
          fillColor = '#38bdf8';
          strokeColor = '#ffffff';
          strokeWidth = 1.8 / this.scale;
        } else if (isPathSelected) {
          radius = 4.5 / this.scale;
          fillColor = '#ffffff';
          strokeColor = path.color;
        }

        ctx.fillStyle = fillColor;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;

        ctx.beginPath();
        ctx.arc(vx, vy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // If hovered or dragged, display mm coordinate tag
        if (isSelected || isHovered) {
          ctx.fillStyle = '#ffffff';
          ctx.font = `bold ${Math.max(7, 9 / this.scale)}px monospace`;
          ctx.textAlign = 'center';
          ctx.fillText(`(${vx.toFixed(1)}, ${vy.toFixed(1)})`, vx, vy - radius - 3 / this.scale);
        }
      }
    }

    ctx.restore();
  }

  // =========================================================================
  // HUD and UI Integration
  // =========================================================================

  updateToolButtons() {
    if (typeof document === 'undefined') return;
    const btnNode = document.getElementById('editor-tool-node');
    const btnAdd = document.getElementById('editor-tool-add');
    const btnPan = document.getElementById('editor-tool-pan');
    if (btnNode) btnNode.classList.toggle('active', this.activeTool === 'node');
    if (btnAdd) btnAdd.classList.toggle('active', this.activeTool === 'add-node');
    if (btnPan) btnPan.classList.toggle('active', this.activeTool === 'pan');
  }

  updateColorButtons() {
    if (typeof document === 'undefined') return;
    const btnRed = document.getElementById('editor-color-red');
    const btnBlue = document.getElementById('editor-color-blue');
    const btnBlack = document.getElementById('editor-color-black');
    if (btnRed) btnRed.classList.toggle('active', this.activeColor === '#ff0000');
    if (btnBlue) btnBlue.classList.toggle('active', this.activeColor === '#0000ff');
    if (btnBlack) btnBlack.classList.toggle('active', this.activeColor === '#000000');
  }

  updateHistoryButtons() {
    if (typeof document === 'undefined') return;
    const btnUndo = document.getElementById('editor-btn-undo');
    const btnRedo = document.getElementById('editor-btn-redo');
    if (btnUndo) btnUndo.disabled = this.undoStack.length === 0;
    if (btnRedo) btnRedo.disabled = this.redoStack.length === 0;
  }

  updateHUD() {
    if (typeof document === 'undefined') return;
    this.updateToolButtons();
    this.updateColorButtons();
    this.updateHistoryButtons();

    const infoLabel = document.getElementById('editor-selection-info');
    if (infoLabel) {
      if (this.selectedNode) {
        infoLabel.textContent = `Sommet #${this.selectedNode.vertexIndex + 1} de ${this.selectedNode.path.label}`;
      } else if (this.selectedPath) {
        const colorName = this.selectedPath.color.toLowerCase() === '#ff0000'
          ? 'Découpe (Rouge)'
          : (this.selectedPath.color.toLowerCase() === '#0000ff' ? 'Gravure (Bleu)' : 'Marquage (Noir)');
        infoLabel.textContent = `Contour sélectionné : ${this.selectedPath.label} [${colorName}]`;
      } else {
        infoLabel.textContent = `Planche ${this.sheetIndex + 1}/${this.totalSheets} - Aucun tracé sélectionné`;
      }
    }
  }

  updateCoordsHUD(wx, wy) {
    if (typeof document === 'undefined') return;
    const coordsEl = document.getElementById('editor-coords-indicator');
    if (coordsEl) {
      coordsEl.textContent = `X: ${wx.toFixed(1)} mm | Y: ${wy.toFixed(1)} mm`;
    }
  }
}
