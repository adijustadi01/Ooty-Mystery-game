// Builds a playable 3D location from a case data file.
// Everything here is placeholder geometry: boxes, cylinders and spheres.
import * as THREE from '../lib/three.module.min.js';

const WALL_T = 0.15;          // thickness of each room's wall (rooms sit back to back)
const DEG = Math.PI / 180;

const matCache = new Map();
function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshLambertMaterial({ color, ...opts }));
  return matCache.get(key);
}
function shade(color, f) {
  const c = new THREE.Color(color);
  c.multiplyScalar(f);
  return '#' + c.getHexString();
}

// ---------- procedural textures ----------
function floorTexture(color, style) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  const base = new THREE.Color(color);
  g.fillStyle = '#' + base.getHexString();
  g.fillRect(0, 0, 256, 256);
  if (style === 'wood') {
    const rows = 8;
    for (let r = 0; r < rows; r++) {
      const off = (r % 2) * 96;
      for (let x = -off; x < 256; x += 192) {
        const c = base.clone().multiplyScalar(0.85 + Math.random() * 0.3);
        g.fillStyle = '#' + c.getHexString();
        g.fillRect(x + 1, r * 32 + 1, 190, 30);
      }
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, r * 32, 256, 2);
    }
  } else if (style === 'stone') {
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const c = base.clone().multiplyScalar(0.85 + Math.random() * 0.25);
      g.fillStyle = '#' + c.getHexString();
      g.fillRect(x * 64 + 2, y * 64 + 2, 60, 60);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function labelSprite(text, sub) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = 'rgba(15,12,8,0.72)';
  g.beginPath();
  if (g.roundRect) g.roundRect(8, 8, 496, 112, 22); else g.rect(8, 8, 496, 112);
  g.fill();
  g.strokeStyle = 'rgba(214,180,110,0.8)'; g.lineWidth = 3; g.stroke();
  g.fillStyle = '#f3e6c4';
  g.textAlign = 'center';
  g.font = 'bold 44px Georgia, serif';
  g.fillText(text, 256, sub ? 60 : 78);
  if (sub) { g.font = 'italic 28px Georgia, serif'; g.fillStyle = '#c9b184'; g.fillText(sub, 256, 100); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(1.5, 0.375, 1);
  sp.raycast = () => {};
  return sp;
}

// ---------- primitive helpers ----------
function box(w, h, d, color, x = 0, y = 0, z = 0, m) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m || mat(color));
  mesh.position.set(x, y + h / 2, z);
  return mesh;
}
function cyl(rt, rb, h, color, x = 0, y = 0, z = 0, seg = 16, m) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m || mat(color));
  mesh.position.set(x, y + h / 2, z);
  return mesh;
}
function sphere(r, color, x = 0, y = 0, z = 0, m) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), m || mat(color));
  mesh.position.set(x, y, z);
  return mesh;
}

// ---------- furniture templates (front faces +z, origin at floor centre) ----------
const TEMPLATES = {
  box: (w, h, d, c) => [box(w, h, d, c)],
  cylinder: (w, h, d, c) => [cyl(w / 2, w / 2, h, c)],
  sphere: (w, h, d, c) => [sphere(w / 2, c, 0, w / 2, 0)],
  cone: (w, h, d, c) => [new THREE.Mesh(new THREE.ConeGeometry(w / 2, h, 16), mat(c)).translateY(h / 2)],
  rug: (w, h, d, c) => [box(w, 0.02, d, c), box(w * 0.85, 0.022, d * 0.8, shade(c, 1.35))],
  outline: (w, h, d, c) => [box(w, 0.012, 0.08, c, 0, 0, d / 2), box(w, 0.012, 0.08, c, 0, 0, -d / 2),
    box(0.08, 0.012, d, c, w / 2), box(0.08, 0.012, d, c, -w / 2), box(0.35, 0.012, 0.35, c, w / 2 + 0.2)],
  table: (w, h, d, c) => {
    const t = 0.06, l = 0.07, parts = [box(w, t, d, c, 0, h - t, 0)];
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      parts.push(box(l, h - t, l, shade(c, 0.8), sx * (w / 2 - 0.1), 0, sz * (d / 2 - 0.1)));
    return parts;
  },
  desk: (w, h, d, c) => [box(w, 0.07, d, c, 0, h - 0.07),
    box(w * 0.3, h - 0.07, d * 0.9, shade(c, 0.85), -w * 0.33), box(w * 0.3, h - 0.07, d * 0.9, shade(c, 0.85), w * 0.33),
    box(0.25, 0.12, 0.25, '#2a3a2a', -w * 0.38, h, -d * 0.2), cyl(0.02, 0.02, 0.35, '#b08d4a', -w * 0.38, h + 0.12, -d * 0.2),
    new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.16, 12, 1, true), new THREE.MeshBasicMaterial({ color: '#3f7a4a', side: THREE.DoubleSide }))
      .translateX(-w * 0.38).translateY(h + 0.52).translateZ(-d * 0.2)],
  chair: (w, h, d, c) => {
    const seat = 0.46, parts = [box(w, 0.06, d, c, 0, seat - 0.06), box(w, h - seat, 0.06, c, 0, seat, -d / 2 + 0.03)];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(box(0.05, seat - 0.06, 0.05, shade(c, 0.8), sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05)));
    return parts;
  },
  bench: (w, h, d, c) => [box(w, 0.07, d, c, 0, 0.42), box(w, h - 0.49, 0.06, c, 0, 0.49, -d / 2 + 0.03),
    box(0.08, 0.42, d * 0.9, '#2a2a2a', -w / 2 + 0.1), box(0.08, 0.42, d * 0.9, '#2a2a2a', w / 2 - 0.1)],
  sofa: (w, h, d, c) => [box(w, 0.42, d, c), box(w, h - 0.42, 0.22, c, 0, 0.42, -d / 2 + 0.11),
    box(0.2, 0.25, d, shade(c, 0.9), -w / 2 + 0.1, 0.42), box(0.2, 0.25, d, shade(c, 0.9), w / 2 - 0.1, 0.42),
    box(w - 0.5, 0.1, d - 0.3, shade(c, 1.15), 0, 0.42, 0.1)],
  armchair: (w, h, d, c) => TEMPLATES.sofa(w, h, d, c),
  bookshelf: (w, h, d, c) => {
    const parts = [box(w, h, 0.04, c, 0, 0, -d / 2 + 0.02), box(0.05, h, d, c, -w / 2), box(0.05, h, d, c, w / 2)];
    const shelves = Math.max(3, Math.round(h / 0.5));
    const palette = ['#6a1a1a', '#1a3a5a', '#2a4a2a', '#7a5a2a', '#3a2a4a', '#8a6a4a'];
    for (let i = 0; i <= shelves; i++) {
      const y = (h - 0.05) * i / shelves;
      parts.push(box(w, 0.04, d, c, 0, y));
      if (i === shelves) break;
      let x = -w / 2 + 0.08;
      while (x < w / 2 - 0.12) {
        const bw = 0.05 + Math.random() * 0.06, bh = 0.25 + Math.random() * 0.15;
        parts.push(box(bw, bh, d * 0.75, palette[(Math.random() * palette.length) | 0], x + bw / 2, y + 0.04, 0));
        x += bw + 0.005;
      }
    }
    return parts;
  },
  cabinet: (w, h, d, c) => [box(w, h, d, c), box(w + 0.04, 0.04, d + 0.04, shade(c, 0.7), 0, h),
    box(w * 0.45, h * 0.7, 0.02, shade(c, 1.2), -w * 0.24, h * 0.15, d / 2), box(w * 0.45, h * 0.7, 0.02, shade(c, 1.2), w * 0.24, h * 0.15, d / 2)],
  clock: (w, h, d, c) => [box(w, h, d, c), box(w * 0.8, w * 0.8, 0.02, '#efe6cc', 0, h - w * 0.95, d / 2),
    box(0.03, w * 0.3, 0.01, '#111', 0, h - w * 0.6, d / 2 + 0.015), box(w * 0.3, h * 0.35, 0.02, '#b08d4a', 0, h * 0.2, d / 2)],
  lamp: (w, h, d, c) => [cyl(w * 0.3, w * 0.4, 0.05, '#222'), cyl(0.025, 0.025, h - 0.3, '#333', 0, 0.05),
    new THREE.Mesh(new THREE.CylinderGeometry(w * 0.3, w * 0.5, 0.35, 16, 1, true), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })).translateY(h - 0.15)],
  door: (w, h, d, c) => [box(w, h, d, c), box(w * 0.4, h * 0.38, 0.02, shade(c, 1.3), -w * 0.22, h * 0.52, d / 2), box(w * 0.4, h * 0.38, 0.02, shade(c, 1.3), w * 0.22, h * 0.52, d / 2),
    sphere(0.04, '#d4af37', w * 0.4, h * 0.45, d / 2 + 0.03), box(w + 0.16, 0.1, d + 0.04, shade(c, 0.7), 0, h)],
  painting: (w, h, d, c) => [box(w, h, d, '#6a4a1a'), box(w - 0.12, h - 0.12, 0.02, c, 0, 0.06, d / 2)],
  plant: (w, h, d, c) => [cyl(w * 0.35, w * 0.25, h * 0.3, '#8a4a2a'), sphere(w * 0.5, c, 0, h * 0.62), sphere(w * 0.35, shade(c, 1.2), w * 0.2, h * 0.85)],
  fireplace: (w, h, d, c, g, w2) => {
    const parts = [box(w, h, d, c), box(w * 0.6, h * 0.55, 0.02, '#0e0a08', 0, 0.1, d / 2), box(w + 0.2, 0.1, d + 0.15, shade(c, 0.8), 0, h)];
    const ember = box(w * 0.4, 0.12, 0.2, '#ff6a1a', 0, 0.12, d / 2 - 0.05, new THREE.MeshBasicMaterial({ color: '#ff6a1a' }));
    parts.push(ember);
    const light = new THREE.PointLight('#ff8a3a', 4, 6, 1.6);
    light.position.set(0, 0.6, d / 2 + 0.4);
    parts.push(light);
    w2.flickers.push({ light, base: 4, ember });
    return parts;
  },
  stove: (w, h, d, c, g, w2) => {
    const parts = [box(w, h, d, c), cyl(0.09, 0.09, 2.4, '#151515', w * 0.3, h, -d * 0.25), box(w * 0.35, h * 0.3, 0.02, '#ff5a10', -w * 0.15, h * 0.25, d / 2, new THREE.MeshBasicMaterial({ color: '#ff5a10' }))];
    const light = new THREE.PointLight('#ff7a2a', 2.5, 4, 1.6);
    light.position.set(-w * 0.15, h * 0.4, d / 2 + 0.4);
    parts.push(light);
    w2.flickers.push({ light, base: 2.5 });
    return parts;
  }
};

// ---------- small clue shapes ----------
const CLUE_SHAPES = {
  paper: (c) => [box(0.28, 0.01, 0.2, c)],
  slate: (c) => [box(0.4, 0.03, 0.3, '#6a4a2a'), box(0.36, 0.035, 0.26, c)],
  book: (c) => [box(0.32, 0.07, 0.24, c), box(0.3, 0.06, 0.005, '#eee6d0', 0.005, 0.005, 0.12)],
  glass: (c) => [cyl(0.05, 0.035, 0.09, c, 0, 0.03, 0, 16, new THREE.MeshLambertMaterial({ color: c, transparent: true, opacity: 0.75 })), cyl(0.008, 0.008, 0.03, '#ddd'), cyl(0.035, 0.035, 0.005, '#ddd')],
  bottle: (c) => [cyl(0.07, 0.07, 0.2, c, 0, 0, 0, 16, new THREE.MeshLambertMaterial({ color: c, transparent: true, opacity: 0.85 })), cyl(0.025, 0.03, 0.08, c, 0, 0.2)],
  watch: (c) => [cyl(0.06, 0.06, 0.02, c), cyl(0.05, 0.05, 0.022, '#f4eedc'), new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.006, 6, 12), mat(c)).translateZ(-0.075).translateY(0.01).rotateX(Math.PI / 2)],
  bag: (c) => [box(0.5, 0.28, 0.25, c), cyl(0.125, 0.125, 0.5, shade(c, 1.1), 0, 0.15, 0, 12).rotateZ(Math.PI / 2), new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.015, 6, 12, Math.PI), mat('#111')).translateY(0.4)],
  umbrella: (c) => { const u = new THREE.Group(); u.add(cyl(0.012, 0.012, 0.9, '#5a3a1a'), new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.65, 10), mat(c)).translateY(0.5)); u.rotation.z = 0.25; return [u]; },
  lantern: (c) => [cyl(0.08, 0.1, 0.03, c), cyl(0.06, 0.06, 0.16, '#ffd27a', 0, 0.03, 0, 12, new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.8 })), cyl(0.05, 0.08, 0.05, c, 0, 0.19), box(0.25, 0.05, 0.18, c, 0.22, 0, 0)],
  necklace: (c) => [new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.015, 8, 24), mat(c, { emissive: c, emissiveIntensity: 0.3 })).rotateX(Math.PI / 2).translateZ(-0.02), sphere(0.03, c, 0, 0.02, 0.11)]
};

// ---------- the world ----------
export class World {
  constructor(scene) {
    this.scene = scene;
    this.root = null;
  }

  build(data) {
    this.dispose();
    this.data = data;
    const root = this.root = new THREE.Group();
    this.scene.add(root);
    this.colliders = [];
    this.interactables = [];
    this.clueObjects = new Map();
    this.suspectObjects = new Map();
    this.flickers = [];
    this.pulses = [];
    this.glass = [];
    this.rooms = [];
    this.flash = 0;
    this.nextFlash = 6 + Math.random() * 8;

    const s = data.setting || {};
    this.setting = s;
    this.scene.background = new THREE.Color(s.skyColor || '#1a2028');
    this.scene.fog = new THREE.Fog(s.fogColor || '#1a2028', s.fogNear ?? 5, s.fogFar ?? 35);

    this.hemi = new THREE.HemisphereLight('#b8c8e0', '#3a2a1a', s.ambient ?? 0.6);
    this.ambientBase = s.ambient ?? 0.6;
    root.add(this.hemi);

    const bounds = new THREE.Box2(new THREE.Vector2(Infinity, Infinity), new THREE.Vector2(-Infinity, -Infinity));
    for (const r of data.rooms) {
      this.buildRoom(r);
      bounds.expandByPoint(new THREE.Vector2(r.center[0] - r.size[0] / 2, r.center[1] - r.size[1] / 2));
      bounds.expandByPoint(new THREE.Vector2(r.center[0] + r.size[0] / 2, r.center[1] + r.size[1] / 2));
    }
    this.bounds = bounds;

    // exterior ground
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat(s.groundColor || '#1f2a1c'));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    root.add(ground);

    for (const c of data.clues || []) this.buildClue(c);
    for (const sp of data.suspects || []) this.buildSuspect(sp);
    this.buildWeather(s);
  }

  room(id) { return this.rooms.find(r => r.id === id); }

  // Convert room-local [x, z] into world coordinates.
  toWorld(roomId, pos) {
    const r = this.room(roomId) || { center: [0, 0] };
    return [r.center[0] + (pos?.[0] || 0), r.center[1] + (pos?.[1] || 0)];
  }

  roomAt(x, z) {
    return this.rooms.find(r => Math.abs(x - r.center[0]) <= r.size[0] / 2 && Math.abs(z - r.center[1]) <= r.size[1] / 2);
  }

  buildRoom(r) {
    const [cx, cz] = r.center, [w, d] = r.size, h = r.height || 3.2;
    const room = { ...r, height: h };
    this.rooms.push(room);
    const group = new THREE.Group();
    this.root.add(group);

    // floor + ceiling
    const tex = floorTexture(r.floor || '#5a3a22', r.floorStyle);
    tex.repeat.set(w / 2, d / 2);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: tex }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(cx, 0, cz);
    group.add(floor);
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat(r.ceiling || '#3a2a1c'));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(cx, h, cz);
    group.add(ceil);
    // ceiling beams
    for (let i = 1; i < Math.floor(w / 2); i++) group.add(box(0.18, 0.2, d, shade(r.ceiling || '#3a2a1c', 0.7), cx - w / 2 + i * w / Math.floor(w / 2), h - 0.2, cz));

    // walls
    const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
    const edges = [
      { horiz: true, line: z0, inset: z0 + WALL_T / 2, a0: x0, a1: x1 },
      { horiz: true, line: z1, inset: z1 - WALL_T / 2, a0: x0, a1: x1 },
      { horiz: false, line: x0, inset: x0 + WALL_T / 2, a0: z0 + WALL_T, a1: z1 - WALL_T },
      { horiz: false, line: x1, inset: x1 - WALL_T / 2, a0: z0 + WALL_T, a1: z1 - WALL_T }
    ];
    const wallMat = mat(r.wall || '#c9b38a');
    const wainMat = r.wainscot ? mat(r.wainscot) : null;
    for (const e of edges) {
      const ops = (this.data.openings || []).filter(o => {
        const fixed = e.horiz ? o.z : o.x, along = e.horiz ? o.x : o.z;
        return Math.abs(fixed - e.line) < 0.35 && along > e.a0 && along < e.a1;
      }).map(o => ({ ...o, s: (e.horiz ? o.x : o.z) - o.width / 2, e: (e.horiz ? o.x : o.z) + o.width / 2, bottom: o.bottom || 0, top: Math.min(o.top || 2.3, h) }))
        .sort((a, b) => a.s - b.s);
      const piece = (p0, p1, y0, y1) => {
        if (p1 - p0 < 0.01 || y1 - y0 < 0.01) return;
        const len = p1 - p0, mid = (p0 + p1) / 2;
        const sx = e.horiz ? len : WALL_T, sz = e.horiz ? WALL_T : len;
        const px = e.horiz ? mid : e.inset, pz = e.horiz ? e.inset : mid;
        const m = new THREE.Mesh(new THREE.BoxGeometry(sx, y1 - y0, sz), wallMat);
        m.position.set(px, (y0 + y1) / 2, pz);
        group.add(m);
        if (wainMat && y0 === 0) {
          const wy = Math.min(1.0, y1);
          const wm = new THREE.Mesh(new THREE.BoxGeometry(sx + (e.horiz ? 0 : 0.03), wy, sz + (e.horiz ? 0.03 : 0)), wainMat);
          wm.position.set(px, wy / 2, pz);
          group.add(wm);
        }
        if (y0 === 0) this.colliders.push({ minX: px - sx / 2, maxX: px + sx / 2, minZ: pz - sz / 2, maxZ: pz + sz / 2 });
      };
      let cur = e.a0;
      for (const o of ops) {
        piece(cur, o.s, 0, h);
        piece(o.s, o.e, o.top, h);
        if (o.bottom > 0) piece(o.s, o.e, 0, o.bottom);
        if (o.type === 'window') this.buildWindow(group, e, o);
        cur = o.e;
      }
      piece(cur, e.a1, 0, h);
    }

    // light
    const L = r.light || {};
    const light = new THREE.PointLight(L.color || '#ffd59a', L.intensity ?? 12, Math.max(w, d) * 1.8, 1.4);
    light.position.set(cx, h - 0.6, cz);
    group.add(light);
    group.add(cyl(0.006, 0.006, 0.45, '#222', cx, h - 0.45, cz));
    group.add(sphere(0.12, '#fff', cx, h - 0.55, cz, new THREE.MeshBasicMaterial({ color: L.color || '#ffd59a' })));
    group.add(new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.2, 16, 1, true), new THREE.MeshLambertMaterial({ color: '#6a4a2a', side: THREE.DoubleSide })).translateX(cx).translateY(h - 0.42).translateZ(cz));

    for (const p of r.props || []) this.buildProp(room, p, group);
  }

  buildWindow(group, e, o) {
    const len = o.e - o.s, hgt = o.top - o.bottom, mid = (o.s + o.e) / 2, yc = (o.top + o.bottom) / 2;
    const glassMat = new THREE.MeshBasicMaterial({ color: this.setting.skyColor || '#1a2430', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false });
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(len, hgt), glassMat);
    gl.position.set(e.horiz ? mid : e.line, yc, e.horiz ? e.line : mid);
    if (!e.horiz) gl.rotation.y = Math.PI / 2;
    group.add(gl);
    this.glass.push(glassMat);
    const frame = '#e8e0cc';
    const bar = (lx, ly, sx, sy) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(e.horiz ? sx : 0.06, sy, e.horiz ? 0.06 : sx), mat(frame));
      m.position.set(e.horiz ? mid + lx : e.line, yc + ly, e.horiz ? e.line : mid + lx);
      group.add(m);
    };
    bar(0, 0, 0.05, hgt); bar(0, 0, len, 0.05);
    bar(0, hgt / 2, len + 0.1, 0.08); bar(0, -hgt / 2, len + 0.2, 0.1);
  }

  buildProp(room, p, group) {
    const make = TEMPLATES[p.type] || TEMPLATES.box;
    const [w, h, d] = p.size || [1, 1, 1];
    const g = new THREE.Group();
    for (const part of make(w, h, d, p.color || '#7a5a3a', g, this)) g.add(part);
    const [x, z] = [room.center[0] + p.pos[0], room.center[1] + p.pos[1]];
    g.position.set(x, p.y || 0, z);
    g.rotation.y = (p.rotY || 0) * DEG;
    group.add(g);
    if (p.examine) g.userData.interact = { kind: 'prop', name: p.name || p.type, text: p.examine };
    if (p.examine) this.interactables.push(g);
    const flat = ['rug', 'outline', 'painting', 'lamp'].includes(p.type) || (p.y || 0) > 0.5;
    if (p.solid ?? !flat) {
      const a = Math.abs(Math.cos(g.rotation.y)), b = Math.abs(Math.sin(g.rotation.y));
      const hx = (w * a + d * b) / 2, hz = (w * b + d * a) / 2;
      this.colliders.push({ minX: x - hx, maxX: x + hx, minZ: z - hz, maxZ: z + hz });
    }
  }

  buildClue(c) {
    const [x, z] = this.toWorld(c.room, c.pos);
    const g = new THREE.Group();
    const make = CLUE_SHAPES[c.shape];
    const parts = make ? make(c.color || '#d8c890') : TEMPLATES[c.shape] ? TEMPLATES[c.shape](...(c.size || [0.3, 0.3, 0.3]), c.color || '#d8c890', g, this) : [box(...(c.size || [0.3, 0.2, 0.3]), c.color || '#d8c890')];
    for (const p of parts) g.add(p);
    if (c.shape === 'box' && !c.size) { g.clear(); g.add(box(0.3, 0.25, 0.25, c.color), box(0.3, 0.25, 0.25, c.color, 0.32)); }
    g.position.set(x, c.y || 0, z);
    g.rotation.y = (c.rotY ?? (x * 37 + z * 11) % 360) * DEG;
    // gentle glint so the player can spot clues
    const glint = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 24), new THREE.MeshBasicMaterial({ color: '#ffe08a', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    glint.rotation.x = -Math.PI / 2;
    glint.position.y = 0.012;
    glint.raycast = () => {};
    g.add(glint);
    // generous invisible hit box so small objects are easy to tap
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.5), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.y = 0.15;
    g.add(hit);
    this.pulses.push(glint);
    g.userData.interact = { kind: 'clue', id: c.id, name: c.name };
    this.root.add(g);
    this.interactables.push(g);
    this.clueObjects.set(c.id, { group: g, glint });
  }

  // Called when a clue is collected (or already collected on resume)
  markClueFound(id, pickup) {
    const o = this.clueObjects.get(id);
    if (!o) return;
    if (pickup) {
      this.root.remove(o.group);
      this.interactables = this.interactables.filter(i => i !== o.group);
    } else {
      o.glint.visible = false;
      this.pulses = this.pulses.filter(p => p !== o.glint);
    }
  }

  buildSuspect(sp) {
    const [x, z] = this.toWorld(sp.room, sp.pos);
    const g = new THREE.Group();
    const scale = sp.scale || 1;
    const body = new THREE.Group();
    body.add(cyl(0.09, 0.09, 0.8, '#2a2420', -0.1, 0), cyl(0.09, 0.09, 0.8, '#2a2420', 0.1, 0));
    body.add(cyl(0.24, 0.32, 0.72, sp.color || '#666', 0, 0.75));
    const shoulders = sphere(0.25, sp.color || '#666', 0, 1.42);
    shoulders.scale.set(1.2, 0.5, 1);
    body.add(shoulders);
    body.add(cyl(0.07, 0.08, 0.12, sp.skin || '#c8a080', 0, 1.47));
    const head = sphere(0.17, sp.skin || '#c8a080', 0, 1.72);
    body.add(head);
    const hair = sphere(0.175, sp.hair || '#2a1a10', 0, 1.77, -0.03);
    hair.scale.set(1, 0.75, 1);
    body.add(hair);
    if (sp.hat) {
      body.add(cyl(0.26, 0.26, 0.02, sp.hat, 0, 1.84), cyl(0.15, 0.17, 0.14, sp.hat, 0, 1.85));
    }
    body.add(sphere(0.025, '#111', -0.06, 1.74, 0.15), sphere(0.025, '#111', 0.06, 1.74, 0.15));
    for (const s of [-1, 1]) {
      const arm = cyl(0.06, 0.06, 0.6, sp.color || '#666', s * 0.3, 0.85);
      arm.rotation.z = s * 0.12;
      body.add(arm);
    }
    body.scale.setScalar(scale);
    g.add(body);
    const label = labelSprite(sp.name, sp.role);
    label.position.y = 2.15 * scale;
    g.add(label);
    g.position.set(x, 0, z);
    g.rotation.y = (sp.facing || 0) * DEG;
    g.userData.interact = { kind: 'suspect', id: sp.id, name: sp.name };
    g.userData.baseYaw = g.rotation.y;
    g.userData.body = body;
    g.userData.phase = Math.random() * 6;
    this.root.add(g);
    this.interactables.push(g);
    this.suspectObjects.set(sp.id, g);
    this.colliders.push({ minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35 });
  }

  buildWeather(s) {
    this.rain = null;
    if (s.weather === 'rain') {
      const N = 2600, pos = new Float32Array(N * 6), b = this.bounds;
      this.rainData = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        let x, z;
        do { x = b.min.x - 14 + Math.random() * (b.max.x - b.min.x + 28); z = b.min.y - 14 + Math.random() * (b.max.y - b.min.y + 28); }
        while (x > b.min.x - 0.4 && x < b.max.x + 0.4 && z > b.min.y - 0.4 && z < b.max.y + 0.4);
        const y = Math.random() * 12;
        pos.set([x, y, z, x + 0.03, y - 0.45, z + 0.02], i * 6);
        this.rainData[i] = 9 + Math.random() * 5;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#9fb4c8', transparent: true, opacity: 0.55 }));
      this.rain.frustumCulled = false;
      this.rain.raycast = () => {};
      this.root.add(this.rain);
    }
  }

  // returns true when lightning just struck (for thunder audio)
  update(dt, t, playerPos) {
    let struck = false;
    for (const f of this.flickers) {
      f.light.intensity = f.base * (0.8 + 0.25 * Math.sin(t * 11 + f.base) + 0.15 * Math.sin(t * 23));
    }
    for (const p of this.pulses) p.material.opacity = 0.25 + 0.3 * (0.5 + 0.5 * Math.sin(t * 3));
    if (this.rain) {
      const a = this.rain.geometry.attributes.position.array;
      for (let i = 0; i < this.rainData.length; i++) {
        const o = i * 6, dy = this.rainData[i] * dt;
        a[o + 1] -= dy; a[o + 4] -= dy;
        if (a[o + 4] < 0) { a[o + 1] += 12; a[o + 4] += 12; }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    if (this.setting.weather === 'rain' && this.setting.lightning !== false) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) { this.flash = 1; this.nextFlash = 9 + Math.random() * 16; struck = true; }
      if (this.flash > 0) {
        this.flash = Math.max(0, this.flash - dt * 2.2);
        const k = this.flash > 0.6 || (this.flash > 0.3 && this.flash < 0.45) ? this.flash : this.flash * 0.3;
        this.hemi.intensity = this.ambientBase + k * 3.5;
        for (const g of this.glass) { g.color.set('#dfe8ff').lerp(new THREE.Color(this.setting.skyColor || '#1a2430'), 1 - k); g.opacity = 0.35 + k * 0.5; }
      }
    }
    // suspects idle, and turn to face the player when close
    for (const g of this.suspectObjects.values()) {
      const body = g.userData.body;
      body.position.y = Math.sin(t * 1.6 + g.userData.phase) * 0.012;
      const dx = playerPos.x - g.position.x, dz = playerPos.z - g.position.z;
      const near = dx * dx + dz * dz < 16;
      const target = near ? Math.atan2(dx, dz) : g.userData.baseYaw;
      let diff = target - g.rotation.y;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      g.rotation.y += diff * Math.min(1, dt * 3);
    }
    return struck;
  }

  dispose() {
    if (!this.root) return;
    this.scene.remove(this.root);
    this.root.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material.map) o.material.map.dispose();
    });
    this.root = null;
  }
}
