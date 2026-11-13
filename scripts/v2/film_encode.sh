#!/bin/bash
# film_encode.sh <frames dir> <out dir> <base URL of the files> - the opening film (v2/film.js) from its frames.
#
#   FFMPEG=/path/to/ffmpeg scripts/v2/film_encode.sh frames out https://github.com/OWNER/REPO/releases/download/TAG
#
# Frames: f_0000.png ... (sRGB, 60 a second), from scripts/verify/v2-film-frames.mjs. Writes into <out dir>:
#   flight.hevc.mp4  H.265 (hvc1), tried first: about 60 % of the H.264 file's size
#   flight.mp4       H.264 High, for a browser that cannot play the first
#   film.json        the record v2/film.js reads: the two files at <base URL>, the film's size and length, and `of` = the
#                    first 16 hex digits of SHA-256 over v2/tiles/manifest.json then v2/tiles/coats.json OF THIS WORK COPY
#                    (run this from the work copy the frames were drawn from). Copy film.json to v2/film/film.json and
#                    put the two .mp4 files where <base URL> says. They do not go into the repository (30 to 50 MB each;
#                    every work copy would hold them).
# Colour: full-range sRGB frames to limited-range BT.709 Y'CbCr, tagged with the sRGB transfer, so the browser shows the
# film in the canvas's own colours (measured 2026-11-12: the film's last frame against the live still, mean difference 0.1 of 255).
# Knobs: CRF264 (19), CRF265 (23): a lower number is a bigger, cleaner file.
set -e
D=$1; O=$2; BASE=${3%/}; FF=${FFMPEG:-ffmpeg}; C4=${CRF264:-19}; C5=${CRF265:-23}; TRC=iec61966-2-1
[ -n "$D" ] && [ -n "$O" ] && [ -n "$BASE" ] || { echo "usage: film_encode.sh <frames dir> <out dir> <base URL>"; exit 2; }
ROOT=$(cd "$(dirname "$0")/../.." && pwd); mkdir -p "$O"
N=$(ls "$D" | grep -c '^f_[0-9]*\.png$')
IN="-framerate 60 -i $D/f_%04d.png"
VF="scale=in_range=pc:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int+full_chroma_inp,format=yuv420p,setparams=color_primaries=bt709:color_trc=$TRC:colorspace=bt709:range=tv"
"$FF" -hide_banner -loglevel error -y $IN -vf "$VF" -an -c:v libx265 -preset medium -crf $C5 -tag:v hvc1 -x265-params "keyint=120:log-level=error:colorprim=bt709:transfer=$TRC:colormatrix=bt709:range=limited" -movflags +faststart "$O/flight.hevc.mp4"
"$FF" -hide_banner -loglevel error -y $IN -vf "$VF" -an -c:v libx264 -preset slow -crf $C4 -profile:v high -level 5.2 -g 120 -bf 3 -x264-params "colorprim=bt709:transfer=$TRC:colormatrix=bt709" -movflags +faststart "$O/flight.mp4"
python3 - "$ROOT" "$O" "$BASE" "$N" "$D" <<'PY'
import hashlib, json, os, struct, sys
root, out, base, n, frames = sys.argv[1:6]
h = hashlib.sha256()
for f in ('v2/tiles/manifest.json', 'v2/tiles/coats.json'): h.update(open(os.path.join(root, f), 'rb').read())
png = open(os.path.join(frames, 'f_0000.png'), 'rb').read(24); w, hh = struct.unpack('>II', png[16:24])
rec = {'of': h.hexdigest()[:16], 'w': w, 'h': hh, 'fps': 60, 'frames': int(n), 'ms': round((int(n) - 1) * 1000 / 60),
       'files': [{'src': base + '/flight.hevc.mp4', 'type': 'video/mp4; codecs="hvc1.1.6.L150.B0"', 'bytes': os.path.getsize(os.path.join(out, 'flight.hevc.mp4'))},
                 {'src': base + '/flight.mp4', 'type': 'video/mp4; codecs="avc1.640034"', 'bytes': os.path.getsize(os.path.join(out, 'flight.mp4'))}]}
json.dump(rec, open(os.path.join(out, 'film.json'), 'w'), indent=1); print(json.dumps(rec))
PY
