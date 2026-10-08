// Lightweight procedural 3D sign avatar for SignBridge.
// This is a browser-only demo rig; replace the gesture library with a
// validated sign-language motion-capture/GLB model for production use.

let THREE = null;

const GESTURES = {
  hello:      { hand: 'open',  wave: true,  speed: 1.15 },
  hi:         { hand: 'open',  wave: true,  speed: 1.15 },
  thank:      { hand: 'flat',  nearFace: true, forward: true, speed: 1 },
  thanks:     { hand: 'flat',  nearFace: true, forward: true, speed: 1 },
  you:        { hand: 'point', forward: true, speed: 1 },
  i:          { hand: 'point', self: true, speed: 1 },
  me:         { hand: 'point', self: true, speed: 1 },
  good:       { hand: 'thumb', down: true, speed: 1 },
  yes:        { hand: 'fist', nod: true, speed: 1.2 },
  no:         { hand: 'two', side: true, speed: 1.15 },
  help:       { hand: 'open', lift: true, speed: 1 },
  water:      { hand: 'w', nearFace: true, speed: 1 },
  please:     { hand: 'flat', circle: true, speed: .9 },
  stop:       { hand: 'open', forward: true, speed: 1 },
  welcome:    { hand: 'open', sweep: true, speed: .9 },
  class:      { hand: 'flat', both: true, circle: true, speed: .9 },
  understand:{ hand: 'point', temple: true, speed: 1 },
  repeat:     { hand: 'two', circle: true, speed: .9 },
  today:      { hand: 'flat', both: true, down: true, speed: 1 },
};

function makeRig() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x7c5cff, roughness: .55, metalness: .05 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xf0b18a, roughness: .7 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x20263b, roughness: .7 });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.7, 1.2, 8, 16), mat);
  torso.position.y = 1.1; group.add(torso);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(.18, .2, .3, 16), skin); neck.position.y = 2; group.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.48, 24, 16), skin); head.position.y = 2.55; group.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(.49, 24, 12, 0, Math.PI * 2, 0, Math.PI * .55), dark); hair.position.set(0,2.72,0); group.add(hair);

  const eyeGeo = new THREE.SphereGeometry(.045, 8, 8);
  [-.16,.16].forEach(x => { const e = new THREE.Mesh(eyeGeo,dark); e.position.set(x,2.59,.44); group.add(e); });

  const armGeo = new THREE.CapsuleGeometry(.14,.65,6,10);
  const handGeo = new THREE.BoxGeometry(.34,.18,.28);
  const hands = [];
  const arms = [];
  [-1,1].forEach(side => {
    const shoulder = new THREE.Group(); shoulder.position.set(side*.63,1.65,0); group.add(shoulder);
    const upper = new THREE.Mesh(armGeo, mat); upper.rotation.z = side * -.12; upper.position.y = -.35; shoulder.add(upper);
    const elbow = new THREE.Group(); elbow.position.set(0,-.72,0); shoulder.add(elbow);
    const fore = new THREE.Mesh(armGeo, mat); fore.position.y = -.35; elbow.add(fore);
    const wrist = new THREE.Group(); wrist.position.set(0,-.72,0); elbow.add(wrist);
    const palm = new THREE.Mesh(handGeo, skin); palm.position.y = -.12; wrist.add(palm);
    const fingers = [];
    for(let i=0;i<5;i++) {
      const f = new THREE.Mesh(new THREE.CapsuleGeometry(.035,.22,4,6), skin);
      f.position.set((i-2)*.075,-.3,.03); wrist.add(f); fingers.push(f);
    }
    arms.push({ shoulder, elbow, wrist }); hands.push({ palm, fingers });
  });
  group.userData = { torso, head, arms, hands };
  return group;
}

export class SignAvatar {
  constructor(container) {
    this.container = container;
    this.ready = false;
    this.current = 'ready';
    this.duration = 1100;
    this.clock = null;
    this.queue = [];
    this.anim = null;
    this.init();
  }

  async init() {
    try {
      THREE = await import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js');
      this.scene = new THREE.Scene();
      this.scene.background = new THREE.Color(0x0e1220);
      this.camera = new THREE.PerspectiveCamera(32, 1, .1, 100);
      this.camera.position.set(0,1.55,6.2);
      this.renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
      this.renderer.setSize(this.container.clientWidth || 500, this.container.clientHeight || 430);
      this.container.innerHTML = '';
      this.container.appendChild(this.renderer.domElement);
      this.scene.add(new THREE.HemisphereLight(0xffffff,0x20253b,2.2));
      const key = new THREE.DirectionalLight(0xffffff,2.2); key.position.set(2,4,5); this.scene.add(key);
      const floor = new THREE.Mesh(new THREE.CircleGeometry(2.1,48), new THREE.MeshStandardMaterial({color:0x171d31,roughness:1}));
      floor.rotation.x=-Math.PI/2; floor.position.y=.02; this.scene.add(floor);
      this.rig = makeRig(); this.scene.add(this.rig);
      this.clock = new THREE.Clock(); this.ready = true;
      this.resize(); window.addEventListener('resize', this.resize);
      this.animate();
    } catch (e) {
      this.container.innerHTML = '<div class="avatar-fallback">3D avatar needs an internet connection to load its renderer.</div>';
    }
  }

  resize = () => { if(!this.renderer) return; const w=this.container.clientWidth||500,h=this.container.clientHeight||430; this.camera.aspect=w/h; this.camera.updateProjectionMatrix(); this.renderer.setSize(w,h); };

  animate = () => {
    requestAnimationFrame(this.animate);
    if(!this.renderer) return;
    const t = this.clock.getElapsedTime();
    this.rig.position.y = Math.sin(t*1.2)*.025;
    if(this.anim) this.applyAnim(t);
    this.renderer.render(this.scene,this.camera);
  };

  resetPose() {
    const {arms,head,hands}=this.rig.userData;
    arms.forEach((a,i)=>{ a.shoulder.rotation.set(0,0,i===0?.25:-.25); a.elbow.rotation.set(0,0,0); a.wrist.rotation.set(0,0,0); });
    hands.forEach(h=>h.fingers.forEach((f)=>f.rotation.set(0,0,0)));
    head.rotation.set(0,0,0);
  }

  poseHand(hand, spec) {
    const open = spec.hand === 'open' || spec.hand === 'flat';
    hand.fingers.forEach((f,i)=>{
      if(spec.hand==='fist') f.rotation.z = .9;
      else if(spec.hand==='thumb') f.rotation.z = i===0 ? -.1 : .85;
      else if(spec.hand==='point') f.rotation.z = i===1 ? 0 : .85;
      else if(spec.hand==='two') f.rotation.z = i===1 || i===2 ? 0 : .85;
      else f.rotation.z = open ? 0 : .35;
    });
  }

  applyAnim(t) {
    const {arms,head,hands}=this.rig.userData; const a=this.anim; const p=(t-a.start)/a.duration; const x=Math.min(1,p); const wave=Math.sin(x*Math.PI*2); const side=arms[1], left=arms[0];
    this.resetPose();
    const spec=a.spec;
    this.poseHand(hands[0],spec); this.poseHand(hands[1],spec);
    if(spec.wave){ side.shoulder.rotation.z=-.9 + wave*.22; side.elbow.rotation.z=-.8; side.wrist.rotation.z=wave*.7; }
    if(spec.forward){ side.shoulder.rotation.x=-.45; side.shoulder.rotation.z=-.25; side.elbow.rotation.z=-.15; }
    if(spec.nearFace){ side.shoulder.rotation.x=-.9; side.elbow.rotation.z=-.35; }
    if(spec.self){ side.shoulder.rotation.z=.55; side.elbow.rotation.z=-.5; }
    if(spec.lift){ side.shoulder.rotation.x=-.8; side.elbow.rotation.z=.1; }
    if(spec.temple){ side.shoulder.rotation.x=-.95; side.elbow.rotation.z=-.4; side.wrist.rotation.z=.4; }
    if(spec.circle){ side.wrist.rotation.y=wave*.7; }
    if(spec.sweep){ side.shoulder.rotation.x=-.35; side.shoulder.rotation.z=-.7+wave*.4; }
    if(spec.down){ side.shoulder.rotation.x=.45; }
    if(spec.both){ left.shoulder.rotation.x=-.5; left.elbow.rotation.z=.3; side.shoulder.rotation.x=-.5; side.elbow.rotation.z=-.3; }
    if(spec.nod) head.rotation.x=Math.sin(x*Math.PI*2)*.18;
    if(x>=1) { this.anim=null; this.resetPose(); }
  }

  play(label) {
    if(!this.ready) { setTimeout(()=>this.play(label),120); return; }
    const key=String(label||'').toLowerCase().replace(/[^a-z]/g,'');
    const spec=GESTURES[key] || {hand:'open'};
    this.queue.push({label:key || label,spec});
    if(!this.anim) this.next();
  }

  next() {
    const item=this.queue.shift(); if(!item) return;
    this.current=item.label;
    this.anim={...item,start:this.clock.getElapsedTime(),duration:this.duration/(item.spec.speed||1)};
    this.onChange?.(this.current);
    setTimeout(()=>{ if(!this.anim || this.anim.label===item.label) this.next(); }, this.anim.duration+40);
  }

  setText(text) {
    const words=String(text||'').toLowerCase().match(/[a-z]+/g)||[];
    const supported=words.filter(w=>GESTURES[w]);
    if(!supported.length) {
      const fallback=words.slice(0,8); fallback.forEach(w=>this.play(w));
    } else supported.forEach(w=>this.play(w));
  }

  destroy(){ window.removeEventListener('resize',this.resize); this.renderer?.dispose(); this.container.innerHTML=''; }
}

export function hasAvatarGesture(word){ return !!GESTURES[String(word||'').toLowerCase().replace(/[^a-z]/g,'')]; }
