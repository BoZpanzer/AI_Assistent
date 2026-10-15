'use strict';

/**
 * Conservative local alignment of two map images. No uploads or external CV service.
 * Images are already rasterized by Chromium to a maximum side of 520px.
 * Output is source-image normalized coordinates -> target-image normalized coordinates.
 * False matches fail closed: callers must keep their manual calibration fallback.
 */
function grayscale(image) {
  const { width: w, height: h, data } = image;
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 40 || h < 40 || w * h > 520 * 520 || !data || data.length !== w * h * 4) throw new Error('Ungültiges Kartenbild');
  const raw = new Uint8Array(w * h);
  for (let i = 0; i < raw.length; i++) {
    const j = i * 4, a = data[j + 3] / 255;
    raw[i] = Math.round((.299 * data[j] + .587 * data[j + 1] + .114 * data[j + 2]) * a + 255 * (1 - a));
  }
  const out = new Uint8Array(raw.length);
  // A tiny blur makes resampling and anti-aliasing less brittle.
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    out[i] = (raw[i-w-1]+raw[i-w]+raw[i-w+1]+raw[i-1]+raw[i]*2+raw[i+1]+raw[i+w-1]+raw[i+w]+raw[i+w+1]) / 10;
  }
  return { w, h, pixels: out };
}
function mirrored(image) {
  const out = new Uint8Array(image.w * image.h);
  for (let y = 0; y < image.h; y++) for (let x = 0; x < image.w; x++) out[y*image.w+x] = image.pixels[y*image.w+image.w-1-x];
  return { ...image, pixels: out };
}
const POP = (v) => { v -= (v >>> 1) & 0x55555555; v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24; };
const sample = (im, x, y) => im.pixels[Math.max(0,Math.min(im.h-1,Math.round(y)))*im.w+Math.max(0,Math.min(im.w-1,Math.round(x)))];
const pairs = (() => {
  let seed = 0x55ef17;
  const rng = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed / 4294967296) * 2 - 1; };
  return Array.from({ length: 128 }, () => [rng()*11,rng()*11,rng()*11,rng()*11]);
})();
function features(im) {
  const cand = [];
  const side = 18;
  // Select the strongest distributed corners rather than clustering on map text.
  for (let cy = 13; cy < im.h - 13; cy += side) for (let cx = 13; cx < im.w - 13; cx += side) {
    let best = null, score = 0;
    for (let y = cy; y < Math.min(cy+side,im.h-13); y += 2) for (let x = cx; x < Math.min(cx+side,im.w-13); x += 2) {
      const gx = sample(im,x+3,y) - sample(im,x-3,y);
      const gy = sample(im,x,y+3) - sample(im,x,y-3);
      const diagonal = Math.abs(sample(im,x+3,y+3)-sample(im,x-3,y-3)) + Math.abs(sample(im,x-3,y+3)-sample(im,x+3,y-3));
      const s = Math.min(Math.abs(gx),Math.abs(gy))*(Math.abs(gx)+Math.abs(gy)) + diagonal*20;
      if (s > score) { score = s; best = { x, y, score: s }; }
    }
    if (best && score > 180) cand.push(best);
  }
  return cand.sort((a,b)=>b.score-a.score).slice(0,310).map(({x,y}) => {
    let gx=0,gy=0;
    for(let dy=-4;dy<=4;dy+=2) for(let dx=-4;dx<=4;dx+=2) {
      gx += sample(im,x+dx+1,y+dy)-sample(im,x+dx-1,y+dy);
      gy += sample(im,x+dx,y+dy+1)-sample(im,x+dx,y+dy-1);
    }
    const angle=Math.atan2(gy,gx), c=Math.cos(angle),s=Math.sin(angle);
    const bits = new Uint32Array(4);
    for(let i=0;i<pairs.length;i++){
      const p=pairs[i];
      const v1=sample(im,x+p[0]*c-p[1]*s,y+p[0]*s+p[1]*c);
      const v2=sample(im,x+p[2]*c-p[3]*s,y+p[2]*s+p[3]*c);
      if(v1<v2) bits[i>>>5] |= (1<<(i&31));
    }
    return {x:x/(im.w-1),y:y/(im.h-1),bits};
  });
}
function distance(a,b) { return POP(a[0]^b[0])+POP(a[1]^b[1])+POP(a[2]^b[2])+POP(a[3]^b[3]); }
function correspondence(src,dst) {
  const matches = [];
  const reverse = new Int32Array(dst.length).fill(-1);
  const reverseD = new Int32Array(dst.length).fill(129);
  for(let i=0;i<src.length;i++){
    let best=129,second=129,which=-1;
    for(let j=0;j<dst.length;j++){
      const d=distance(src[i].bits,dst[j].bits);
      if(d<reverseD[j]){reverseD[j]=d;reverse[j]=i;}
      if(d<best){second=best;best=d;which=j;}
      else if(d<second)second=d;
    }
    if(which>=0 && best<=47 && best < second*.83) matches.push({i,j:which,d:best});
  }
  return matches.filter(m=>reverse[m.j]===m.i).sort((a,b)=>a.d-b.d)
    .map(m=>({sx:src[m.i].x,sy:src[m.i].y,tx:dst[m.j].x,ty:dst[m.j].y}));
}
function solve3(m,v) {
  const a = m.map((r,i)=>[...r,v[i]]);
  for(let i=0;i<3;i++){
    let b=i;for(let j=i+1;j<3;j++)if(Math.abs(a[j][i])>Math.abs(a[b][i]))b=j;
    if(Math.abs(a[b][i])<1e-9)return null;
    [a[b],a[i]]=[a[i],a[b]];
    const scale=a[i][i];for(let k=i;k<4;k++)a[i][k]/=scale;
    for(let j=0;j<3;j++)if(j!==i){const f=a[j][i];for(let k=i;k<4;k++)a[j][k]-=f*a[i][k];}
  }
  return a.map(r=>r[3]);
}
function fit(pts) {
  if(pts.length<3)return null;
  const m=[[0,0,0],[0,0,0],[0,0,0]],x=[0,0,0],y=[0,0,0];
  for(const p of pts){
    const v=[p.sx,p.sy,1];
    for(let i=0;i<3;i++){
      x[i]+=v[i]*p.tx;y[i]+=v[i]*p.ty;
      for(let j=0;j<3;j++)m[i][j]+=v[i]*v[j];
    }
  }
  const ax=solve3(m,x),ay=solve3(m,y);
  return ax && ay ? [...ax,...ay] : null;
}
function apply(a,x,y) {return [a[0]*x+a[1]*y+a[2],a[3]*x+a[4]*y+a[5]];}
function plausible(a) {
  if(!a || !a.every(Number.isFinite))return false;
  const det=Math.abs(a[0]*a[4]-a[1]*a[3]);
  if(det<.06 || det>8)return false;
  const edges=[[0,0],[1,0],[0,1],[1,1]].map(p=>apply(a,...p));
  const inside=edges.filter(([x,y])=>x>=-.55&&x<=1.55&&y>=-.55&&y<=1.55).length;
  return inside>=3;
}
function alignment(matches) {
  if(matches.length<12)return null;
  let best=null;
  // Deterministic RANSAC: at most 540 models, reject collinear triplets.
  let seed=0xc0ffee;
  const rand=(n)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  for(let k=0;k<540;k++){
    const ids=new Set();while(ids.size<3)ids.add(rand(matches.length));
    const tri=[...ids].map(i=>matches[i]);
    const a=fit(tri);
    if(!plausible(a))continue;
    const inliers=matches.filter(p=>{const [x,y]=apply(a,p.sx,p.sy);return Math.hypot(x-p.tx,y-p.ty)<.016;});
    if(!best || inliers.length>best.length)best=inliers;
  }
  if(!best || best.length<12 || best.length/matches.length<.48)return null;
  let a=fit(best);
  if(!plausible(a))return null;
  const kept=matches.filter(p=>{const [x,y]=apply(a,p.sx,p.sy);return Math.hypot(x-p.tx,y-p.ty)<.012;});
  if(kept.length<12 || kept.length/matches.length<.45)return null;
  a=fit(kept);if(!plausible(a))return null;
  const errors=kept.map(p=>{const [x,y]=apply(a,p.sx,p.sy);return Math.hypot(x-p.tx,y-p.ty);}).sort((x,y)=>x-y);
  const xs=kept.map(p=>p.sx),ys=kept.map(p=>p.sy);
  const spread=Math.min(Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys));
  const median=errors[Math.floor(errors.length/2)];
  if(spread<.28 || median>.007) return null;
  return {affine:a,quality:{inliers:kept.length,candidates:matches.length,medianError:median,spread}};
}
/** Only return a transform when many independent landmark matches agree. */
function registerMaps(source,target) {
  const s=features(grayscale(source));
  const base=grayscale(target);
  let best=null;
  for(const flip of [false,true]){
    const d=features(flip?mirrored(base):base);
    const m=correspondence(s,d).map(p=>flip?{...p,tx:1-p.tx}:p);
    const r=alignment(m);
    if(r && (!best || r.quality.inliers>best.quality.inliers))best=r;
  }
  return best;
}
module.exports={registerMaps,apply,fit,alignment};
