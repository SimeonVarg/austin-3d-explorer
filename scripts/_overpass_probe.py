# Throwaway connectivity probe: which Overpass mirrors actually answer from here,
# and how fast. Writes a JSON verdict so the pipeline work can plan around it.
import json, sys, time, urllib.request, urllib.parse, urllib.error

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://overpass.osm.jp/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
Q = '[out:json][timeout:25];(way["highway"="footway"](30.2845,-97.7415,30.2870,-97.7375););out count;'

out = []
for url in MIRRORS:
    for attempt in range(3):
        t0 = time.time()
        try:
            body = urllib.parse.urlencode({"data": Q}).encode()
            req = urllib.request.Request(url, data=body, headers={
                "User-Agent": "austin-3d-explorer/1.0 (educational low-poly map)"})
            txt = urllib.request.urlopen(req, timeout=75).read().decode()
            j = json.loads(txt)
            cnt = j.get("elements", [{}])[0].get("tags", {}).get("ways")
            out.append({"url": url, "ok": True, "secs": round(time.time() - t0, 1), "ways": cnt})
            print("OK", url, round(time.time() - t0, 1), "s ways=", cnt, flush=True)
            break
        except Exception as e:
            msg = "%s: %s" % (type(e).__name__, e)
            print("fail", url, "attempt", attempt + 1, msg, flush=True)
            if attempt == 2:
                out.append({"url": url, "ok": False, "err": msg})
            else:
                time.sleep(8)

with open("scripts/_overpass_probe.json", "w") as f:
    json.dump(out, f, indent=1)
print("WORKING MIRRORS:", [o["url"] for o in out if o.get("ok")], flush=True)
