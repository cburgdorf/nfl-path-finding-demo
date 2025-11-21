type CellType = 'water' | 'land';

type Cell = {
  x: number;
  y: number;
  type: CellType;
  avg: { r: number; g: number; b: number };
};

const GRID_COLS = 184;
const GRID_ROWS = 160;
const IMAGE_PATH = './assets/map.png';

const app = document.querySelector<HTMLElement>('#app');

if (!app) {
  throw new Error('App container missing');
}

app.innerHTML = `
  <div class="header">
    <div>
      <div class="title">Map Grid & Path</div>
      <p class="subtitle">Auto-generated grid over the map: water is 0, land is 1. Click two water tiles to draw the shortest water path.</p>
    </div>
  </div>
  <div class="controls">
    <label class="toggle">
      <input id="overlay-toggle" type="checkbox" checked />
      <span>Show overlay</span>
    </label>
  </div>
  <pre id="debug" class="debug">Click two water cells: start then target.</pre>
  <div class="map-shell" data-overlay="on" data-labels="on">
    <div class="map-base" aria-hidden="true"></div>
    <canvas id="path-layer" class="path-layer"></canvas>
    <div class="grid-overlay" id="grid-overlay"></div>
  </div>
  <p class="legend" id="legend">Loading map…</p>
`;

function requireElement<T>(value: T | null, label: string): T {
  if (!value) {
    throw new Error(`Element not found: ${label}`);
  }
  return value;
}

const overlayEl = requireElement(app.querySelector<HTMLDivElement>('#grid-overlay'), '#grid-overlay');
const legendEl = requireElement(app.querySelector<HTMLParagraphElement>('#legend'), '#legend');
const debugEl = requireElement(app.querySelector<HTMLPreElement>('#debug'), '#debug');
const overlayToggle = requireElement(app.querySelector<HTMLInputElement>('#overlay-toggle'), '#overlay-toggle');
const mapShell = requireElement(app.querySelector<HTMLDivElement>('.map-shell'), '.map-shell');
const pathCanvas = requireElement(app.querySelector<HTMLCanvasElement>('#path-layer'), '#path-layer');
const maybePathCtx = pathCanvas.getContext('2d');

if (!maybePathCtx) {
  throw new Error('Path canvas is not supported in this browser.');
}
const pathCtx = maybePathCtx;

const mapImage = new Image();
mapImage.src = IMAGE_PATH;

const canvas = document.createElement('canvas');
const maybeCtx = canvas.getContext('2d');

if (!maybeCtx) {
  throw new Error('Canvas is not available in this browser.');
}

const ctx = maybeCtx;

const cells: Cell[] = [];
type Point = { x: number; y: number };
let startSelection: Point | null = null;
let targetSelection: Point | null = null;
let pathCells: Point[] = [];

function avgFromImageData(data: Uint8ClampedArray): { r: number; g: number; b: number } {
  // Average the sampled image block; used to classify each cell.
  let r = 0;
  let g = 0;
  let b = 0;
  const pixelCount = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return {
    r: r / pixelCount,
    g: g / pixelCount,
    b: b / pixelCount,
  };
}

function classify(avg: { r: number; g: number; b: number }): CellType {
  // Heuristic water detector: favors blue-heavy, mildly saturated regions.
  const total = avg.r + avg.g + avg.b + 1e-6;
  const blueShare = avg.b / total;
  const max = Math.max(avg.r, avg.g, avg.b);
  const min = Math.min(avg.r, avg.g, avg.b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  const blueDelta = avg.b - Math.max(avg.r, avg.g);

  const looksWater = blueShare > 0.38 && blueDelta > 12 && saturation > 0.15;
  return looksWater ? 'water' : 'land';
}

function cellIndex(x: number, y: number): number {
  return y * GRID_COLS + x;
}

function getCell(x: number, y: number): Cell | undefined {
  if (x < 0 || y < 0 || x >= GRID_COLS || y >= GRID_ROWS) return undefined;
  return cells[cellIndex(x, y)];
}

function isWater(point: Point): boolean {
  const cell = getCell(point.x, point.y);
  return Boolean(cell && cell.type === 'water');
}

function updateLegend() {
  const waterCount = cells.filter(cell => cell.type === 'water').length;
  const landCount = cells.length - waterCount;
  const startText = startSelection ? ` start (${startSelection.x},${startSelection.y})` : ' start unset';
  const targetText = targetSelection ? ` target (${targetSelection.x},${targetSelection.y})` : ' target unset';
  const hops = pathCells.length ? ` | path length: ${pathCells.length}` : '';
  const pathStatus =
    startSelection && targetSelection && !pathCells.length
      ? ' | no water-only path found'
      : '';
  legendEl.innerHTML = `Grid <strong>${GRID_COLS} x ${GRID_ROWS}</strong> (${cells.length} cells) — water (0): <strong>${waterCount}</strong> | land (1): <strong>${landCount}</strong>.${hops}${pathStatus} ·${startText} ·${targetText}`;
}

function logDebug(message: string) {
  const existing = debugEl.textContent ?? '';
  const lines = existing.trim() ? existing.split('\n') : [];
  lines.push(message);
  debugEl.textContent = lines.slice(-6).join('\n');
}

function renderOverlay() {
  overlayEl.innerHTML = '';
  overlayEl.style.gridTemplateColumns = `repeat(${GRID_COLS}, 1fr)`;
  overlayEl.style.gridTemplateRows = `repeat(${GRID_ROWS}, 1fr)`;

  const fragment = document.createDocumentFragment();
  for (const cell of cells) {
    const isStart = startSelection && startSelection.x === cell.x && startSelection.y === cell.y;
    const isTarget = targetSelection && targetSelection.x === cell.x && targetSelection.y === cell.y;
    const cellEl = document.createElement('div');
    cellEl.className = ['overlay-cell', cell.type, isStart && 'start', isTarget && 'target']
      .filter(Boolean)
      .join(' ');
    cellEl.dataset.x = String(cell.x);
    cellEl.dataset.y = String(cell.y);

    cellEl.addEventListener('click', () => handleCellClick(cell));

    fragment.appendChild(cellEl);
  }

  overlayEl.appendChild(fragment);
}

function pointKey(point: Point): string {
  return `${point.x},${point.y}`;
}

class MinHeap<T extends { cost: number }> {
  // Minimal binary heap for Dijkstra priority queue.
  private data: T[] = [];

  push(item: T) {
    this.data.push(item);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): T | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length) {
      this.data[0] = last;
      this.bubbleDown(0);
    }
    return top;
  }

  get size(): number {
    return this.data.length;
  }

  private bubbleUp(index: number) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.data[parent].cost <= this.data[index].cost) break;
      [this.data[parent], this.data[index]] = [this.data[index], this.data[parent]];
      index = parent;
    }
  }

  private bubbleDown(index: number) {
    const length = this.data.length;
    while (true) {
      let smallest = index;
      const left = index * 2 + 1;
      const right = index * 2 + 2;
      if (left < length && this.data[left].cost < this.data[smallest].cost) smallest = left;
      if (right < length && this.data[right].cost < this.data[smallest].cost) smallest = right;
      if (smallest === index) break;
      [this.data[smallest], this.data[index]] = [this.data[index], this.data[smallest]];
      index = smallest;
    }
  }
}

function findWaterPath(start: Point, target: Point): Point[] | null {
  // Dijkstra on 8-connected grid, disallowing diagonal corner cuts through land.
  const directions = [
    { x: 1, y: 0, cost: 1 },
    { x: -1, y: 0, cost: 1 },
    { x: 0, y: 1, cost: 1 },
    { x: 0, y: -1, cost: 1 },
    { x: 1, y: 1, cost: Math.SQRT2 },
    { x: 1, y: -1, cost: Math.SQRT2 },
    { x: -1, y: 1, cost: Math.SQRT2 },
    { x: -1, y: -1, cost: Math.SQRT2 },
  ];

  const heap = new MinHeap<{ x: number; y: number; cost: number }>();
  const dist = new Map<string, number>();
  const parent = new Map<string, string>();

  const startKey = pointKey(start);
  dist.set(startKey, 0);
  heap.push({ ...start, cost: 0 });

  while (heap.size) {
    const current = heap.pop()!;
    const currKey = pointKey(current);
    const currDist = dist.get(currKey)!;
    if (currDist < current.cost) continue;

    if (current.x === target.x && current.y === target.y) {
      const path: Point[] = [{ x: current.x, y: current.y }];
      let cursor = currKey;
      while (parent.has(cursor)) {
        const ancestor = parent.get(cursor)!;
        const [px, py] = ancestor.split(',').map(Number);
        path.push({ x: px, y: py });
        cursor = ancestor;
      }
      return path.reverse();
    }

    for (const dir of directions) {
      const nx = current.x + dir.x;
      const ny = current.y + dir.y;
      const neighbor = { x: nx, y: ny };

      if (!getCell(nx, ny) || !isWater(neighbor)) continue;

      // Prevent cutting corners through land when moving diagonally.
      if (Math.abs(dir.x) === 1 && Math.abs(dir.y) === 1) {
        const sideA = getCell(current.x + dir.x, current.y);
        const sideB = getCell(current.x, current.y + dir.y);
        if ((sideA && sideA.type === 'land') || (sideB && sideB.type === 'land')) continue;
      }

      const neighborKey = pointKey(neighbor);
      const nextCost = currDist + dir.cost;
      if (!dist.has(neighborKey) || nextCost < dist.get(neighborKey)!) {
        dist.set(neighborKey, nextCost);
        parent.set(neighborKey, currKey);
        heap.push({ ...neighbor, cost: nextCost });
      }
    }
  }

  return null;
}

function resizePathCanvas() {
  const { clientWidth, clientHeight } = overlayEl;
  pathCanvas.width = Math.max(1, Math.floor(clientWidth));
  pathCanvas.height = Math.max(1, Math.floor(clientHeight));
}

function clearPathCanvas() {
  resizePathCanvas();
  pathCtx.clearRect(0, 0, pathCanvas.width, pathCanvas.height);
}

function cellCenter(point: Point): { cx: number; cy: number } {
  const cellW = pathCanvas.width / GRID_COLS;
  const cellH = pathCanvas.height / GRID_ROWS;
  return { cx: (point.x + 0.5) * cellW, cy: (point.y + 0.5) * cellH };
}

function drawPath() {
  resizePathCanvas();
  pathCtx.clearRect(0, 0, pathCanvas.width, pathCanvas.height);
  if (pathCells.length < 2) return;

  const cellW = pathCanvas.width / GRID_COLS;
  const cellH = pathCanvas.height / GRID_ROWS;
  const baseWidth = Math.min(cellW, cellH);
  const lineWidth = Math.max(3, Math.min(14, baseWidth * 0.9));

  pathCtx.lineWidth = lineWidth;
  pathCtx.strokeStyle = 'rgba(255, 53, 69, 0.96)';
  pathCtx.lineJoin = 'round';
  pathCtx.lineCap = 'round';
  pathCtx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  pathCtx.shadowBlur = lineWidth * 0.6;

  const centers = pathCells.map(cellCenter);

  pathCtx.beginPath();
  pathCtx.moveTo(centers[0].cx, centers[0].cy);

  for (let i = 0; i < centers.length - 1; i += 1) {
    const current = centers[i];
    const next = centers[i + 1];
    const xc = (current.cx + next.cx) / 2;
    const yc = (current.cy + next.cy) / 2;
    // Quadratic smoothing between cell centers for a less blocky line.
    pathCtx.quadraticCurveTo(current.cx, current.cy, xc, yc);
  }

  const last = centers[centers.length - 1];
  pathCtx.lineTo(last.cx, last.cy);
  pathCtx.stroke();
  pathCtx.shadowBlur = 0;

  const endpoints = [centers[0], centers[centers.length - 1]];
  endpoints.forEach(point => {
    const { cx, cy } = point;
    pathCtx.fillStyle = 'rgba(255, 53, 69, 0.98)';
    pathCtx.beginPath();
    pathCtx.arc(cx, cy, Math.max(4, pathCtx.lineWidth * 0.95), 0, Math.PI * 2);
    pathCtx.fill();
  });
}

function computeAndRenderPath() {
  if (!startSelection || !targetSelection) {
    pathCells = [];
    clearPathCanvas();
    return;
  }

  if (!isWater(startSelection) || !isWater(targetSelection)) {
    pathCells = [];
    clearPathCanvas();
    logDebug('Path aborted: start or target not on water.');
    return;
  }

  const found = findWaterPath(startSelection, targetSelection);
  if (found) {
    pathCells = found;
    logDebug(`Path found: ${found.length} steps.`);
    drawPath();
  } else {
    pathCells = [];
    logDebug('No water-only path found.');
    clearPathCanvas();
  }
}

function handleCellClick(cell: Cell) {
  if (cell.type !== 'water') {
    logDebug(`Ignored land cell (${cell.x},${cell.y}).`);
    return;
  }

  const clicked = { x: cell.x, y: cell.y };
  if (!startSelection || (startSelection.x === clicked.x && startSelection.y === clicked.y)) {
    startSelection = clicked;
    targetSelection = null;
    pathCells = [];
    logDebug(`Start set to (${clicked.x},${clicked.y}) [water].`);
  } else if (!targetSelection || (targetSelection.x === clicked.x && targetSelection.y === clicked.y)) {
    targetSelection = clicked;
    logDebug(`Target set to (${clicked.x},${clicked.y}) [water].`);
  } else {
    startSelection = clicked;
    targetSelection = null;
    pathCells = [];
    logDebug(`Start reset to (${clicked.x},${clicked.y}) [water].`);
  }

  renderOverlay();
  computeAndRenderPath();
  updateLegend();
}

async function buildGrid(): Promise<void> {
  legendEl.textContent = 'Scanning map…';
  await mapImage.decode();

  canvas.width = mapImage.naturalWidth || mapImage.width;
  canvas.height = mapImage.naturalHeight || mapImage.height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(mapImage, 0, 0);

  const cellWidth = canvas.width / GRID_COLS;
  const cellHeight = canvas.height / GRID_ROWS;

  cells.length = 0;
  startSelection = null;
  targetSelection = null;
  pathCells = [];
  clearPathCanvas();
  debugEl.textContent = 'Grid ready. Click water for start.';

  for (let row = 0; row < GRID_ROWS; row += 1) {
    for (let col = 0; col < GRID_COLS; col += 1) {
      const sx = Math.floor(col * cellWidth);
      const sy = Math.floor(row * cellHeight);
      const sw = Math.ceil(cellWidth);
      const sh = Math.ceil(cellHeight);

      const imgData = ctx.getImageData(sx, sy, sw, sh);
      const avg = avgFromImageData(imgData.data);
      const type = classify(avg);

      cells.push({ x: col, y: row, type, avg });
    }
  }
}

overlayToggle.addEventListener('change', () => {
  mapShell.dataset.overlay = overlayToggle.checked ? 'on' : 'off';
});

window.addEventListener('resize', () => {
  if (pathCells.length) {
    drawPath();
  } else {
    clearPathCanvas();
  }
});

(async () => {
  try {
    await buildGrid();
    renderOverlay();
    computeAndRenderPath();
    updateLegend();
  } catch (err) {
    legendEl.textContent =
      err instanceof Error ? `Failed to prepare grid: ${err.message}` : 'Failed to prepare grid.';
    console.error(err);
  }
})();
