import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const modules = new Map();
async function load(url) {
  if (modules.has(url.href)) return modules.get(url.href);
  let code = stripTypeScriptTypes(await readFile(url, 'utf8'), { mode: 'transform' });
  const imports = [...code.matchAll(/from ['"](.\/[^'"]+)['"]/g)];
  for (const match of imports) {
    const dependency = await load(new URL(match[1] + '.ts', url));
    code = code.replace(match[0], `from '${dependency}'`);
  }
  const data = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  modules.set(url.href, data); return data;
}
const loadedImages=[];
globalThis.Image = class { complete = false; naturalWidth = 0; constructor(){loadedImages.push(this);} };
globalThis.window = { addEventListener() {} };
globalThis.document = { querySelectorAll: () => [] };
globalThis.requestAnimationFrame = () => {};
const { CourtyardGame } = await import(await load(new URL('../src/game.ts', import.meta.url)));
const canvas = { getContext: () => ({}), addEventListener() {} };
const appearances = { breed: '田园猫', coat: '奶油', colors: ['#e8c987','#fff0c9','#9b6c45'] };
const make = id => new CourtyardGame(canvas, { id, name: id, appearance: appearances }, new Proxy({}, { get: (target, key) => target[key] ?? (() => {}) }));
const a=make('A'), b=make('B');
for(const game of [a,b]) game.assignBeds(['A','B']);
const advance = game => { for(let i=0;i<300;i++) game.update(.05,i*50); };
let arrivals=0;
for(const cancel of [() => a.setActivity('sleep'), () => a.sleepInBed(), () => a.switchScene('cabin')]) {
  a.approachAnd(600,400,() => arrivals++); cancel(); a.setActivity('study'); advance(a);
}
assert.equal(arrivals,0,'cancelled arrival must never run at the next target');
for(const game of [a,b]) { game.switchScene('garden'); game.setActivity('toilet'); advance(game); assert.equal(game.getScene(),'yard'); }
for(const game of [a,b]) { game.setActivity('study'); advance(game); }
assert.notEqual(a.getSnapshot().x,b.getSnapshot().x,'study seats differ');
for(const game of [a,b]) { game.sleepInBed(); advance(game); }
assert.notEqual(a.getSnapshot().x,b.getSnapshot().x,'independent beds differ');
a.restoreHeadFlower('rose'); assert.equal(a.getSnapshot().headFlower,'rose');
a.approachAnd(300,300,() => arrivals++);
a.update(.05,performance.now(),10);a.update(.05,performance.now()+50);
assert.equal(arrivals,1,'throttled auto-walk reaches the target using elapsed time');
a.addOrUpdateRemote({...b.getSnapshot(),scene:'garden'});
const fresh=b.getSnapshot();
a.addOrUpdateRemote({...fresh,activity:'walk',updatedAt:fresh.updatedAt+100});
a.addOrUpdateRemote({...fresh,activity:'idle',updatedAt:fresh.updatedAt-100});
assert.equal(a.getRemoteActivity('B'),'walk','old presence cannot replace a newer activity');
a.addOrUpdateRemote({...fresh,scene:'garden',updatedAt:fresh.updatedAt+200});
const beforeNuzzle=a.getSnapshot().activity;
a.startNuzzle('B'); assert.equal(a.getSnapshot().activity,beforeNuzzle,'cross-scene nuzzle refused');
a.destroy();b.destroy();
const c=make('C'),d=make('D');
c.local.x=440; c.local.y=350; d.local.x=520; d.local.y=350;
assert.deepEqual(c.duetAnchor({x:806,y:432}),{x:480,y:350},'nuzzle must leave the litter tray');
c.callbacks.onActivity = snapshot => d.addOrUpdateRemote(snapshot);
d.callbacks.onActivity = snapshot => c.addOrUpdateRemote(snapshot);
c.callbacks.onMovement = snapshot => d.addOrUpdateRemote(snapshot);
d.callbacks.onMovement = snapshot => c.addOrUpdateRemote(snapshot);
c.addOrUpdateRemote(d.getSnapshot()); d.addOrUpdateRemote(c.getSnapshot());
c.startNuzzle('D',{x:480,y:350}); d.startNuzzle('C',{x:480,y:350});
const tick = count => { const start=performance.now(); for(let i=0;i<count;i++) {c.update(.05,start+i*50);d.update(.05,start+i*50);} };
tick(50);
assert.equal(c.getSnapshot().nuzzleWith,'D'); assert.equal(d.getSnapshot().nuzzleWith,'C');
assert.equal(c.getSnapshot().y,d.getSnapshot().y);
c.setActivity('study'); tick(1); assert.equal(d.getSnapshot().nuzzleWith,null,'peer movement ends nuzzle');
c.switchScene('yard');d.switchScene('yard');
c.startCosleep('D');d.acceptCosleep('C');tick(140);
assert.equal(c.getScene(),'cabin');assert.equal(d.getScene(),'cabin');
assert.equal(c.getSnapshot().cosleepWith,'D');assert.equal(d.getSnapshot().cosleepWith,'C');
assert.equal(Math.abs(c.getSnapshot().x-d.getSnapshot().x),56);
c.destroy();d.destroy();
const paints=[];
const drawContext=new Proxy({
  measureText: text => ({width:text.length*8}),
  createRadialGradient: () => ({addColorStop(){}}), createLinearGradient: () => ({addColorStop(){}}),
  fillText: (text,x,y) => paints.push({kind:'text',text,x,y}),
  rotate: angle => paints.push({kind:'rotation',angle}),
  fillRect: (x,y,w,h) => paints.push({kind:'rect',x,y,w,h,mode:drawContext.globalCompositeOperation}),
}, {get:(target,key)=>target[key]??(()=>{})});
const labelGame=new CourtyardGame({...canvas,getContext:()=>drawContext},{id:'L',name:'L',appearance:appearances},new Proxy({}, {get:()=>()=>{}}));
labelGame.local.x=480;labelGame.local.y=350;
labelGame.addOrUpdateRemote({...labelGame.getSnapshot(),id:'R',name:'很长的名字',x:480,y:350});
const {setTimeMode}=await import(await load(new URL('../src/daynight.ts',import.meta.url)));
setTimeMode('night');labelGame.draw();
const ownLabel=paints.find(p=>p.text==='你'),otherLabel=paints.find(p=>p.text==='很长的名字');
assert.ok(Math.abs(ownLabel.y-otherLabel.y)>=18,'overlapping labels must separate');
const nightLayer=paints.findIndex(p=>p.kind==='rect'&&p.w===960&&p.h===640&&p.mode==='multiply');
assert.ok(nightLayer>=0&&paints.indexOf(ownLabel)>nightLayer&&paints.indexOf(otherLabel)>nightLayer,'labels must remain above night lighting');
labelGame.destroy();
const {drawPlot,drawHeadFlower,drawDecorFlower,emptyPlot,PLOT_SPOTS}=await import(await load(new URL('../src/garden.ts',import.meta.url)));
paints.length=0;
drawPlot(drawContext,{...emptyPlot(0),flower:'rose',stage:4},PLOT_SPOTS[0],0);
const stems=paints.filter(p=>p.kind==='rect'&&p.w===3&&p.h===2);
assert.ok(stems.length>0&&stems.every(p=>p.y>=PLOT_SPOTS[0].y-40&&p.y<=PLOT_SPOTS[0].y),'grown flowers must render at their plot, not above the canvas');
for(const render of [
  time=>drawPlot(drawContext,{...emptyPlot(0),flower:'rose',stage:4},PLOT_SPOTS[0],time),
  time=>drawHeadFlower(drawContext,'rose',time),
  time=>drawDecorFlower(drawContext,'rose',190,348,time),
]) {
  const angles=[];
  for(let time=0;time<=6000;time+=16) {
    paints.length=0;render(time);angles.push(paints.find(p=>p.kind==='rotation').angle);
  }
  const deltas=angles.slice(1).map((angle,i)=>angle-angles[i]);
  assert.ok(deltas.every(delta=>Math.abs(delta)<.003),'flowers must sway gently between frames');
  assert.ok(deltas.slice(1).filter((delta,i)=>delta*deltas[i]<0).length<=3,'flowers must complete about one slow sway in six seconds');
}
const {drawCatSprite}=await import(await load(new URL('../src/cat-sprites.ts',import.meta.url)));
const samplePixels=new Uint8ClampedArray(64*64*4);
samplePixels.set([248,145,122,255,5,5,5,255,150,135,100,255]);
let recolored;
document.createElement=()=>({width:64,height:64,getContext:()=>new Proxy({getImageData:()=>({data:samplePixels}),putImageData:image=>{recolored=image.data;}},{get:(target,key)=>target[key]??(()=>{})})});
for(const image of loadedImages)if(image.src==='/assets/cat-atlas.png'){image.complete=true;image.naturalWidth=880;}
drawCatSprite(drawContext,{x:0,y:0,activity:'idle',direction:'down',appearance:appearances},0);
assert.deepEqual([...recolored.slice(0,8)],[248,145,122,255,5,5,5,255],'fur recoloring must preserve warm pink ears and dark eyes');
assert.notDeepEqual([...recolored.slice(8,11)],[150,135,100],'fur must still recolor');
console.log('PASS: cancelled arrival, facility routing, separate seats/beds, equipped restore and scene guards');
