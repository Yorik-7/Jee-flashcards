// Handwritten Vector-Stroke Canvas Engine (Stylus, Touch & Mouse)
// Logical coordinate space: 1200 x 750 (16:10)

export const LOGICAL_W = 1200;
export const LOGICAL_H = 750;

export const PRESET_COLORS = [
  "#18181b", // Ink Black
  "#2563eb", // Royal Blue
  "#dc2626", // Crimson
  "#059669", // Emerald
  "#d97706", // Amber
  "#7c3aed"  // Violet
];

export function drawPaperBackground(ctx, w, h, bgType = "plain") {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  if (bgType === "grid") {
    ctx.strokeStyle = "#e5e7eb";
    ctx.lineWidth = 1;
    const step = 30;
    ctx.beginPath();
    for (let x = step; x < w; x += step) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
    }
    for (let y = step; y < h; y += step) {
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    ctx.stroke();
  } else if (bgType === "dots") {
    ctx.fillStyle = "#cbd5e1";
    const step = 30;
    for (let x = step; x < w; x += step) {
      for (let y = step; y < h; y += step) {
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

export function drawSingleStroke(ctx, stroke) {
  const pts = stroke.points;
  if (!pts || pts.length === 0) return;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke.color || "#18181b";
  ctx.fillStyle = stroke.color || "#18181b";

  const baseWidth = stroke.width || 3;

  // Highlighter: constant width, constant intensity, NO pressure sensitivity, single continuous path (no overlap beads)
  if (stroke.tool === "highlighter") {
    ctx.globalAlpha = 0.32;
    ctx.globalCompositeOperation = "multiply";
    ctx.lineWidth = baseWidth * 3.4;

    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x, pts[0].y, (baseWidth * 3.4) / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const curr = pts[i];
      const next = pts[i + 1];
      if (next) {
        const midX = (curr.x + next.x) / 2;
        const midY = (curr.y + next.y) / 2;
        ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
      } else {
        ctx.lineTo(curr.x, curr.y);
      }
    }
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Pen: smooth quadratic Bezier segments with subtle pressure modulation
  ctx.globalAlpha = 1;

  if (pts.length === 1) {
    const p = pts[0];
    const r = Math.max(1, (baseWidth * (0.65 + (p.p || 0.5) * 0.7)) / 2);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }

  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];
    const pressure = curr.p !== undefined ? curr.p : 0.5;
    ctx.lineWidth = Math.max(1, baseWidth * (0.65 + pressure * 0.7));

    ctx.beginPath();
    if (i === 1) {
      ctx.moveTo(prev.x, prev.y);
      if (next) {
        const midX = (curr.x + next.x) / 2;
        const midY = (curr.y + next.y) / 2;
        ctx.quadraticCurveTo(curr.x, curr.y, midX, midY);
      } else {
        ctx.lineTo(curr.x, curr.y);
      }
    } else {
      const prevMidX = (prev.x + curr.x) / 2;
      const prevMidY = (prev.y + curr.y) / 2;
      ctx.moveTo(prevMidX, prevMidY);
      if (next) {
        const nextMidX = (curr.x + next.x) / 2;
        const nextMidY = (curr.y + next.y) / 2;
        ctx.quadraticCurveTo(curr.x, curr.y, nextMidX, nextMidY);
      } else {
        ctx.lineTo(curr.x, curr.y);
      }
    }
    ctx.stroke();
  }
  ctx.restore();
}

export function renderStrokesToCanvas(canvas, strokes = [], bgType = "plain") {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const displayW = rect.width || canvas.clientWidth || 600;
  const displayH = rect.height || canvas.clientHeight || 375;
  const dpr = Math.min(window.devicePixelRatio || 1, 3);

  canvas.width = Math.round(displayW * dpr);
  canvas.height = Math.round(displayH * dpr);

  const ctx = canvas.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const scaleX = (displayW * dpr) / LOGICAL_W;
  const scaleY = (displayH * dpr) / LOGICAL_H;
  ctx.scale(scaleX, scaleY);

  drawPaperBackground(ctx, LOGICAL_W, LOGICAL_H, bgType);
  for (const stroke of strokes) {
    drawSingleStroke(ctx, stroke);
  }
}

export class HandwrittenEditor {
  constructor(canvasEl, onStateChange) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext("2d");
    this.onStateChange = onStateChange;

    this.activeSide = "question"; // "question" | "answer"
    this.sides = {
      question: { strokes: [], undoStack: [], redoStack: [], bg: "plain" },
      answer: { strokes: [], undoStack: [], redoStack: [], bg: "plain" }
    };

    this.tool = "pen"; // "pen" | "highlighter" | "eraser"
    this.color = PRESET_COLORS[0];
    this.brushSize = 3;
    this.zoom = 1;
    this.stylusOnly = false;
    this.dirty = false;

    this._drawing = false;
    this._currentStroke = null;
    this._activePointerId = null;

    this._bindEvents();
  }

  _bindEvents() {
    this.canvas.addEventListener("pointerdown", (e) => this._onPointerDown(e));
    this.canvas.addEventListener("pointermove", (e) => this._onPointerMove(e));
    this.canvas.addEventListener("pointerup", (e) => this._onPointerUp(e));
    this.canvas.addEventListener("pointercancel", (e) => this._onPointerUp(e));
  }

  loadCard(cardData = null) {
    const qStrokes = cardData?.questionStrokes ? structuredClone(cardData.questionStrokes) : [];
    const aStrokes = cardData?.answerStrokes ? structuredClone(cardData.answerStrokes) : [];
    this.sides.question = {
      strokes: qStrokes,
      undoStack: [],
      redoStack: [],
      bg: cardData?.questionBg || "plain"
    };
    this.sides.answer = {
      strokes: aStrokes,
      undoStack: [],
      redoStack: [],
      bg: cardData?.answerBg || "plain"
    };
    this.activeSide = "question";
    this.dirty = false;
    this.zoom = 1;
    this.resizeAndRender();
    this._notify();
  }

  setSide(side) {
    if (side !== "question" && side !== "answer") return;
    this.activeSide = side;
    this.resizeAndRender();
    this._notify();
  }

  getSideState() {
    return this.sides[this.activeSide];
  }

  setPaperBg(bg) {
    this.getSideState().bg = bg;
    this.dirty = true;
    this.resizeAndRender();
    this._notify();
  }

  setZoom(nextZoom) {
    this.zoom = Math.max(0.6, Math.min(2.5, Number(nextZoom.toFixed(2))));
    this.resizeAndRender();
    this._notify();
  }

  resizeAndRender() {
    const wrap = this.canvas.parentElement;
    if (!wrap) return;
    const stage = wrap.parentElement;
    const availW = Math.max(300, (stage?.clientWidth || window.innerWidth) - 36);
    const availH = Math.max(220, (stage?.clientHeight || window.innerHeight - 200) - 36);

    const aspect = LOGICAL_W / LOGICAL_H;
    let baseW = availW;
    let baseH = baseW / aspect;
    if (baseH > availH) {
      baseH = availH;
      baseW = baseH * aspect;
    }

    const cssW = Math.round(baseW * this.zoom);
    const cssH = Math.round(baseH * this.zoom);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);

    wrap.style.width = `${cssW}px`;
    wrap.style.height = `${cssH}px`;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);

    this.render();
  }

  render() {
    const side = this.getSideState();
    const scaleX = this.canvas.width / LOGICAL_W;
    const scaleY = this.canvas.height / LOGICAL_H;

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(scaleX, scaleY);

    drawPaperBackground(this.ctx, LOGICAL_W, LOGICAL_H, side.bg);
    for (const s of side.strokes) {
      drawSingleStroke(this.ctx, s);
    }
    if (this._currentStroke) {
      drawSingleStroke(this.ctx, this._currentStroke);
    }
  }

  _toLogicalPoint(e) {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * LOGICAL_W;
    const y = ((e.clientY - rect.top) / rect.height) * LOGICAL_H;
    // Highlighter ignores pressure sensitivity completely
    const p = this.tool !== "highlighter" && e.pointerType === "pen" && e.pressure > 0 ? e.pressure : 0.5;
    return {
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      p: Math.round(p * 100) / 100
    };
  }

  _pushUndoSnapshot() {
    const side = this.getSideState();
    side.undoStack.push(structuredClone(side.strokes));
    if (side.undoStack.length > 50) side.undoStack.shift();
    side.redoStack = [];
  }

  _onPointerDown(e) {
    if (this.stylusOnly && e.pointerType !== "pen") return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this._activePointerId = e.pointerId;
    this._drawing = true;

    const pt = this._toLogicalPoint(e);

    if (this.tool === "eraser") {
      this._eraseAt(pt);
      return;
    }

    this._pushUndoSnapshot();
    this._currentStroke = {
      tool: this.tool,
      color: this.color,
      width: this.brushSize,
      points: [pt]
    };
    this.render();
  }

  _onPointerMove(e) {
    if (!this._drawing || e.pointerId !== this._activePointerId) return;
    e.preventDefault();

    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events) {
      const pt = this._toLogicalPoint(ev);
      if (this.tool === "eraser") {
        this._eraseAt(pt);
      } else if (this._currentStroke) {
        const pts = this._currentStroke.points;
        const last = pts[pts.length - 1];
        const dist = Math.hypot(pt.x - last.x, pt.y - last.y);
        if (dist >= 1.5) {
          pts.push(pt);
        }
      }
    }
    if (this.tool !== "eraser") this.render();
  }

  _onPointerUp(e) {
    if (!this._drawing || e.pointerId !== this._activePointerId) return;
    this._drawing = false;
    this._activePointerId = null;

    if (this._currentStroke) {
      this.getSideState().strokes.push(this._currentStroke);
      this._currentStroke = null;
      this.dirty = true;
      this.render();
      this._notify();
    }
  }

  _eraseAt(pt) {
    const side = this.getSideState();
    const radius = Math.max(14, this.brushSize * 3.5);
    const rSq = radius * radius;

    const hitIndex = side.strokes.findIndex((stroke) =>
      stroke.points.some((p) => {
        const dx = p.x - pt.x;
        const dy = p.y - pt.y;
        return dx * dx + dy * dy <= rSq;
      })
    );

    if (hitIndex !== -1) {
      this._pushUndoSnapshot();
      side.strokes.splice(hitIndex, 1);
      this.dirty = true;
      this.render();
      this._notify();
    }
  }

  undo() {
    const side = this.getSideState();
    if (side.undoStack.length === 0) return;
    side.redoStack.push(structuredClone(side.strokes));
    side.strokes = side.undoStack.pop();
    this.dirty = true;
    this.render();
    this._notify();
  }

  redo() {
    const side = this.getSideState();
    if (side.redoStack.length === 0) return;
    side.undoStack.push(structuredClone(side.strokes));
    side.strokes = side.redoStack.pop();
    this.dirty = true;
    this.render();
    this._notify();
  }

  clearCurrent() {
    const side = this.getSideState();
    if (side.strokes.length === 0) return;
    this._pushUndoSnapshot();
    side.strokes = [];
    this.dirty = true;
    this.render();
    this._notify();
  }

  exportData() {
    return {
      questionStrokes: structuredClone(this.sides.question.strokes),
      answerStrokes: structuredClone(this.sides.answer.strokes),
      questionBg: this.sides.question.bg,
      answerBg: this.sides.answer.bg
    };
  }

  _notify() {
    if (this.onStateChange) this.onStateChange();
  }
}
