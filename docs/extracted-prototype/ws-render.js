// ws-render.js — procedural indoor world renderer for World Studio mockups.
// Generates an AI2-THOR-ish living room as a point set + box wireframes,
// renders to 2D canvas in modes: splat | points | mesh | semantic | depth.
// Plain JS, exports to window.WSRender.
(function () {
  'use strict';

  // ---- semantic palette (warm-charcoal friendly) ----
  const SEM = {
    floor:  '#8a7a64', wall: '#5c544a', rug: '#b0563a', sofa: '#c97b4e',
    table:  '#9c8b5e', lamp: '#e8c87a', plant: '#6f8f5a', shelf: '#7a6a8f',
    window: '#6e93a8', agent: '#e0683a',
  };
  const SEM_FLAT = {
    floor:  '#5b6f8a', wall: '#3d4a5c', rug: '#b04a8f', sofa: '#d9764a',
    table:  '#c9a93f', lamp: '#e8e26a', plant: '#4fae62', shelf: '#8f6fd9',
    window: '#4fc3d9', agent: '#e8503a',
  };

  function rnd(seed) { // mulberry32
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // points: {x,y,z, cls, sh} sh=shade 0..1   (y up, room ~ 6 x 3 x 5)
  function buildScene() {
    const r = rnd(1337);
    const pts = [];
    const boxes = []; // {min:[x,y,z], max:[x,y,z], cls}
    const W = 6, D = 5, H = 2.8;

    function scatterBox(min, max, n, cls, surfaceOnly) {
      boxes.push({ min, max, cls });
      for (let i = 0; i < n; i++) {
        let x, y, z;
        if (surfaceOnly) {
          const f = Math.floor(r() * 6);
          x = min[0] + r() * (max[0] - min[0]);
          y = min[1] + r() * (max[1] - min[1]);
          z = min[2] + r() * (max[2] - min[2]);
          if (f === 0) x = min[0]; else if (f === 1) x = max[0];
          else if (f === 2) y = max[1]; else if (f === 3) y = min[1];
          else if (f === 4) z = min[2]; else z = max[2];
        } else {
          x = min[0] + r() * (max[0] - min[0]);
          y = min[1] + r() * (max[1] - min[1]);
          z = min[2] + r() * (max[2] - min[2]);
        }
        pts.push({ x, y, z, cls, sh: 0.55 + r() * 0.45 });
      }
    }
    function scatterRect(x0, z0, x1, z1, y, n, cls) {
      for (let i = 0; i < n; i++) {
        pts.push({ x: x0 + r() * (x1 - x0), y: y + (r() - 0.5) * 0.015, z: z0 + r() * (z1 - z0), cls, sh: 0.5 + r() * 0.5 });
      }
    }
    // floor + rug
    scatterRect(-W / 2, -D / 2, W / 2, D / 2, 0, 4200, 'floor');
    scatterRect(-1.4, -1.1, 1.6, 1.3, 0.012, 1500, 'rug');
    // two walls (back z=-D/2, left x=-W/2)
    for (let i = 0; i < 2600; i++) {
      if (r() < 0.5) pts.push({ x: -W / 2 + r() * W, y: r() * H, z: -D / 2, cls: 'wall', sh: 0.4 + r() * 0.4 });
      else pts.push({ x: -W / 2, y: r() * H, z: -D / 2 + r() * D, cls: 'wall', sh: 0.4 + r() * 0.4 });
    }
    // window on back wall
    for (let i = 0; i < 700; i++) {
      pts.push({ x: 0.4 + r() * 1.8, y: 0.9 + r() * 1.3, z: -D / 2 + 0.012, cls: 'window', sh: 0.6 + r() * 0.4 });
    }
    boxes.push({ min: [0.4, 0.9, -D / 2], max: [2.2, 2.2, -D / 2], cls: 'window' });
    // sofa: seat + back + arms
    scatterBox([-2.6, 0.18, -2.2], [-0.4, 0.62, -1.4], 1500, 'sofa', true);
    scatterBox([-2.6, 0.62, -2.35], [-0.4, 1.25, -2.05], 1100, 'sofa', true);
    scatterBox([-2.85, 0.3, -2.3], [-2.6, 0.85, -1.4], 350, 'sofa', true);
    scatterBox([-0.4, 0.3, -2.3], [-0.15, 0.85, -1.4], 350, 'sofa', true);
    // coffee table
    scatterBox([-1.1, 0.42, -0.5], [0.5, 0.5, 0.45], 800, 'table', true);
    scatterBox([-1.05, 0, -0.45], [-0.98, 0.42, -0.38], 60, 'table', false);
    scatterBox([0.38, 0, -0.45], [0.45, 0.42, -0.38], 60, 'table', false);
    scatterBox([-1.05, 0, 0.33], [-0.98, 0.42, 0.4], 60, 'table', false);
    scatterBox([0.38, 0, 0.33], [0.45, 0.42, 0.4], 60, 'table', false);
    // shelf against left wall
    scatterBox([-2.95, 0, 0.6], [-2.55, 1.9, 2.0], 1100, 'shelf', true);
    // lamp: pole + shade
    for (let i = 0; i < 220; i++) pts.push({ x: 2.1 + (r() - 0.5) * 0.05, y: r() * 1.5, z: -1.8 + (r() - 0.5) * 0.05, cls: 'lamp', sh: 0.5 + r() * 0.3 });
    for (let i = 0; i < 500; i++) {
      const a = r() * Math.PI * 2, rr = 0.12 + r() * 0.16, yy = 1.5 + r() * 0.32;
      pts.push({ x: 2.1 + Math.cos(a) * rr, y: yy, z: -1.8 + Math.sin(a) * rr, cls: 'lamp', sh: 0.75 + r() * 0.25 });
    }
    boxes.push({ min: [1.92, 1.45, -1.98], max: [2.28, 1.85, -1.62], cls: 'lamp' });
    // plant
    for (let i = 0; i < 700; i++) {
      const a = r() * Math.PI * 2, h = r();
      const rr = 0.05 + (1 - Math.abs(h - 0.7)) * 0.4 * r();
      pts.push({ x: 1.9 + Math.cos(a) * rr, y: 0.25 + h * 1.1, z: 1.5 + Math.sin(a) * rr, cls: 'plant', sh: 0.4 + r() * 0.6 });
    }
    scatterBox([1.7, 0, 1.3], [2.1, 0.28, 1.7], 200, 'table', true);
    return { pts, boxes, W, D, H };
  }

  const SCENE = buildScene();

  function hexRgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  }
  const SEM_RGB = {}, FLAT_RGB = {};
  for (const k in SEM) SEM_RGB[k] = hexRgb(SEM[k]);
  for (const k in SEM_FLAT) FLAT_RGB[k] = hexRgb(SEM_FLAT[k]);

  // magma-ish depth ramp
  function depthColor(t) {
    t = Math.max(0, Math.min(1, t));
    const stops = [[252, 222, 156], [240, 142, 86], [196, 78, 82], [120, 41, 99], [48, 18, 76], [8, 6, 25]];
    const f = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(f)), u = f - i;
    const a = stops[i], b = stops[i + 1];
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
  }

  // camera: orbit around target
  function makeCam(yaw, pitch, dist, target, fov, w, h) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const ex = target[0] + dist * cp * sy, ey = target[1] + dist * sp, ez = target[2] + dist * cp * cy;
    const fl = (h / 2) / Math.tan((fov || 50) * Math.PI / 360);
    return { ex, ey, ez, cy, sy, cp, sp, fl, cx: w / 2, cyc: h / 2, target };
  }
  function project(cam, x, y, z) {
    const dx = x - cam.ex, dy = y - cam.ey, dz = z - cam.ez;
    // camera basis: right=(cy,0,-sy), up=(-sp*sy,cp,-sp*cy), fwd=(-cp*sy,-sp,-cp*cy)
    const rx = dx * cam.cy - dz * cam.sy;
    const ry = -dx * cam.sp * cam.sy + dy * cam.cp - dz * cam.sp * cam.cy;
    const d = -dx * cam.cp * cam.sy - dy * cam.sp - dz * cam.cp * cam.cy;
    if (d < 0.1) return null;
    return [cam.cx + (rx / d) * cam.fl, cam.cyc - (ry / d) * cam.fl, d];
  }

  // main render
  // opts: {mode, yaw, pitch, dist, target, fov, bg, accent, density(0..1),
  //        agent:{x,z,heading}, frustums:[{x,y,z,yaw,pitch,label}], grid:bool,
  //        trajectory:[[x,z],...], highlight: cls}
  function render(canvas, opts) {
    const o = opts || {};
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const mode = o.mode || 'splat';
    ctx.fillStyle = o.bg || '#15120e';
    ctx.fillRect(0, 0, w, h);
    const cam = makeCam(o.yaw ?? 0.6, o.pitch ?? 0.42, o.dist ?? 7.2, o.target || [0, 0.7, -0.2], o.fov || 50, w, h);

    // vignette-ish floor glow
    const g = ctx.createRadialGradient(w / 2, h * 0.62, h * 0.1, w / 2, h * 0.62, h * 0.85);
    g.addColorStop(0, 'rgba(224,104,58,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

    // ground grid
    if (o.grid !== false) {
      ctx.strokeStyle = 'rgba(232,221,208,0.07)'; ctx.lineWidth = 1;
      for (let i = -6; i <= 6; i++) {
        let a = project(cam, i, 0, -6), b = project(cam, i, 0, 6);
        if (a && b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
        a = project(cam, -6, 0, i); b = project(cam, 6, 0, i);
        if (a && b) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); }
      }
    }

    const pts = SCENE.pts, density = o.density ?? 1;
    const step = density >= 1 ? 1 : Math.max(1, Math.round(1 / density));
    const scaleK = h / 1080;
    const sel = o.selected, del = o.deleted;
    const accRgb = hexRgb(o.accent || '#e0683a');
    const expo = o.exposure ?? 1;

    if (mode === 'mesh') {
      drawMesh(ctx, cam, o);
    } else {
      // depth range for ramp
      let zMin = 2.5, zMax = (o.dist ?? 7.2) + 4;
      for (let i = 0; i < pts.length; i += step) {
        const p = pts[i];
        const pr = project(cam, p.x, p.y, p.z);
        if (!pr) continue;
        const d = pr[2];
        let rgb, alpha, size;
        if (mode === 'depth') {
          rgb = depthColor((d - zMin) / (zMax - zMin));
          alpha = 0.85; size = 2.6;
        } else if (mode === 'semantic') {
          rgb = FLAT_RGB[p.cls]; alpha = 0.9; size = 2.6;
        } else {
          rgb = SEM_RGB[p.cls];
          const sh = p.sh;
          rgb = [rgb[0] * sh, rgb[1] * sh, rgb[2] * sh];
          alpha = mode === 'splat' ? (o.splatAlpha ?? 0.42) : 0.95;
          size = mode === 'splat' ? (o.splatSize ?? 7.4) : 1.7;
        }
        if (o.highlight && p.cls !== o.highlight) alpha *= 0.18;
        if (del && del[i]) {
          if (!o.showDeleted) continue;
          rgb = [220, 70, 50]; alpha = 0.1;
        } else if (sel && sel[i]) {
          rgb = accRgb; alpha = Math.min(1, alpha + 0.35);
        } else if (expo !== 1) {
          rgb = [Math.min(255, rgb[0] * expo), Math.min(255, rgb[1] * expo), Math.min(255, rgb[2] * expo)];
        }
        const rad = Math.max(0.6, (size * 6 / d) * scaleK);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = 'rgb(' + (rgb[0] | 0) + ',' + (rgb[1] | 0) + ',' + (rgb[2] | 0) + ')';
        ctx.beginPath(); ctx.arc(pr[0], pr[1], rad, 0, 6.2832); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (o.trajectory) drawTrajectory(ctx, cam, o.trajectory, o.accent);
    if (o.agent) drawAgent(ctx, cam, o.agent, o.accent, scaleK);
    if (o.frustums) for (const f of o.frustums) drawFrustum(ctx, cam, f, o.accent, scaleK);
  }

  function line3(ctx, cam, a, b) {
    const pa = project(cam, a[0], a[1], a[2]), pb = project(cam, b[0], b[1], b[2]);
    if (!pa || !pb) return;
    ctx.beginPath(); ctx.moveTo(pa[0], pa[1]); ctx.lineTo(pb[0], pb[1]); ctx.stroke();
  }

  function drawMesh(ctx, cam, o) {
    ctx.lineWidth = 1.4;
    for (const b of SCENE.boxes) {
      const [x0, y0, z0] = b.min, [x1, y1, z1] = b.max;
      const c = SEM_FLAT[b.cls] || '#888';
      ctx.strokeStyle = c; ctx.globalAlpha = o.highlight && b.cls !== o.highlight ? 0.15 : 0.8;
      const C = [[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1],[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]];
      const E = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]];
      for (const e of E) line3(ctx, cam, C[e[0]], C[e[1]]);
    }
    ctx.globalAlpha = 1;
  }

  function drawAgent(ctx, cam, a, accent, k) {
    const acc = accent || '#e0683a';
    const p = project(cam, a.x, 0.02, a.z);
    if (!p) return;
    // ring
    ctx.strokeStyle = acc; ctx.lineWidth = 2 * k;
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const t = i / 24 * 6.2832;
      const q = project(cam, a.x + Math.cos(t) * 0.34, 0.02, a.z + Math.sin(t) * 0.34);
      if (!q) continue;
      if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
    }
    ctx.stroke();
    // body
    const top = project(cam, a.x, 0.95, a.z);
    if (top) {
      ctx.strokeStyle = acc; ctx.lineWidth = 3 * k;
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(top[0], top[1]); ctx.stroke();
      ctx.fillStyle = acc;
      ctx.beginPath(); ctx.arc(top[0], top[1], 7 * k, 0, 6.2832); ctx.fill();
    }
    // heading
    const hd = project(cam, a.x + Math.cos(a.heading) * 0.8, 0.02, a.z + Math.sin(a.heading) * 0.8);
    if (hd) {
      ctx.strokeStyle = acc; ctx.lineWidth = 2 * k; ctx.setLineDash([6 * k, 5 * k]);
      ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(hd[0], hd[1]); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  function drawFrustum(ctx, cam, f, accent, k) {
    const acc = f.color || accent || '#e0683a';
    const len = f.len || 0.9, half = len * 0.55;
    const cyaw = Math.cos(f.yaw), syaw = Math.sin(f.yaw);
    // forward dir (in xz), slight pitch down
    const dir = [syaw, -(f.pitch || 0.18), cyaw];
    const right = [cyaw, 0, -syaw], up = [0, 1, 0];
    const o3 = [f.x, f.y, f.z];
    const corners = [];
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      corners.push([
        o3[0] + dir[0] * len + right[0] * half * su + up[0] * half * 0.62 * sv,
        o3[1] + dir[1] * len + right[1] * half * su + up[1] * half * 0.62 * sv,
        o3[2] + dir[2] * len + right[2] * half * su + up[2] * half * 0.62 * sv,
      ]);
    }
    ctx.strokeStyle = acc; ctx.lineWidth = 1.6 * k; ctx.globalAlpha = 0.95;
    for (const c of corners) line3(ctx, cam, o3, c);
    for (let i = 0; i < 4; i++) line3(ctx, cam, corners[i], corners[(i + 1) % 4]);
    const p = project(cam, o3[0], o3[1], o3[2]);
    if (p) { ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(p[0], p[1], 4.5 * k, 0, 6.2832); ctx.fill(); }
    if (f.label && p) {
      ctx.font = (15 * k | 0) + 'px "IBM Plex Mono", monospace';
      ctx.fillStyle = 'rgba(232,221,208,0.9)';
      ctx.fillText(f.label, p[0] + 10 * k, p[1] - 8 * k);
    }
    ctx.globalAlpha = 1;
  }

  function drawTrajectory(ctx, cam, traj, accent) {
    ctx.strokeStyle = accent || '#e0683a'; ctx.lineWidth = 2; ctx.setLineDash([8, 7]);
    ctx.beginPath();
    let started = false;
    for (const [x, z] of traj) {
      const p = project(cam, x, 0.03, z);
      if (!p) continue;
      if (!started) { ctx.moveTo(p[0], p[1]); started = true; } else ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke(); ctx.setLineDash([]);
    for (const [x, z] of traj) {
      const p = project(cam, x, 0.03, z);
      if (p) { ctx.fillStyle = accent || '#e0683a'; ctx.beginPath(); ctx.arc(p[0], p[1], 3.4, 0, 6.2832); ctx.fill(); }
    }
  }

  // eye-level "sensor feed" fake photo: dense splats, low cam
  function renderFeed(canvas, opts) {
    render(canvas, Object.assign({
      mode: 'splat', yaw: (opts && opts.yaw) ?? -0.35, pitch: 0.12, dist: 5.6,
      target: [-0.6, 0.85, -1.2], fov: 66, grid: false, density: 1,
      splatSize: 5.2, splatAlpha: 0.78,
    }, opts || {}));
    // subtle scanline + grain for "camera" feel
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    for (let y = 0; y < canvas.height; y += 4) ctx.fillRect(0, y, canvas.width, 1);
  }

  // collect indices of points within screen-space radius r of (sx, sy)
  function collectInRadius(o, w, h, sx, sy, r) {
    const cam = makeCam(o.yaw ?? 0.6, o.pitch ?? 0.42, o.dist ?? 7.2, o.target || [0, 0.7, -0.2], o.fov || 50, w, h);
    const out = [], pts = SCENE.pts, r2 = r * r;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const pr = project(cam, p.x, p.y, p.z);
      if (!pr) continue;
      const dx = pr[0] - sx, dy = pr[1] - sy;
      if (dx * dx + dy * dy < r2) out.push(i);
    }
    return out;
  }

  window.WSRender = { render, renderFeed, SEM, SEM_FLAT, scene: SCENE, collectInRadius };
})();
