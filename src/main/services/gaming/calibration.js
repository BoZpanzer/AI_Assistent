'use strict';
/** Fit game x/z to normalized image x/y, including reflection and unequal scale. */
function affineFromPoints(points) {
  if (!Array.isArray(points) || points.length !== 3) throw new Error('Drei Referenzpunkte nötig');
  for (const p of points) {
    if (!p || !['ix', 'iy', 'gx', 'gz'].every(k => Number.isFinite(p[k]))) throw new Error('Ungültiger Referenzpunkt');
    if (p.ix < 0 || p.ix > 1 || p.iy < 0 || p.iy > 1) throw new Error('Referenzpunkt außerhalb des Bildes');
  }
  const [p, q, r] = points;
  const x1 = q.gx - p.gx, z1 = q.gz - p.gz, x2 = r.gx - p.gx, z2 = r.gz - p.gz;
  const det = x1 * z2 - x2 * z1;
  const scale = Math.hypot(x1, z1) * Math.hypot(x2, z2);
  const imageDet = (q.ix - p.ix) * (r.iy - p.iy) - (r.ix - p.ix) * (q.iy - p.iy);
  if (!scale || Math.abs(det) / scale < 0.01 || Math.abs(imageDet) < 0.0001) throw new Error('Referenzpunkte zu nah beieinander oder auf einer Linie; weit auseinanderliegende Punkte wählen');
  const solve = key => {
    const u = q[key] - p[key], v = r[key] - p[key];
    const a = (u * z2 - v * z1) / det, b = (x1 * v - x2 * u) / det;
    return [a, b, p[key] - a * p.gx - b * p.gz];
  };
  const affine = [...solve('ix'), ...solve('iy')];
  if (!affine.every(Number.isFinite)) throw new Error('Ungültige Kalibrierung');
  return affine;
}
module.exports = { affineFromPoints };
