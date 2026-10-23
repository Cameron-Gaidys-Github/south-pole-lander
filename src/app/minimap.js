// Map display.
//   far out:      80 km regional map with the ground track
//   inside 3 km:  4 km site map
//   AUTO < 4 km:  landing point display, 320 m across, centred on the landing
//                 point, with the hazard scan (green safe, red unsafe). Tap to
//                 move the landing point.
// Pixels are the traced sunlight, so the map shows what is actually lit.
function makeImage(hf, vis, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const fx = i / (size - 1), fy = 1 - j / (size - 1);
      const vi = Math.min(vis.n - 1, Math.round(fx * (vis.n - 1)));
      const vj = Math.min(vis.n - 1, Math.round(fy * (vis.n - 1)));
      const lit = vis.data[vj * vis.n + vi];
      const x = fx * 2 * hf.half - hf.half, y = fy * 2 * hf.half - hf.half;
      const d = hf.spacing * 2;
      const sx = (hf.sample(x + d, y) - hf.sample(x - d, y)) / (2 * d);
      const sy = (hf.sample(x, y + d) - hf.sample(x, y - d)) / (2 * d);
      const shade = Math.max(0, Math.min(1, 0.5 - sx * 1.2 + sy * 0.6));
      const v = 14 + 120 * lit * (0.55 + 0.45 * shade) + 30 * shade;
      const k = (j * size + i) * 4;
      img.data[k] = v; img.data[k + 1] = v * 0.98; img.data[k + 2] = v * 0.94; img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

export class Minimap {
  constructor(canvas, terrain, world) {
    this.c = canvas; this.g = canvas.getContext('2d');
    this.terrain = terrain;
    this.site = makeImage(terrain.site, world.siteVis, 384);
    this.reg = makeImage(terrain.regional, world.regVis, 256);
    this.view = { cx: 0, cy: 0, half: terrain.regional.half };
    this.lpdView = false;
  }
  /** Canvas fraction (0..1, y down) to map coords for the current view. */
  toMap(fx, fy) {
    const { cx, cy, half } = this.view;
    return [cx - half + fx * 2 * half, cy + half - fy * 2 * half];
  }
  draw(sim, hazard, lpd) {
    const g = this.g, W = this.c.width;
    const [x, y] = sim.map;
    this.lpdView = !!lpd;
    this.c.classList.toggle('lpd', this.lpdView);
    const site = this.terrain.site;
    let view;
    if (lpd) view = { cx: sim.target.x, cy: sim.target.y, half: 160, img: this.site, hf: site };
    else if (sim.rangeToTarget < site.half * 0.8) view = { cx: 0, cy: 0, half: site.half, img: this.site, hf: site };
    else view = { cx: 0, cy: 0, half: this.terrain.regional.half, img: this.reg, hf: this.terrain.regional };
    this.view = view;
    const { cx, cy, half, img, hf } = view;
    const toPx = (mx, my) => [((mx - cx) + half) / (2 * half) * W, (1 - ((my - cy) + half) / (2 * half)) * W];
    // background: crop of the pre-rendered map
    g.fillStyle = '#0b0b0c'; g.fillRect(0, 0, W, W);
    const s = img.width / (2 * hf.half);
    g.imageSmoothingEnabled = true;
    g.drawImage(img, (cx - half + hf.half) * s, (hf.half - (cy + half)) * s, 2 * half * s, 2 * half * s, 0, 0, W, W);

    if (lpd && hazard) {
      const { n, cell, cx: hx, cy: hy, half: hh, safe } = hazard;
      const px = cell / (2 * half) * W;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const [qx, qy] = toPx(hx - hh + i * cell, hy - hh + j * cell);
        g.fillStyle = safe[j * n + i] ? 'rgba(111,211,154,0.20)' : 'rgba(255,106,85,0.42)';
        g.fillRect(qx - px / 2, qy - px / 2, px + 0.5, px + 0.5);
      }
      // footprint of the lander at the landing point
      const [ox, oy] = toPx(sim.target.x, sim.target.y);
      g.strokeStyle = '#ffffff'; g.lineWidth = 2;
      g.beginPath(); g.arc(ox, oy, sim.v.legRadius / (2 * half) * W, 0, Math.PI * 2); g.stroke();
    }
    // track
    g.strokeStyle = 'rgba(242,169,59,0.9)'; g.lineWidth = 2; g.beginPath();
    let first = true;
    for (const [tx, ty] of sim.track) {
      if (Math.abs(tx - cx) > half * 1.5 || Math.abs(ty - cy) > half * 1.5) continue;
      const [px, py] = toPx(tx, ty);
      if (first) { g.moveTo(px, py); first = false; } else g.lineTo(px, py);
    }
    g.stroke();
    // landing point
    const [ox, oy] = toPx(sim.target.x, sim.target.y);
    g.strokeStyle = '#6fd39a'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(ox - 14, oy); g.lineTo(ox - 5, oy); g.moveTo(ox + 5, oy); g.lineTo(ox + 14, oy);
    g.moveTo(ox, oy - 14); g.lineTo(ox, oy - 5); g.moveTo(ox, oy + 5); g.lineTo(ox, oy + 14); g.stroke();
    // vehicle
    const [vx, vy] = toPx(Math.max(cx - half, Math.min(cx + half, x)), Math.max(cy - half, Math.min(cy + half, y)));
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(vx, vy, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(16,17,20,0.8)'; g.fillRect(0, W - 30, W, 30);
    g.fillStyle = '#e9e5dc'; g.font = '500 20px "IBM Plex Mono", monospace';
    g.fillText(lpd ? 'LPD · tap to move' : useLabel(half), 10, W - 9);
  }
}
const useLabel = (half) => (half > 5000 ? '80 km region' : '4 km site');
