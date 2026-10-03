# Feature-level evidence for photo-driven detail

A source record answers which part was supported by which evidence. Existing
building recipes already use `sources` and sibling `_src` fields; extend those
records as each feature is reviewed rather than replacing them with a single
building-wide badge. Keep private references in the private evidence store.

For each feature/parameter record:

- the asset and field, for example entrance stairs/count or roof/mainHeight;
- source type: owner photo, online photo, survey/LiDAR, map, or inference;
- the source key and observation/acquisition date (and access date for online);
- what is actually visible/measured and confidence/uncertainty;
- the model revision and whether that feature was implemented and verified;
- a conflict, the selected evidence and why, without deleting the losing evidence.

An explicit owner decision about the scene state takes priority. For visible
appearance, a clear current owner photo or direct field observation normally
supersedes older online imagery/map guesses. For metric elevation, a survey or
quality-controlled LiDAR measurement normally supersedes unscaled photo or
phone-altitude inference. A recent clear online view can fill a hidden face;
age, visibility, measurement quality and relevance matter more than a global
ranking. Mask construction covers/occluders and retain uncertainty behind them.

Do not infer sources from a filename, nearby GPS point, or presence in a job.
"Read from a photo," "implemented from that evidence," and "visually verified"
are separate states. Parts without reliable records remain unverified/unknown
until audited. Repeated observations add evidence; they do not silently erase
previous records. A private ledger can join asset, feature and source keys to
original images without publishing precise camera positions or photo names.

This is an evidence policy, not a new geometry schema or a quality restriction.
Details smaller than a threshold, unusual viewpoints and foliage may still be
important to identity. Let the source evidence determine what matters.
