import { useState, useEffect, useRef, useCallback } from "react";

const ZONE_W = 3200, WORLD_H = 3200, TRANSITION_W = 600;
const NUM_NODES_PER_ZONE = 80, TRAIL_MAX = 300, LIGHT_RADIUS = 160;
const SPHERE_SPEED = 1.8, LONG_PRESS_MS = 500, DOUBLE_TAP_MS = 280;
const STEER_STRENGTH = 0.032, ZOOM_NORMAL = 1.0, ZOOM_OUT = 0.32;
const PARTICLE_COUNT = 420, MAX_NODE_OSCS = 8;
const PENTATONIC = [130.81,155.56,174.61,196,220,261.63,311.13,349.23,392,440,523.25,622.25,698.46,783.99,880];

function hashNodeFreq(id) {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  return PENTATONIC[Math.abs(h) % PENTATONIC.length];
}

class HapticEngine {
  constructor() { this.supported = "vibrate" in navigator; this.muted = false; this._cd = {}; }
  _ok(key, ms) { const now = Date.now(); if (this._cd[key] && now - this._cd[key] < ms) return false; this._cd[key] = now; return true; }
  _v(p) { if (!this.supported || this.muted) return; try { navigator.vibrate(p); } catch(_){} }
  nodeTouch(id) { if (this._ok(`n_${id}`, 1200)) this._v(18); }
  satSpawn()    { if (this._ok("sat", 300))       this._v([12,60,18]); }
  orbitStart()  { if (this._ok("os", 800))        this._v(55); }
  orbitTick(sp) { const p = Math.max(180, Math.min(900, 1/Math.abs(sp)*8)); if (this._ok("ot", p)) this._v(10); }
  orbitRelease(){ this._v([8,40,8]); }
  zoomOut()     { this._v(35); }
  zoomIn()      { this._v([20,50,12]); }
  pressCharge(prog) { const s=Math.floor(prog*5); if (this._ok(`pc${s}`,80)) this._v([8,10,14,18,24][s]||8); }
  pressComplete(){ this._v([0,30,40,30,60]); }
  zoneUnlock()  { this._v([20,60,25,50,30,40,40,30,60]); }
  steer()       { if (this._ok("st", 120)) this._v(8); }
  setMuted(v)   { this.muted = v; if (v && this.supported) navigator.vibrate(0); }
}

class AudioEngine {
  constructor() { this.ctx=null; this.master=null; this.reverbIn=null; this.nodeOscs=new Map(); this.orbitNodes=null; this.pressNodes=null; this.muted=false; this.ready=false; }
  init() {
    if (this.ready) { this.ctx.resume(); return; }
    this.ctx = new (window.AudioContext||window.webkitAudioContext)();
    this.master = this.ctx.createGain(); this.master.gain.value=0.6; this.master.connect(this.ctx.destination);
    const delay=this.ctx.createDelay(1); delay.delayTime.value=0.29;
    const fb=this.ctx.createGain(); fb.gain.value=0.40;
    const lpf=this.ctx.createBiquadFilter(); lpf.type="lowpass"; lpf.frequency.value=4200;
    const wet=this.ctx.createGain(); wet.gain.value=0.20;
    const send=this.ctx.createGain();
    send.connect(delay); delay.connect(lpf); lpf.connect(fb); fb.connect(delay);
    delay.connect(wet); wet.connect(this.master); send.connect(this.master);
    this.reverbIn=send;
    const ag=this.ctx.createGain(); ag.gain.value=0.048; ag.connect(this.master);
    [{f:55,t:"sine",v:0.6},{f:55.18,t:"sine",v:0.55},{f:82.41,t:"sine",v:0.28},{f:110,t:"triangle",v:0.10}].forEach(({f,t,v})=>{
      const o=this.ctx.createOscillator(),g=this.ctx.createGain(); o.type=t; o.frequency.value=f; g.gain.value=v; o.connect(g); g.connect(ag); o.start();
    });
    this.ready=true;
  }
  setMuted(v) { this.muted=v; if(this.master) this.master.gain.setTargetAtTime(v?0:0.6,this.ctx.currentTime,0.4); }
  updateNodeTone(id,br) {
    if (!this.ready) return;
    const tgt=Math.min(br*0.085,0.085);
    if (!this.nodeOscs.has(id)) {
      if (tgt<0.004||this.nodeOscs.size>=MAX_NODE_OSCS) return;
      const o=this.ctx.createOscillator(),g=this.ctx.createGain(); o.type="sine"; o.frequency.value=hashNodeFreq(id); g.gain.value=0; o.connect(g); g.connect(this.reverbIn); o.start(); this.nodeOscs.set(id,{osc:o,gain:g});
    }
    const {gain}=this.nodeOscs.get(id); gain.gain.setTargetAtTime(tgt,this.ctx.currentTime,0.35);
    if (tgt<0.002) { const e=this.nodeOscs.get(id); this.nodeOscs.delete(id); e.gain.gain.setTargetAtTime(0,this.ctx.currentTime,0.5); setTimeout(()=>{try{e.osc.stop();}catch(_){}},2500); }
  }
  playSatSpawn(id) {
    if (!this.ready||this.muted) return;
    const f=hashNodeFreq(id)*2,o=this.ctx.createOscillator(),g=this.ctx.createGain(); o.type="sine";
    o.frequency.setValueAtTime(f*1.18,this.ctx.currentTime); o.frequency.exponentialRampToValueAtTime(f,this.ctx.currentTime+0.10);
    g.gain.setValueAtTime(0.075,this.ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001,this.ctx.currentTime+0.55);
    o.connect(g); g.connect(this.reverbIn); o.start(); o.stop(this.ctx.currentTime+0.6);
  }
  startOrbit(sp) {
    if (!this.ready||this.orbitNodes) return;
    const o=this.ctx.createOscillator(),lfo=this.ctx.createOscillator(),lg=this.ctx.createGain(),g=this.ctx.createGain();
    o.type="sine"; o.frequency.value=82.41; lfo.frequency.value=Math.min(Math.max(Math.abs(sp)*25,0.35),4); lg.gain.value=0.04; g.gain.value=0;
    g.gain.setTargetAtTime(0.08,this.ctx.currentTime,0.7); lfo.connect(lg); lg.connect(g.gain); o.connect(g); g.connect(this.reverbIn); o.start(); lfo.start();
    this.orbitNodes={osc:o,lfo,gain:g};
  }
  stopOrbit() {
    if (!this.orbitNodes) return; const n=this.orbitNodes; this.orbitNodes=null;
    n.gain.gain.setTargetAtTime(0,this.ctx.currentTime,0.45); setTimeout(()=>{try{n.osc.stop();n.lfo.stop();}catch(_){}},2200);
  }
  playZoneUnlock() {
    if (!this.ready) return;
    [261.63,329.63,392,523.25,659.25].forEach((f,i)=>{
      const o=this.ctx.createOscillator(),g=this.ctx.createGain(); o.type="sine"; o.frequency.value=f;
      const t=this.ctx.currentTime+i*0.10; g.gain.setValueAtTime(0,t); g.gain.linearRampToValueAtTime(0.09,t+0.04); g.gain.exponentialRampToValueAtTime(0.001,t+1.1);
      o.connect(g); g.connect(this.reverbIn); o.start(t); o.stop(t+1.2);
    });
  }
  _swoosh(f0,f1,dur) {
    if (!this.ready||this.muted) return;
    const n=Math.floor(this.ctx.sampleRate*dur),buf=this.ctx.createBuffer(1,n,this.ctx.sampleRate),d=buf.getChannelData(0);
    for(let i=0;i<n;i++) d[i]=Math.random()*2-1;
    const src=this.ctx.createBufferSource(); src.buffer=buf;
    const bpf=this.ctx.createBiquadFilter(); bpf.type="bandpass"; bpf.Q.value=4;
    bpf.frequency.setValueAtTime(f0,this.ctx.currentTime); bpf.frequency.exponentialRampToValueAtTime(f1,this.ctx.currentTime+dur);
    const g=this.ctx.createGain(); g.gain.setValueAtTime(0.14,this.ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001,this.ctx.currentTime+dur);
    src.connect(bpf); bpf.connect(g); g.connect(this.master); src.start();
  }
  playZoomOut() { this._swoosh(600,160,0.40); }
  playZoomIn()  { this._swoosh(180,720,0.32); }
  updatePressCharge(prog) {
    if (!this.ready||this.muted) return;
    if (prog>0.02&&!this.pressNodes) { const o=this.ctx.createOscillator(),g=this.ctx.createGain(); o.type="sine"; o.frequency.value=220; g.gain.value=0.01; o.connect(g); g.connect(this.master); o.start(); this.pressNodes={osc:o,gain:g}; }
    if (this.pressNodes) { this.pressNodes.osc.frequency.setTargetAtTime(220+prog*prog*680,this.ctx.currentTime,0.04); this.pressNodes.gain.gain.setTargetAtTime(0.01+prog*0.06,this.ctx.currentTime,0.04); }
  }
  releasePressCharge(done) {
    if (!this.pressNodes) return; const n=this.pressNodes; this.pressNodes=null;
    n.gain.gain.setTargetAtTime(0,this.ctx.currentTime,0.08); setTimeout(()=>{try{n.osc.stop();}catch(_){}},600);
    if (done) { const o=this.ctx.createOscillator(),g=this.ctx.createGain(); o.type="sine"; o.frequency.value=880; g.gain.setValueAtTime(0.09,this.ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001,this.ctx.currentTime+0.65); o.connect(g); g.connect(this.reverbIn); o.start(); o.stop(this.ctx.currentTime+0.7); }
  }
  destroy() { if(this.ctx) this.ctx.close(); }
}

function rand(a,b) { return a+Math.random()*(b-a); }
function makeParticle(ww,wh) {
  const l=Math.random(),r=l<0.6?rand(1.2,2.8):l<0.9?rand(2.5,5):rand(5,9);
  return {x:rand(0,ww),y:rand(0,wh),r,blurR:r*rand(2.5,4.5),vx:rand(-0.06,0.06),vy:l<0.6?rand(0.04,0.18):l<0.9?rand(0.08,0.28):rand(0.15,0.55),drift:rand(-0.015,0.015),hue:rand(200,240),sat:rand(5,22),opacity:l<0.6?rand(0.06,0.13):l<0.9?rand(0.07,0.16):rand(0.09,0.20),wobble:rand(0,Math.PI*2),wobbleSpeed:rand(0.005,0.025)};
}
function getThemeFactor(x) {
  const zi=Math.floor(x/ZONE_W),pos=x-zi*ZONE_W,tt=zi%2===0?0:1,nt=1-tt;
  if(pos<TRANSITION_W/2) return (1-tt)+(tt-(1-tt))*(pos/(TRANSITION_W/2));
  if(pos>ZONE_W-TRANSITION_W/2) return tt+(nt-tt)*((pos-(ZONE_W-TRANSITION_W/2))/(TRANSITION_W/2));
  return tt;
}
const themeBg=(t)=>`rgb(${Math.round(4+t*248)},${Math.round(4+t*248)},${Math.round(12+t*240)})`;
const themeNode=(h,l,a,t)=>`hsla(${h},${50-t*20}%,${l*(1-t)+(100-l)*t}%,${a})`;
const themeTrail=(a,t)=>{const v=Math.round(210*(1-t)+30*t);return `rgba(${v},${v-5},${Math.round(255*(1-t)+20*t)},${a*0.65})`;};
function genNodes(zi,n) { return Array.from({length:n},(_,i)=>({id:`z${zi}-${i}`,x:zi*ZONE_W+rand(60,ZONE_W-60),y:rand(60,WORLD_H-60),baseSize:rand(2.5,5.5),visits:0,brightness:0,pulsePhase:Math.random()*Math.PI*2,satellites:[],rangeReveal:0,hapticPlayed:false})); }
function spawnSat(n) { return {angle:Math.random()*Math.PI*2,dist:rand(18,32),brightness:0,size:n.baseSize*rand(0.3,0.55),pulsePhase:Math.random()*Math.PI*2,orbitSpeed:rand(0.003,0.008)*(Math.random()>0.5?1:-1),soundPlayed:false,hapticPlayed:false}; }
function genGhosts(nz) {
  return [{h:320,s:40,l:65},{h:170,s:35,l:60},{h:50,s:40,l:65},{h:270,s:35,l:65},{h:200,s:40,l:62}].map(col=>{
    const pts=[]; let x=rand(200,ZONE_W*nz-200),y=rand(200,WORLD_H-200),a=Math.random()*Math.PI*2;
    for(let i=0;i<2400;i++){if(i%rand(60,180)<1)a+=rand(-1,1);x+=Math.cos(a)*SPHERE_SPEED;y+=Math.sin(a)*SPHERE_SPEED;x=Math.max(0,Math.min(ZONE_W*nz,x));if(y<0)y+=WORLD_H;if(y>WORLD_H)y-=WORLD_H;pts.push({x,y});}
    return {pts,col,opacity:rand(0.05,0.12)};
  });
}

const IZ=2;

export default function App() {
  const canvasRef=useRef(null),audioRef=useRef(new AudioEngine()),hapticRef=useRef(new HapticEngine());
  const ghostPaths=useRef(genGhosts(IZ)),worldW=useRef(ZONE_W*IZ);
  const stateRef=useRef({
    sphere:{x:ZONE_W*0.3,y:WORLD_H/2},vel:{x:SPHERE_SPEED,y:SPHERE_SPEED*0.2},targetAngle:Math.atan2(0.2,1),
    trail:[],nodes:[...genNodes(0,NUM_NODES_PER_ZONE),...genNodes(1,NUM_NODES_PER_ZONE)],unlockedZones:IZ,
    time:0,orbit:null,cam:{x:ZONE_W*0.3,y:WORLD_H/2},zoom:ZOOM_NORMAL,zoomTarget:ZOOM_NORMAL,
    zoomedOut:false,orbitPreview:null,particles:Array.from({length:PARTICLE_COUNT},()=>makeParticle(ZONE_W*IZ,WORLD_H)),
    showGhosts:true,lastTapTime:0,lastTapPos:{x:0,y:0},pressStart:null,pressProgress:0,pressWorld:null,
    revealMode:false,themeFactor:0,prevOrbitActive:false,prevZoomedOut:false,
  });
  const animRef=useRef(null),pressTimerRef=useRef(null);
  const [showGhosts,setShowGhosts]=useState(true);
  const [muted,setMuted]=useState(false);
  const [hapticOn,setHapticOn]=useState(true);
  const [hapticSupported]=useState(()=>"vibrate" in navigator);
  const [stats,setStats]=useState({zone:1,orbiting:false,radius:0,zoomedOut:false,revealing:false,deepNodes:0});

  useEffect(()=>{ audioRef.current.setMuted(muted); },[muted]);
  useEffect(()=>{ hapticRef.current.setMuted(!hapticOn); },[hapticOn]);
  useEffect(()=>()=>audioRef.current.destroy(),[]);

  const initCanvas=useCallback(()=>{const c=canvasRef.current;if(!c)return;c.width=c.offsetWidth;c.height=c.offsetHeight;},[]);
  useEffect(()=>{initCanvas();window.addEventListener("resize",initCanvas);return()=>window.removeEventListener("resize",initCanvas);},[initCanvas]);
  useEffect(()=>{stateRef.current.showGhosts=showGhosts;},[showGhosts]);

  const toWorld=useCallback((cx,cy)=>{
    const s=stateRef.current,c=canvasRef.current;if(!c)return{x:0,y:0};
    const r=c.getBoundingClientRect();
    return{x:(cx-r.left-c.width/2)/s.zoom+s.cam.x,y:(cy-r.top-c.height/2)/s.zoom+s.cam.y};
  },[]);

  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const audio=audioRef.current,haptic=hapticRef.current;
    const ensure=()=>{if(!audio.ready)audio.init();};

    const tap=(cx,cy)=>{
      const s=stateRef.current,now=performance.now(),wp=toWorld(cx,cy);
      const dt=now-s.lastTapTime,dd=Math.hypot(wp.x-s.lastTapPos.x,wp.y-s.lastTapPos.y);
      s.lastTapTime=now;s.lastTapPos={x:wp.x,y:wp.y};
      if(dt<DOUBLE_TAP_MS&&dd<80){s.zoomedOut=!s.zoomedOut;s.zoomTarget=s.zoomedOut?ZOOM_OUT:ZOOM_NORMAL;if(!s.zoomedOut)s.orbitPreview=null;return;}
      if(s.zoomedOut){
        const dx=wp.x-s.sphere.x,dy=wp.y-s.sphere.y,r=Math.hypot(dx,dy);
        if(r>15){const sa=Math.atan2(s.sphere.y-wp.y,s.sphere.x-wp.x),cross=s.vel.x*dy-s.vel.y*dx;s.orbit={cx:wp.x,cy:wp.y,radius:Math.max(r,20),angle:sa,angularSpeed:(SPHERE_SPEED/Math.max(r,20))*(cross>=0?1:-1)};haptic.orbitStart();}
        s.zoomedOut=false;s.zoomTarget=ZOOM_NORMAL;s.orbitPreview=null;
      } else {
        if(s.orbit){s.orbit=null;haptic.orbitRelease();return;}
        const dx=wp.x-s.sphere.x,dy=wp.y-s.sphere.y;
        if(Math.hypot(dx,dy)<5)return;
        s.targetAngle=Math.atan2(dy,dx);haptic.steer();
      }
    };
    const move=(cx,cy)=>{const s=stateRef.current;if(!s.zoomedOut)return;const wp=toWorld(cx,cy),r=Math.hypot(wp.x-s.sphere.x,wp.y-s.sphere.y);s.orbitPreview=r>15?{wx:wp.x,wy:wp.y,radius:r}:null;};
    const startPress=(cx,cy)=>{ensure();const s=stateRef.current,wp=toWorld(cx,cy);s.pressStart={wx:wp.x,wy:wp.y,t:performance.now()};s.pressWorld={wx:wp.x,wy:wp.y};s.pressProgress=0;s.revealMode=false;pressTimerRef.current=setTimeout(()=>{const ss=stateRef.current;if(!ss.pressStart)return;ss.revealMode=true;ss.pressStart=null;ss.pressProgress=0;audio.releasePressCharge(true);haptic.pressComplete();},LONG_PRESS_MS);};
    const endPress=(cx,cy)=>{const s=stateRef.current;clearTimeout(pressTimerRef.current);const wr=s.revealMode;s.pressStart=null;s.pressProgress=0;s.revealMode=false;audio.releasePressCharge(false);if(!wr)tap(cx,cy);};

    const oMD=e=>startPress(e.clientX,e.clientY),oMU=e=>endPress(e.clientX,e.clientY),oMM=e=>move(e.clientX,e.clientY);
    const oTS=e=>{e.preventDefault();startPress(e.touches[0].clientX,e.touches[0].clientY);};
    const oTE=e=>{e.preventDefault();const t=e.changedTouches[0];endPress(t.clientX,t.clientY);};
    const oTM=e=>{e.preventDefault();move(e.touches[0].clientX,e.touches[0].clientY);};
    canvas.addEventListener("mousedown",oMD);canvas.addEventListener("mouseup",oMU);canvas.addEventListener("mousemove",oMM);
    canvas.addEventListener("touchstart",oTS,{passive:false});canvas.addEventListener("touchend",oTE,{passive:false});canvas.addEventListener("touchmove",oTM,{passive:false});
    return()=>{canvas.removeEventListener("mousedown",oMD);canvas.removeEventListener("mouseup",oMU);canvas.removeEventListener("mousemove",oMM);canvas.removeEventListener("touchstart",oTS);canvas.removeEventListener("touchend",oTE);canvas.removeEventListener("touchmove",oTM);clearTimeout(pressTimerRef.current);};
  },[toWorld]);

  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return;
    const ctx=canvas.getContext("2d"),audio=audioRef.current,haptic=hapticRef.current;
    let frame=0;
    const draw=()=>{
      const s=stateRef.current,cw=canvas.width,ch=canvas.height;
      if(!cw||!ch){animRef.current=requestAnimationFrame(draw);return;}
      s.time+=0.016;frame++;
      if(s.pressStart){s.pressProgress=Math.min(1,(performance.now()-s.pressStart.t)/LONG_PRESS_MS);if(audio.ready)audio.updatePressCharge(s.pressProgress);haptic.pressCharge(s.pressProgress);}
      s.zoom+=(s.zoomTarget-s.zoom)*0.08;
      if(s.zoomedOut!==s.prevZoomedOut){if(audio.ready){s.zoomedOut?audio.playZoomOut():audio.playZoomIn();}s.zoomedOut?haptic.zoomOut():haptic.zoomIn();s.prevZoomedOut=s.zoomedOut;}
      if(s.orbit){
        s.orbit.angle+=s.orbit.angularSpeed;s.sphere.x=s.orbit.cx+Math.cos(s.orbit.angle)*s.orbit.radius;s.sphere.y=s.orbit.cy+Math.sin(s.orbit.angle)*s.orbit.radius;
        const tang=s.orbit.angularSpeed>0?s.orbit.angle+Math.PI/2:s.orbit.angle-Math.PI/2;s.vel.x=Math.cos(tang)*SPHERE_SPEED;s.vel.y=Math.sin(tang)*SPHERE_SPEED;s.targetAngle=Math.atan2(s.vel.y,s.vel.x);
        haptic.orbitTick(s.orbit.angularSpeed);
      } else {
        const ca=Math.atan2(s.vel.y,s.vel.x);let diff=s.targetAngle-ca;while(diff>Math.PI)diff-=Math.PI*2;while(diff<-Math.PI)diff+=Math.PI*2;
        const na=ca+diff*STEER_STRENGTH;s.vel.x=Math.cos(na)*SPHERE_SPEED;s.vel.y=Math.sin(na)*SPHERE_SPEED;
        s.sphere.x+=s.vel.x;s.sphere.y+=s.vel.y;s.sphere.x=Math.max(0,Math.min(s.unlockedZones*ZONE_W,s.sphere.x));
        if(s.sphere.y<0)s.sphere.y+=WORLD_H;if(s.sphere.y>WORLD_H)s.sphere.y-=WORLD_H;
      }
      const on=!!s.orbit;if(on&&!s.prevOrbitActive&&audio.ready){audio.startOrbit(s.orbit.angularSpeed);s.prevOrbitActive=true;}else if(!on&&s.prevOrbitActive){audio.stopOrbit();s.prevOrbitActive=false;}
      if(s.sphere.x>s.unlockedZones*ZONE_W-TRANSITION_W){const zi=s.unlockedZones++;s.nodes.push(...genNodes(zi,NUM_NODES_PER_ZONE));worldW.current=s.unlockedZones*ZONE_W;for(let i=0;i<100;i++)s.particles.push(makeParticle(worldW.current,WORLD_H));if(audio.ready)audio.playZoneUnlock();haptic.zoneUnlock();ghostPaths.current=genGhosts(s.unlockedZones);}
      const t=Math.max(0,Math.min(1,s.themeFactor+=(getThemeFactor(s.sphere.x)-s.themeFactor)*0.015));
      s.trail.push({x:s.sphere.x,y:s.sphere.y,age:0});if(s.trail.length>TRAIL_MAX)s.trail.shift();s.trail.forEach(p=>p.age++);
      s.cam.x+=(s.sphere.x-s.cam.x)*0.08;s.cam.y+=(s.sphere.y-s.cam.y)*0.08;
      const wx=x=>(x-s.cam.x)*s.zoom+cw/2,wy=y=>(y-s.cam.y)*s.zoom+ch/2;
      const inV=(x,y,p=300)=>wx(x)>-p&&wx(x)<cw+p&&wy(y)>-p&&wy(y)<ch+p;
      let dc=0;
      s.nodes.forEach(n=>{
        const dx=s.sphere.x-n.x,dy=s.sphere.y-n.y,wdy=Math.abs(dy)<WORLD_H/2?dy:dy-Math.sign(dy)*WORLD_H,d=Math.hypot(dx,wdy);
        if(d<LIGHT_RADIUS){const tv=1-d/LIGHT_RADIUS;n.brightness=Math.min(1,n.brightness+(tv-n.brightness)*0.07);n.visits=Math.min(3,n.visits+0.003*tv);if(!n.hapticPlayed&&n.brightness>0.15){n.hapticPlayed=true;haptic.nodeTouch(n.id);}}
        else n.brightness=Math.max(0,n.brightness-0.018);
        n.pulsePhase+=0.018;
        const wr=s.revealMode||s.zoomedOut;n.rangeReveal+=wr?(1-n.rangeReveal)*0.07:(0-n.rangeReveal)*0.06;
        [0.8,1.6,2.5].forEach((th,idx)=>{if(n.satellites.length<=idx&&n.visits>=th)n.satellites.push(spawnSat(n));});
        n.satellites.forEach(sat=>{
          sat.angle+=sat.orbitSpeed;sat.pulsePhase+=0.025;
          sat.brightness=n.brightness>0.01?Math.min(n.brightness*0.75,sat.brightness+0.04):Math.max(0,sat.brightness-0.015);
          if(!sat.soundPlayed&&sat.brightness>0.01&&audio.ready){sat.soundPlayed=true;audio.playSatSpawn(n.id);}
          if(!sat.hapticPlayed&&sat.brightness>0.01){sat.hapticPlayed=true;haptic.satSpawn();}
        });
        if(n.visits>0.5)dc++;
      });
      if(frame%18===0&&audio.ready)s.nodes.forEach(n=>{if(n.brightness>0.001||audio.nodeOscs.has(n.id))audio.updateNodeTone(n.id,n.brightness);});
      s.particles.forEach(p=>{p.wobble+=p.wobbleSpeed;p.x+=p.vx+Math.sin(p.wobble)*0.04;p.y+=p.vy;p.x+=p.drift;if(p.y>WORLD_H){p.y=0;p.x=rand(0,worldW.current);}if(p.y<0)p.y=WORLD_H;if(p.x<0)p.x=worldW.current;if(p.x>worldW.current)p.x=0;});
      if(frame%60===0)setStats({zone:Math.floor(s.sphere.x/ZONE_W)+1,orbiting:!!s.orbit,radius:s.orbit?Math.round(s.orbit.radius):0,zoomedOut:s.zoomedOut,revealing:s.revealMode,deepNodes:dc});

      ctx.fillStyle=themeBg(t);ctx.fillRect(0,0,cw,ch);
      if(s.zoom<0.9){const zo=1-(s.zoom-ZOOM_OUT)/(ZOOM_NORMAL-ZOOM_OUT);ctx.fillStyle=`rgba(0,0,0,${zo*0.35})`;ctx.fillRect(0,0,cw,ch);}
      const gN=ctx.createRadialGradient(cw*0.35,ch*0.3,0,cw*0.35,ch*0.3,cw*0.7);gN.addColorStop(0,t<0.5?"rgba(16,6,35,0.35)":"rgba(200,190,240,0.18)");gN.addColorStop(1,"rgba(0,0,0,0)");ctx.fillStyle=gN;ctx.fillRect(0,0,cw,ch);
      for(let z=1;z<s.unlockedZones;z++){const bx=wx(z*ZONE_W);if(bx<-10||bx>cw+10)continue;ctx.beginPath();ctx.moveTo(bx,0);ctx.lineTo(bx,ch);ctx.strokeStyle="rgba(150,140,220,0.07)";ctx.lineWidth=1;ctx.setLineDash([8,12]);ctx.stroke();ctx.setLineDash([]);}
      s.particles.forEach(p=>{const sx=wx(p.x),sy=wy(p.y);if(sx<-p.blurR||sx>cw+p.blurR||sy<-p.blurR||sy>ch+p.blurR)return;const br=p.blurR*s.zoom,pg=ctx.createRadialGradient(sx,sy,0,sx,sy,br),l=t<0.5?rand(55,72):rand(28,45);pg.addColorStop(0,`hsla(${p.hue},${p.sat}%,${l}%,${p.opacity})`);pg.addColorStop(0.45,`hsla(${p.hue},${p.sat}%,${l}%,${p.opacity*0.35})`);pg.addColorStop(1,`hsla(${p.hue},${p.sat}%,${l}%,0)`);ctx.fillStyle=pg;ctx.beginPath();ctx.arc(sx,sy,br,0,Math.PI*2);ctx.fill();});
      if(s.showGhosts)ghostPaths.current.forEach(gh=>{const{pts,col,opacity}=gh;for(let i=6;i<pts.length;i+=6){const p=pts[i],pv=pts[i-6],sx=wx(p.x),sy=wy(p.y),px=wx(pv.x),py=wy(pv.y);if(sx<-60&&px<-60)continue;if(sx>cw+60&&px>cw+60)continue;const h=t<0.5?col.h:(col.h+180)%360,fade=Math.sin((i/pts.length)*Math.PI);ctx.beginPath();ctx.moveTo(px,py);ctx.lineTo(sx,sy);ctx.strokeStyle=`hsla(${h},${col.s}%,${col.l}%,${opacity*fade})`;ctx.lineWidth=1.2*s.zoom;ctx.lineCap="round";ctx.stroke();}});
      for(let i=1;i<s.trail.length;i++){const p=s.trail[i],prev=s.trail[i-1],prog=i/s.trail.length,alpha=prog*prog*Math.max(0,1-p.age/(TRAIL_MAX*0.75));if(alpha<0.004)continue;ctx.beginPath();ctx.moveTo(wx(prev.x),wy(prev.y));ctx.lineTo(wx(p.x),wy(p.y));ctx.strokeStyle=themeTrail(alpha,t);ctx.lineWidth=prog*2.2*Math.max(s.zoom,0.5);ctx.lineCap="round";ctx.stroke();}
      s.nodes.forEach(n=>{
        if(!inV(n.x,n.y,LIGHT_RADIUS*2))return;if(n.brightness<0.006&&n.rangeReveal<0.01&&n.satellites.every(s=>s.brightness<0.006))return;
        const sx=wx(n.x),sy=wy(n.y),pulse=Math.sin(n.pulsePhase)*0.12+0.88,size=n.baseSize*(1+n.visits*0.5)*pulse*s.zoom,hue=210+n.visits*35,lgt=65+n.visits*10,lr=LIGHT_RADIUS*s.zoom;
        if(n.rangeReveal>0.01){const rev=n.rangeReveal,rg=ctx.createRadialGradient(sx,sy,0,sx,sy,lr);rg.addColorStop(0,`hsla(${hue},50%,${lgt}%,${rev*0.05})`);rg.addColorStop(0.65,`hsla(${hue},50%,${lgt}%,${rev*0.025})`);rg.addColorStop(1,`hsla(${hue},50%,${lgt}%,0)`);ctx.fillStyle=rg;ctx.beginPath();ctx.arc(sx,sy,lr,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(sx,sy,lr,0,Math.PI*2);ctx.strokeStyle=`hsla(${hue},55%,${lgt}%,${rev*0.38})`;ctx.lineWidth=1.2;ctx.setLineDash([6,5]);ctx.stroke();ctx.setLineDash([]);if(n.brightness<0.01){ctx.beginPath();ctx.arc(sx,sy,Math.max(1.5,n.baseSize*0.4*s.zoom),0,Math.PI*2);ctx.fillStyle=`hsla(${hue},40%,${lgt}%,${rev*0.35})`;ctx.fill();}}
        if(s.zoomedOut&&n.brightness<0.1&&n.rangeReveal<0.01){ctx.beginPath();ctx.arc(sx,sy,Math.max(1.5,n.baseSize*0.35*s.zoom),0,Math.PI*2);ctx.fillStyle=`hsla(${hue},30%,${lgt}%,0.18)`;ctx.fill();}
        if(n.brightness>0.07){const gr=size*(4+n.visits*2),glow=ctx.createRadialGradient(sx,sy,0,sx,sy,gr);glow.addColorStop(0,themeNode(hue,lgt,n.brightness*0.35,t));glow.addColorStop(1,"rgba(0,0,0,0)");ctx.fillStyle=glow;ctx.beginPath();ctx.arc(sx,sy,gr,0,Math.PI*2);ctx.fill();}
        if(n.brightness>0.01){ctx.beginPath();ctx.arc(sx,sy,size,0,Math.PI*2);ctx.fillStyle=themeNode(hue,lgt,n.brightness,t);ctx.fill();}
        if(n.visits>1.2){ctx.beginPath();ctx.arc(sx,sy,size+(3+n.visits)*s.zoom,0,Math.PI*2);ctx.strokeStyle=themeNode(hue,80,(n.visits-1.2)*0.14*n.brightness,t);ctx.lineWidth=0.8;ctx.stroke();}
        n.satellites.forEach((sat,idx)=>{if(sat.brightness<0.01)return;const sax=sx+Math.cos(sat.angle)*sat.dist*s.zoom,say=sy+Math.sin(sat.angle)*sat.dist*s.zoom,ss=sat.size*(Math.sin(sat.pulsePhase)*0.15+0.85)*s.zoom,sh=hue+20+idx*15;ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(sax,say);ctx.strokeStyle=themeNode(sh,70,sat.brightness*0.2,t);ctx.lineWidth=0.6;ctx.stroke();const sg=ctx.createRadialGradient(sax,say,0,sax,say,ss*4);sg.addColorStop(0,themeNode(sh,75,sat.brightness*0.28,t));sg.addColorStop(1,"rgba(0,0,0,0)");ctx.fillStyle=sg;ctx.beginPath();ctx.arc(sax,say,ss*4,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(sax,say,ss,0,Math.PI*2);ctx.fillStyle=themeNode(sh,75,sat.brightness,t);ctx.fill();});
      });
      if(s.orbit){const ocx=wx(s.orbit.cx),ocy=wy(s.orbit.cy);ctx.beginPath();ctx.arc(ocx,ocy,3,0,Math.PI*2);ctx.fillStyle="rgba(180,170,255,0.4)";ctx.fill();ctx.beginPath();ctx.arc(ocx,ocy,s.orbit.radius*s.zoom,0,Math.PI*2);ctx.strokeStyle="rgba(160,150,240,0.14)";ctx.lineWidth=1;ctx.setLineDash([5,8]);ctx.stroke();ctx.setLineDash([]);}
      if(s.zoomedOut&&s.orbitPreview){const pcx=wx(s.orbitPreview.wx),pcy=wy(s.orbitPreview.wy),spx2=wx(s.sphere.x),spy2=wy(s.sphere.y);ctx.beginPath();ctx.arc(pcx,pcy,s.orbitPreview.radius*s.zoom,0,Math.PI*2);ctx.strokeStyle="rgba(180,170,255,0.3)";ctx.lineWidth=1.2;ctx.setLineDash([5,7]);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.arc(pcx,pcy,5,0,Math.PI*2);ctx.fillStyle="rgba(200,190,255,0.55)";ctx.fill();ctx.beginPath();ctx.moveTo(pcx,pcy);ctx.lineTo(spx2,spy2);ctx.strokeStyle="rgba(180,170,255,0.18)";ctx.lineWidth=0.8;ctx.stroke();}
      if(s.pressStart&&s.pressWorld&&!s.revealMode){const pcx=wx(s.pressWorld.wx),pcy=wy(s.pressWorld.wy),prog=s.pressProgress;ctx.beginPath();ctx.arc(pcx,pcy,12,-Math.PI/2,-Math.PI/2+prog*Math.PI*2);ctx.strokeStyle=`rgba(200,190,255,${0.3+prog*0.5})`;ctx.lineWidth=2;ctx.stroke();ctx.beginPath();ctx.arc(pcx,pcy,3+prog*2,0,Math.PI*2);ctx.fillStyle=`rgba(210,200,255,${0.3+prog*0.5})`;ctx.fill();}
      const spx=wx(s.sphere.x),spy_=wy(s.sphere.y),gL=ctx.createRadialGradient(spx,spy_,0,spx,spy_,LIGHT_RADIUS*s.zoom);gL.addColorStop(0,t<0.5?"rgba(175,165,255,0.07)":"rgba(20,15,80,0.07)");gL.addColorStop(1,"rgba(0,0,0,0)");ctx.fillStyle=gL;ctx.beginPath();ctx.arc(spx,spy_,LIGHT_RADIUS*s.zoom,0,Math.PI*2);ctx.fill();
      const ssz=(7+Math.sin(s.time*2)*0.5)*s.zoom,gs=ctx.createRadialGradient(spx-ssz*0.3,spy_-ssz*0.3,0,spx,spy_,ssz*1.6);gs.addColorStop(0,t<0.5?"rgba(255,255,255,1)":"rgba(30,20,100,1)");gs.addColorStop(0.4,t<0.5?"rgba(220,215,255,0.95)":"rgba(60,50,180,0.95)");gs.addColorStop(1,"rgba(0,0,0,0)");ctx.fillStyle=gs;ctx.beginPath();ctx.arc(spx,spy_,ssz*1.6,0,Math.PI*2);ctx.fill();ctx.beginPath();ctx.arc(spx,spy_,ssz,0,Math.PI*2);ctx.fillStyle=t<0.5?"rgba(255,255,255,0.97)":`rgba(${Math.round(255-t*200)},${Math.round(255-t*200)},${Math.round(255-t*180)},0.97)`;ctx.fill();
      animRef.current=requestAnimationFrame(draw);
    };
    animRef.current=requestAnimationFrame(draw);
    return()=>cancelAnimationFrame(animRef.current);
  },[]);

  const tc=stats.zone%2===1?"rgba(180,170,255,0.35)":"rgba(50,40,150,0.55)";
  const td=stats.zone%2===1?"rgba(150,140,210,0.22)":"rgba(40,30,130,0.38)";

  return (
    <div style={{width:"100%",height:"100vh",display:"flex",flexDirection:"column",fontFamily:"'Courier New',monospace",userSelect:"none",position:"relative"}}>
      <canvas ref={canvasRef} style={{flex:1,width:"100%",cursor:stats.zoomedOut?"crosshair":"default",touchAction:"none"}}/>
      <div style={{position:"absolute",top:14,left:16,display:"flex",flexDirection:"column",gap:"4px"}}>
        <span style={{color:tc,fontSize:"10px",letterSpacing:"0.13em"}}>{stats.zoomedOut?"◎ 줌아웃 — 탭으로 공전 축 설정":stats.orbiting?`⟳ 공전  r=${stats.radius}`:"→ 이동 중"}</span>
        <span style={{color:td,fontSize:"10px"}}>구역 {stats.zone}</span>
        {stats.revealing&&<span style={{color:tc,fontSize:"10px"}}>◎ 범위 확인 중</span>}
      </div>
      <div style={{position:"absolute",top:14,right:16,display:"flex",flexDirection:"column",gap:"6px",alignItems:"flex-end"}}>
        <button onClick={()=>setMuted(m=>!m)} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 0",color:muted?"rgba(120,110,180,0.35)":tc,fontSize:"10px",letterSpacing:"0.10em",fontFamily:"inherit"}}>{muted?"♪ 음소거":"♪ 소리 켜짐"}</button>
        {hapticSupported&&<button onClick={()=>setHapticOn(h=>!h)} style={{background:"none",border:"none",cursor:"pointer",padding:"2px 0",color:hapticOn?tc:"rgba(120,110,180,0.35)",fontSize:"10px",letterSpacing:"0.10em",fontFamily:"inherit"}}>{hapticOn?"〜 진동 켜짐":"〜 진동 꺼짐"}</button>}
        <label style={{display:"flex",alignItems:"center",gap:"7px",cursor:"pointer"}}><input type="checkbox" checked={showGhosts} onChange={e=>setShowGhosts(e.target.checked)} style={{accentColor:"#8877ee"}}/><span style={{color:td,fontSize:"10px"}}>다른 이들의 흔적</span></label>
        <span style={{color:td,fontSize:"10px"}}>깊이 알게 된 노드 {stats.deepNodes}</span>
      </div>
      <div style={{position:"absolute",bottom:16,left:"50%",transform:"translateX(-50%)",display:"flex",flexDirection:"column",alignItems:"center",gap:"4px",pointerEvents:"none"}}>
        <span style={{color:td,fontSize:"10px",letterSpacing:"0.12em",whiteSpace:"nowrap"}}>탭 → 방향 &nbsp;|&nbsp; 꾹 → 범위 확인 &nbsp;|&nbsp; 더블탭 → 줌아웃/공전</span>
      </div>
    </div>
  );
}
