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


## Architecture inferred from owner photos

Inference is allowed and useful for completing a coherent building. Label a
feature `inference` when it repeats visible architecture onto an unseen face,
fills an angle without a photo, or reconstructs a part obscured by trees,
construction or another object. Use `derivedFrom` for the supporting owner-photo
evidence; the result is not a directly observed owner-photo feature.

Record the proposed pattern, the visible evidence supporting it, the occluded
or unseen scope, confidence and competing possibilities. Keep appearance
inference separate from metric inference. A photo can establish a stair count
while its width and rise remain inferred. A photographed wall does not make
every face of its block photo-observed.

When direct evidence arrives, update only the fields it establishes and retain
the prior inferred record under superseded evidence. Clearly supported owner
observations override pattern completion for those fields. A clear online view
of the hidden part is direct online evidence, rather than owner-photo evidence.
Unknown evidence remains unknown until audited; do not retroactively relabel
existing NHB or other buildings based only on this policy.

Example field record (source identity joins privately):

```json
{
  "_src": {
    "northWindows": {
      "type": "inference",
      "derivedFrom": ["reviewed-visible-window-rhythm"],
      "scope": "unphotographed north window layout",
      "confidence": "medium",
      "status": "provisional",
      "reason": "repeat adjacent visible bay pattern; north face not observed"
    }
  }
}
```
