import { openApp, waitReady, PRIVATE } from './lib/app.mjs';
import fs from 'node:fs'; import path from 'node:path';
const { browser, page, errors, t0 } = await openApp({ query: process.env.Q || '' });
try {
  const ms = await waitReady(page, t0);
  console.log('ready', JSON.stringify(ms));
  const info = await page.evaluate(() => {
    const A = window.slopesApartments, out = {};
    out.count = A.count; delete out.count.names;
    const meshes = [];
    A.group.traverse(o => {
      if (!o.isMesh && !o.isLine && !o.isPoints) return;
      const g = o.geometry, at = {};
      for (const [k, v] of Object.entries(g.attributes)) { const a = v.array || (v.data && v.data.array); at[k] = { itemSize: v.itemSize, count: v.count, type: a && a.constructor.name, norm: v.normalized, inter: !!v.isInterleavedBufferAttribute }; }
      meshes.push({ name: o.name, type: o.type, parent: o.parent && o.parent.name, mat: o.material && (o.material.type + '/' + (o.material.name || '')), nmat: Array.isArray(o.material) ? o.material.length : 1,
        idx: g.index ? { count: g.index.count, type: g.index.array.constructor.name } : null, groups: g.groups.length, at, ud: Object.keys(o.userData || {}), vis: o.visible, ft: o.frustumCulled, matrix: o.matrixWorld.elements.slice(0, 16).map(x => +x.toFixed(4)) });
    });
    out.meshes = meshes;
    out.groupName = A.group.name; out.children = A.group.children.map(c => ({ n: c.name, t: c.type, kids: c.children.length }));
    out.rootChildren = window.slopes.root.children.map(c => ({ n: c.name, t: c.type, kids: c.children.length, vis: c.visible }));
    out.stats = window.slopes.stats();
    out.three = window.THREE.REVISION;
    const lay = window.__map.getStyle().layers; const hist = {}; for (const l of lay) hist[l.type] = (hist[l.type] || 0) + 1;
    out.layers = { total: lay.length, hist };
    out.order = lay.map(l => l.id + ':' + l.type).slice(-12);
    return out;
  });
  fs.writeFileSync(path.join(PRIVATE, 'probe.json'), JSON.stringify(info, null, 1));
  console.log(JSON.stringify({ count: info.count, children: info.children, rootChildren: info.rootChildren, stats: info.stats, layers: info.layers, meshN: info.meshes.length, first: info.meshes.slice(0, 3) }, null, 1));
  console.log('errors', errors.slice(0, 5));
} finally { await browser.__done(); }
