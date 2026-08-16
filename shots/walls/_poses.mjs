/**
 * poses.mjs — the West Campus eye-level pose book, derived once.
 *
 * mpp(z) = 78271.516 * cos(lat) / 2^z   (MapLibre's 512 px tiles)
 * camPx  = (H/2) / tan(fov/2)           the pinhole in css px
 * D      = alt / cos(pitch)             eye -> screen-centre distance
 * zoom   = log2(camPx * 78271.516 * cos(lat) / D)
 *
 * Checked against docs/camera/facades-measured.md 1: alt 1.7, pitch 87,
 * lat 30.2856 -> zoom 20.6863 (the recorded GUAD-24TH-PAVEMENT-WEST value),
 * and against shots/facade/_shoot.json's EYE: pitch 88 -> D 48.711, z 20.1016.
 */
export const W = 1440, H = 900, FOV = 58;
const M_LAT = 111320.0;
const MPP_K = 78271.516;

export function poseFrom(eye, bearing, pitchDeg = 87) {
  const camPx = (H / 2) / Math.tan((FOV / 2) * Math.PI / 180);
  const pitch = pitchDeg * Math.PI / 180;
  const D = eye[2] / Math.cos(pitch);
  const ground = eye[2] * Math.tan(pitch);
  const zoom = Math.log2(camPx * MPP_K * Math.cos(eye[1] * Math.PI / 180) / D);
  const br = bearing * Math.PI / 180;
  const center = [
    eye[0] + (ground * Math.sin(br)) / (M_LAT * Math.cos(eye[1] * Math.PI / 180)),
    eye[1] + (ground * Math.cos(br)) / M_LAT,
  ];
  return { center, zoom, pitch: pitchDeg, bearing, eye, D: +D.toFixed(2), ground: +ground.toFixed(2) };
}

/**
 * The sites. Every one is a real pavement position with a West Campus tower
 * across the street, chosen from data/westcampus.geojson's own base-band
 * bounds so the wall in frame is one this lane owns.
 */
export const POSES = {
  // The Castilian's east elevation. base sp 0-4.6, PODIUM dk 4.6-29.8 (25.2 m
  // of above-grade parking deck), tower mh 29.8-53.8, crown sf 53.8-57.0.
  'A-castilian': { ...poseFrom([-97.74196, 30.28731, 1.7], 270), p: 0.30 },
  // 21 Rio from the Rio Grande pavement. base sg 0-6.2, tower tr 6.2-65.5
  // (59.3 m of punched-window tower), crown sf 65.5-69.5.
  'B-21rio': { ...poseFrom([-97.74515, 30.28428, 1.7], 90), p: 0.30 },
  // Dobie Twenty21 from Guadalupe. base sp 0-6, PODIUM dk 6-16.8, tower tg
  // 16.8-72.5 (curtain wall), crown sf.
  'C-dobie': { ...poseFrom([-97.74205, 30.28338, 1.7], 90), p: 0.30 },
  // The lobby close-up: the same Castilian elevation from 12 m, so the base
  // band and everything the entrances/places passes put on it fill the frame.
  'D-lobby': { ...poseFrom([-97.74206, 30.28731, 1.7], 270), p: 0.30 },
  // Cruise, over West Campus, at the altitude the tour flies.
  'E-cruise': { center: [-97.7445, 30.2860], zoom: 15.35, pitch: 64, bearing: 200,
                p: 0.30, eye: [null, null, 600], D: null, ground: null },
};
