import fs from 'node:fs/promises';
import path from 'node:path';

export const TARGETS = Object.freeze({
  welch: { id: 'ca0207d3-bbf8-408d-a319-9407d7bd0dd2', name: 'Robert A. Welch Hall', file: 'data/apartments/welch-hall.json' },
  painter: { id: '82bcddc0-ec33-4a0a-a9f2-f380a838a40f', name: 'T. S. Painter Hall', file: 'data/campus_buildings.json' },
  gdc: { id: '44e418d6-dd3a-48da-8e9d-c29e59593299', name: 'Gates-Dell Complex', file: 'data/heroes.geojson', renderer: 'heroes' },
  nueces: { id: '01b885c4-03ff-45d4-b394-707735cb6958', name: '2400 Nueces', file: 'data/apartments/2400-nueces.json' },
  standard: { id: '36365d18-2eb6-43c5-b042-6197e7767e17', name: 'The Standard', file: 'data/apartments/the-standard.json' },
});

/** Collection dependencies belong to their individual specs, never to their siblings. */
export async function loadSelectedSpecs(rootDir, keys = ['welch']) {
  if (!keys.length || new Set(keys).size !== keys.length) throw new Error('Select distinct building keys');
  const docs = new Map();
  const result = [];
  for (const key of keys) {
    const target = TARGETS[key];
    if (!target) throw new Error('Unknown building selection: ' + key);
    if (!docs.has(target.file)) docs.set(target.file, JSON.parse(await fs.readFile(path.join(rootDir, target.file), 'utf8')));
    const doc = docs.get(target.file);
    if (target.renderer === 'heroes') {
      if (!doc.replacedBuildingIds?.includes(target.id) || !doc.authoredRoofIds?.includes(target.id) || !doc.heroHeights?.[target.id]) throw new Error('GDC hero identity missing');
      const features = doc.features.filter(f => f.properties.b === 'gdc');
      if (!features.length) throw new Error('GDC hero features missing');
      result.push({ key, file: target.file, pointer: '/features', selector: { property: 'b', value: 'gdc' },
        spec: { id: target.id, name: target.name, renderer: 'heroes', featureCollection: {
          type: 'FeatureCollection', features, replacedBuildingIds: [target.id], authoredRoofIds: [target.id], heroHeights: { [target.id]: doc.heroHeights[target.id] },
        } } });
      continue;
    }
    const collection = Array.isArray(doc.buildings);
    const spec = collection ? doc.buildings.find(b => b.id === target.id) : doc;
    if (!spec || spec.id !== target.id || spec.name !== target.name) throw new Error('Exact building identity missing: ' + target.name);
    result.push({ key, file: target.file, pointer: collection ? '/buildings' : '',
      ...(collection ? { selector: { property: 'id', value: spec.id } } : {}), spec });
  }
  return result;
}
