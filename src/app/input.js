// Touch/mouse joystick and keyboard state.
export const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' && e.target.type !== 'range')) return;
  keys.add(e.key.toLowerCase());
  if (e.key.startsWith('Arrow') || e.key === ' ') e.preventDefault();
});
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

export class Stick {
  constructor(el, knob) {
    this.el = el; this.knob = knob; this.x = 0; this.y = 0; this.id = null;
    const move = (e) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      let dx = (e.clientX - cx) / (r.width / 2), dy = (cy - e.clientY) / (r.height / 2);
      const l = Math.hypot(dx, dy);
      if (l > 1) { dx /= l; dy /= l; }
      this.x = dx; this.y = dy;
      const k = (r.width - knob.offsetWidth) / 2;
      knob.style.transform = `translate(${dx * k}px, ${-dy * k}px)`;
    };
    el.addEventListener('pointerdown', (e) => { this.id = e.pointerId; el.setPointerCapture(e.pointerId); move(e); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === this.id) move(e); });
    const end = (e) => {
      if (e.pointerId !== this.id) return;
      this.id = null; this.x = 0; this.y = 0; knob.style.transform = '';
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }
}
