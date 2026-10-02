// Temporary proof integration: explicit anchors fail closed on renderer drift.
// Existing renderer files remain untouched while concurrent PRs own them.
export function once(source, anchor, replacement) {
  if(source.split(anchor).length!==2) throw Error('Wall-pattern integration anchor changed: '+anchor);
  return source.replace(anchor,replacement);
}
export function slopesSource(source) {
  if(source.includes('window.WallPatterns')) throw Error('Wall-pattern integration already present');
  source=once(source,'    // Builder meshes have no wall gradient.',
    '    window.WallPatterns.attach(mat);\n    // Builder meshes have no wall gradient.');
  source=once(source,'    float hashCell(vec2 p)', '${window.WallPatterns.glsl}\n    float hashCell(vec2 p)');
  return once(source,'      float faceMix=1.0;', '${window.WallPatterns.apply}\n      float faceMix=1.0;');
}
export function apartmentsSource(source) {
  if(source.includes('window.WallPatterns')) throw Error('Wall-pattern integration already present');
  return once(source,'    const F = frameFor(obb);',
    '    const F = frameFor(obb);\n    window.WallPatterns.register(P,spec,F);');
}
