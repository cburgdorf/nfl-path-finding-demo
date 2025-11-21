type CellType = 'water' | 'land';

type Cell = {
  x: number;
  y: number;
  type: CellType;
  avg: { r: number; g: number; b: number };
};

const GRID_COLS = 368;
const GRID_ROWS = 320;
const IMAGE_PATH = './assets/map.png';

const app = document.querySelector<HTMLElement>('#app');

if (!app) {
  throw new Error('App container missing');
}

app.innerHTML = `
  <div class="header">
    <div>
      <div class="title">Map Grid Draft</div>
      <p class="subtitle">Auto-generated grid over the map: water is 0, land is 1. Values are derived from the image.</p>
    </div>
    <div class="badge">TypeScript</div>
  </div>
  <div class="controls">
    <label class="toggle">
      <input id="overlay-toggle" type="checkbox" checked />
      <span>Show overlay</span>
    </label>
    <label class="toggle">
      <input id="label-toggle" type="checkbox" checked />
      <span>Show 0 / 1 labels</span>
    </label>
    <button type="button" id="rebuild-grid">Rebuild grid</button>
  </div>
  <div class="map-shell" data-overlay="on" data-labels="on">
    <div class="map-base" aria-hidden="true"></div>
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
const overlayToggle = requireElement(app.querySelector<HTMLInputElement>('#overlay-toggle'), '#overlay-toggle');
const labelToggle = requireElement(app.querySelector<HTMLInputElement>('#label-toggle'), '#label-toggle');
const rebuildButton = requireElement(app.querySelector<HTMLButtonElement>('#rebuild-grid'), '#rebuild-grid');
const mapShell = requireElement(app.querySelector<HTMLDivElement>('.map-shell'), '.map-shell');

const mapImage = new Image();
mapImage.src = IMAGE_PATH;

const canvas = document.createElement('canvas');
const maybeCtx = canvas.getContext('2d');

if (!maybeCtx) {
  throw new Error('Canvas is not available in this browser.');
}

const ctx = maybeCtx;

const cells: Cell[] = [];

function avgFromImageData(data: Uint8ClampedArray): { r: number; g: number; b: number } {
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
  const total = avg.r + avg.g + avg.b + 1e-6;
  const blueShare = avg.b / total;
  const max = Math.max(avg.r, avg.g, avg.b);
  const min = Math.min(avg.r, avg.g, avg.b);
  const saturation = max === 0 ? 0 : (max - min) / max;
  const blueDelta = avg.b - Math.max(avg.r, avg.g);

  const looksWater = blueShare > 0.38 && blueDelta > 12 && saturation > 0.15;
  return looksWater ? 'water' : 'land';
}

function updateLegend() {
  const waterCount = cells.filter(cell => cell.type === 'water').length;
  const landCount = cells.length - waterCount;
  legendEl.innerHTML = `Grid <strong>${GRID_COLS} x ${GRID_ROWS}</strong> (${cells.length} cells) — water (0): <strong>${waterCount}</strong> | land (1): <strong>${landCount}</strong>.`;
}

function renderOverlay() {
  overlayEl.innerHTML = '';
  overlayEl.style.gridTemplateColumns = `repeat(${GRID_COLS}, 1fr)`;
  overlayEl.style.gridTemplateRows = `repeat(${GRID_ROWS}, 1fr)`;

  const fragment = document.createDocumentFragment();
  for (const cell of cells) {
    const cellEl = document.createElement('div');
    cellEl.className = `overlay-cell ${cell.type}`;
    cellEl.dataset.x = String(cell.x);
    cellEl.dataset.y = String(cell.y);

    const label = document.createElement('span');
    label.className = 'cell-label';
    label.textContent = cell.type === 'water' ? '0' : '1';
    cellEl.appendChild(label);

    fragment.appendChild(cellEl);
  }

  overlayEl.appendChild(fragment);
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

labelToggle.addEventListener('change', () => {
  mapShell.dataset.labels = labelToggle.checked ? 'on' : 'off';
});

rebuildButton.addEventListener('click', async () => {
  rebuildButton.disabled = true;
  rebuildButton.textContent = 'Rebuilding…';
  try {
    await buildGrid();
    renderOverlay();
    updateLegend();
  } finally {
    rebuildButton.disabled = false;
    rebuildButton.textContent = 'Rebuild grid';
  }
});

(async () => {
  try {
    await buildGrid();
    renderOverlay();
    updateLegend();
  } catch (err) {
    legendEl.textContent =
      err instanceof Error ? `Failed to prepare grid: ${err.message}` : 'Failed to prepare grid.';
    console.error(err);
  }
})();
