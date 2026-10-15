'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerMaps, fit, apply, alignment } = require('../src/main/services/gaming/autoalign');
test('affine fitting composes points', () => {
  const a=fit([{sx:0,sy:0,tx:.2,ty:.1},{sx:1,sy:0,tx:.7,ty:.1},{sx:0,sy:1,tx:.2,ty:.9}]);
  assert.ok(Math.abs(apply(a,.5,.5)[0]-.45)<1e-8);
});
test('rejects unrelated images', () => {
  const make=(seed)=>{const data=new Uint8Array(120*120*4);for(let i=0;i<data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=seed&255;data[i+1]=(seed>>>8)&255;data[i+2]=(seed>>>16)&255;data[i+3]=255;}return {width:120,height:120,data};};
  assert.equal(registerMaps(make(1),make(1234)),null);
});
test('rejects clustered and insufficient correspondences',()=>{
  assert.equal(alignment(Array.from({length:11},(_,i)=>({sx:i/12,sy:i/12,tx:i/12,ty:i/12}))),null);
});
