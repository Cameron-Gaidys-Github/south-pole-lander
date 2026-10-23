// Top-down map: the regional view while far out, the 4 km site view once close.
// Pixels are the traced sunlight, so it shows what is actually lit.
function makeImage(hf, vis, size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      // map row 0 = +y (north-up style: +y up on screen)
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
    this.site = makeImage(terrain.site, world.siteVis, 256);
    this.reg = makeImage(terrain.regional, world.regVis, 256);
  }
  draw(sim) {
    const g = this.g, W = this.c.width;
    const [x, y] = sim.map;
    const useSite = sim.rangeToTarget < this.terrain.site.half * 0.8;
    const hf = useSite ? this.terrain.site : this.terrain.regional;
    const half = hf.half;
    g.drawImage(useSite ? this.site : this.reg, 0, 0, W, W);
    const toPx = (mx, my) => [(mx + half) / (2 * half) * W, (1 - (my + half) / (2 * half)) * W];
    // track
    g.strokeStyle = 'rgba(242,169,59,0.9)'; g.lineWidth = 2; g.beginPath();
    let first = true;
    for (const [tx, ty] of sim.track) {
      if (Math.abs(tx) > half * 1.5) continue;
      const [px, py] = toPx(tx, ty);
      if (first) { g.moveTo(px, py); first = false; } else g.lineTo(px, py);
    }
    g.stroke();
    // target
    const [ox, oy] = toPx(0, 0);
    g.strokeStyle = '#6fd39a'; g.lineWidth = 2;
    g.beginPath(); g.arc(ox, oy, useSite ? 10 : 6, 0, Math.PI * 2); g.moveTo(ox - 16, oy); g.lineTo(ox + 16, oy); g.moveTo(ox, oy - 16); g.lineTo(ox, oy + 16); g.stroke();
    // vehicle
    const [vx, vy] = toPx(Math.max(-half, Math.min(half, x)), Math.max(-half, Math.min(half, y)));
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(vx, vy, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(16,17,20,0.8)'; g.fillRect(0, W - 30, W, 30);
    g.fillStyle = '#e9e5dc'; g.font = '500 20px "IBM Plex Mono", monospace';
    g.fillText(useSite ? '4 km site' : '80 km region', 10, W - 9);
  }
}
