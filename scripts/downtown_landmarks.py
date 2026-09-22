"""Two measured-height downtown landmarks; geometry stays in the outer bake.

KPF describes Waterline's stacked/twisted programs, raised base, sculptural
columns and sweeping crown. Gensler describes Sixth and Guadalupe's program
terraces; its completed elevation has a recessed residential balcony field.
Plan limits come from the existing Overture footprints. Internal dimensions
below are elevation/photograph fits, not survey measurements. Overall heights
remain the existing curated 315 / 267 m until final-height sources agree.
No owner imagery, reference URLs or private camera coordinates belong here.
"""
import hashlib
import json
import math


LANDMARKS = {
    "Waterline": {
        "key": "waterline", "center": [-97.739542, 30.261083], "bearing": 18.0,
        "height": 315.0, "raw_height": 315.0,
        "footprint": [[-97.7392047,30.2615877],[-97.7393431,30.2617137],[-97.7395818,30.2615172],[-97.7396552,30.2615101],[-97.7397461,30.2615003],[-97.7397817,30.2614961],[-97.7398497,30.2614875],[-97.7399514,30.2614745],[-97.7400269,30.2614649],[-97.7399842,30.261395],[-97.7399195,30.2612892],[-97.7399084,30.261271],[-97.7398407,30.2611492],[-97.7398296,30.2611161],[-97.7398184,30.2610375],[-97.7398179,30.2609995],[-97.7398271,30.2609613],[-97.7399518,30.2606017],[-97.7398878,30.2605862],[-97.7397297,30.2605413],[-97.7396995,30.2605326],[-97.7394244,30.2604529],[-97.73937,30.2605958],[-97.7392542,30.2609],[-97.7390923,30.2613255],[-97.7391407,30.2613856],[-97.7390576,30.2614537],[-97.7392047,30.2615877]],
        "hotel": [-19,31,-57,37], "office": [-22,31,-31,37],
        "residential": [-18,25,-4,37],
        "levels": [9.144,50,177,187,302,315],
        "floors": [12,27,33], "bays": [3.3,3.6,3.15],
        "occupancy": [0.30,0.24,0.54],
        "glass": ["#466780","#3e6880","#32536e"],
        "lit": ["#97978b","#78959f","#b4a680"],
        "frame": "#a7afb0", "slab": "#afb9bd", "canopy": "#c3beb0",
        "crown_core_inset": 3.4, "crown_overhang": 2.0,
        "crown_slab": 0.85, "support_width": 1.05,
        "support_lean": 2.2, "support_steps": 12,
        "floor_band": 0.28, "frame_width": 0.24, "face_depth": 0.28,
        "terrace_rail": 1.15,
        "backing_inset": 0.85,
        "sky_column_night": "#dcc68e", "crown_column_night": "#a1967e",
        "crown_canopy_night": "#847d6b",
    },
    "Sixth and Guadalupe": {
        "key": "sixth-guadalupe", "center": [-97.74669,30.269654], "bearing":18.0,
        "height":267.0,"raw_height":18.7,
        "footprint":[[-97.746364,30.2699589],[-97.7469356,30.2701183],[-97.7471343,30.2695867],[-97.7471968,30.2694194],[-97.7471359,30.2694033],[-97.7463736,30.26919],[-97.7462164,30.2696108],[-97.7461839,30.2696979],[-97.7464353,30.269768],[-97.746364,30.2699589]],
        "parking":[-37,43,-38,19], "office":[-33,25,-28,38],
        "residential":[-28,20,-9,37], "levels":[18.7,119,126,257,267],
        "floors":[22,37],"bays":[3.1,3.2],"occupancy":[0.47,0.28],
        "glass":["#527288","#344f65"],"lit":["#8e999a","#a9a08b"],
        "frame":"#577083","slab":"#65727a","canopy":"#8b9ca6",
        "floor_band":0.30,"frame_width":0.22,"face_depth":0.28,
        "balcony_depth":2.4,"balcony_left":7.4,"balcony_right":9.6,
        "rail_height":1.1,"rail_thickness":0.14,
        "crown_band_height":3.0,"crown_blue":"#2865dc",
        "crown_day":"#7a98ae","crown_overhang":0.7,"crown_backing_inset":0.85,
        "support_width":1.3,"terrace_rail":1.15,
        "backing_inset":0.85,
    },
}


def build_landmark(bake, name, height=None, fade=0):
    """Return self-contained solids with stable host tags; no generic atlas.

    Horizontal bands and recessed balcony geometry establish facade scale;
    lit panes have deterministic positions and explicit day/night materials.
    Every dimension is in the landmark's street-aligned metric frame.
    """
    cfg = LANDMARKS[name]
    if height is not None and abs(height-cfg["height"]) > 0.75:
        raise ValueError(f"{name}: verify new height before changing fitted levels")
    origin = bake.to_metres([cfg["center"]])[0]
    angle = math.radians(cfg["bearing"])
    cs, sn = math.cos(angle), math.sin(angle)
    out = []

    def world(p):
        return (origin[0]+p[0]*cs+p[1]*sn, origin[1]-p[0]*sn+p[1]*cs)

    def poly(points, z0, z1, color, role, night=None):
        if z1 <= z0:
            raise ValueError(f"{name}: inverted {role}")
        # Landmark facade geometry uses the existing flat-detail material;
        # no generic tower pattern is painted over balconies or crown frames.
        f = bake.piece([world(p) for p in points], z0, z1, color, fade, kind="c")
        f["properties"].update(lm=cfg["key"], part=role, d=0)
        if role.endswith(("-floor","-mullion")):
            f["properties"]["lmThin"] = 1
        if role.endswith("-pane") or role.endswith("-cheek") or role in (
                "hotel","office","residential","crown-glass","sky-lobby","lobby-core"):
            f["properties"]["lmGlass"] = 1
        if role in ("sky-column","crown-column","crown-canopy") and name=="Waterline":
            tone=cfg.get(role.replace("-","_")+"_night")
            if tone:
                f["properties"]["lmEmit"] = 1
                night=tone
        if role=="crown-blue-edge":
            f["properties"]["lmEmit"] = 1
        if night:
            f["properties"]["wn"] = night
        out.append(f)
        return f

    def box(r, z0, z1, color, role, night=None):
        x0,x1,y0,y1 = r
        return poly([(x0,y0),(x1,y0),(x1,y1),(x0,y1),(x0,y0)],z0,z1,color,role,night)

    def expand(r, n):
        return [r[0]-n,r[1]+n,r[2]-n,r[3]+n]

    def ring(r,z0,z1,color,role,thickness,night=None):
        x0,x1,y0,y1 = r
        for side in ([x0,x1,y0,y0+thickness],[x0,x1,y1-thickness,y1],
                     [x0,x0+thickness,y0+thickness,y1-thickness],
                     [x1-thickness,x1,y0+thickness,y1-thickness]):
            box(side,z0,z1,color,role,night)

    def slab(r,z,color,role,thick=None):
        return box(expand(r,cfg["face_depth"]),z,z+(thick or cfg["floor_band"]),color,role)

    def random(key):
        return int(hashlib.sha256((cfg["key"]+key).encode()).hexdigest()[:8],16)/0xffffffff

    def skin(r,z0,z1,floors,bay,glass,lit,occupancy,role,skip_north=False):
        x0,x1,y0,y1=r
        dz=(z1-z0)/floors
        depth=cfg["face_depth"]
        for row in range(floors):
            z=z0+row*dz
            slab(r,z,cfg["slab"],role+"-floor")
            for side,length in enumerate((x1-x0,y1-y0,x1-x0,y1-y0)):
                if side==2 and skip_north:
                    continue
                cols=max(1,round(length/bay))
                for col in range(cols):
                    # Room groups vary by floor; no vertical wall-wide checker.
                    if random(f"{role}/{row}/{side}/{col}")>=occupancy:
                        continue
                    s=(col+0.12)*length/cols;t=(col+0.86)*length/cols
                    if side==0: rect=[x0+s,x0+t,y0-depth,y0+depth]
                    elif side==1: rect=[x1-depth,x1+depth,y0+s,y0+t]
                    elif side==2: rect=[x0+s,x0+t,y1-depth,y1+depth]
                    else: rect=[x0-depth,x0+depth,y0+s,y0+t]
                    # Recessed dark slab bands separate full-height glass panes.
                    box(rect,z+0.50,z+dz-0.32,glass,role+"-pane",lit)
        # Major vertical divisions are geometry, not a repeated atlas texture.
        for side,length in enumerate((x1-x0,y1-y0,x1-x0,y1-y0)):
            if side==2 and skip_north:
                continue
            cols=max(1,round(length/bay))
            for col in range(cols+1):
                s=col*length/cols;w=cfg["frame_width"]
                if side==0: rect=[x0+s-w/2,x0+s+w/2,y0-depth,y0+depth]
                elif side==1: rect=[x1-depth,x1+depth,y0+s-w/2,y0+s+w/2]
                elif side==2: rect=[x0+s-w/2,x0+s+w/2,y1-depth,y1+depth]
                else: rect=[x0-depth,x0+depth,y0+s-w/2,y0+s+w/2]
                box(rect,z0,z1,cfg["frame"],role+"-mullion")

    def supports(r,z0,z1,role,lean=0):
        x0,x1,y0,y1=r;w=cfg["support_width"]
        for side in (y0,y1):
            for j in range(5):
                x=x0+w+(x1-x0-2*w)*j/4
                dx=lean*(1 if j%2 else -1)
                steps=cfg.get("support_steps",1) if lean else 1
                for k in range(steps):
                    t=k/steps;u=(k+1)/steps
                    # A bounded set of overlapping extrusions follows the
                    # inclined column; no unsupported decorative vertical mast.
                    a=x+dx*t;b=x+dx*u
                    box([min(a,b)-w/2,max(a,b)+w/2,side-w/2,side+w/2],
                        z0+(z1-z0)*t,z0+(z1-z0)*u,cfg["canopy"],role)

    if name=="Waterline":
        raised,hotel_top,office_top,res_base,res_top,top=cfg["levels"]
        hotel,office,res=cfg["hotel"],cfg["office"],cfg["residential"]
        # The original site is irregular; the stepped hotel occupies its long
        # eastern arm, leaving the creek-side public space open at grade.
        box([-8,19,-48,30],0,raised,cfg["glass"][0],"lobby-core")
        supports(hotel,0,raised,"paseo-column",cfg["support_lean"])
        # Tile-quantized, distant extrusions need a real recessed backing.
        # Keep the backing physically inside separately authored face panels;
        # pane/band visibility must not rely on draw-order ties at their wall.
        box(expand(hotel,-cfg["backing_inset"]),raised,hotel_top,cfg["glass"][0],"hotel")
        skin(hotel,raised,hotel_top,cfg["floors"][0],cfg["bays"][0],cfg["glass"][0],cfg["lit"][0],cfg["occupancy"][0],"hotel")
        slab(hotel,hotel_top,cfg["canopy"],"hotel-terrace",0.8)
        ring(hotel,hotel_top+0.8,hotel_top+0.8+cfg["terrace_rail"],cfg["frame"],"hotel-rail",0.25)
        box(expand(office,-cfg["backing_inset"]),hotel_top,office_top,cfg["glass"][1],"office")
        skin(office,hotel_top,office_top,cfg["floors"][1],cfg["bays"][1],cfg["glass"][1],cfg["lit"][1],cfg["occupancy"][1],"office")
        slab(office,office_top,cfg["canopy"],"sky-terrace",0.8)
        ring(office,office_top+0.8,office_top+0.8+cfg["terrace_rail"],cfg["frame"],"sky-rail",0.25)
        box(expand(res,-8),office_top,res_base,cfg["glass"][2],"sky-lobby")
        supports(res,office_top+0.8,res_base,"sky-column",cfg["support_lean"])
        box(expand(res,-cfg["backing_inset"]),res_base,res_top,cfg["glass"][2],"residential")
        skin(res,res_base,res_top,cfg["floors"][2],cfg["bays"][2],cfg["glass"][2],cfg["lit"][2],cfg["occupancy"][2],"residential")
        slab(res,res_top,cfg["canopy"],"crown-seat",0.6)
        box(expand(res,-cfg["crown_core_inset"]),res_top,top-cfg["crown_slab"],cfg["glass"][2],"crown-glass")
        supports(res,res_top+0.6,top-cfg["crown_slab"],"crown-column",cfg["support_lean"])
        box(expand(res,cfg["crown_overhang"]),top-cfg["crown_slab"],top,cfg["canopy"],"crown-canopy")
    else:
        pod_top,office_top,res_base,res_top,top=cfg["levels"]
        parking,office,res=cfg["parking"],cfg["office"],cfg["residential"]
        box(parking,0,pod_top,"#7f8c93","parking")
        # Thin vertical screen rhythm gives the aluminum podium a different
        # material and scale from the offices above it.
        for x in range(math.ceil(parking[0]),math.floor(parking[1]),2):
            box([x,x+0.35,parking[3]-0.3,parking[3]+0.3],1.2,pod_top,"#a6b1b7","parking-fin")
        slab(parking,pod_top,cfg["canopy"],"podium-terrace",0.7)
        ring(parking,pod_top+0.7,pod_top+0.7+cfg["terrace_rail"],cfg["frame"],"podium-rail",0.25)
        # Angled southeast corner follows the view-corridor cut instead of a
        # concentric reduction of the entire original parking footprint.
        x0,x1,y0,y1=office
        inset=cfg["backing_inset"]
        poly([(x0+inset,y0+inset),(x1-10-inset,y0+inset),(x1-inset,y0+17),(x1-inset,y1-inset),(x0+inset,y1-inset),(x0+inset,y0+inset)],pod_top,office_top,cfg["glass"][0],"office")
        # Face grids follow the orthogonal remaining faces; south/east clipped
        # corner has continuous glass and the original clean diagonal outline.
        # Inset the bands to that outline by retaining only three broad faces.
        for row in range(cfg["floors"][0]):
            z=pod_top+(office_top-pod_top)*row/cfg["floors"][0]
            poly([(x0-.2,y0-.2),(x1-10,y0-.2),(x1+.2,y0+17),(x1+.2,y1+.2),(x0-.2,y1+.2),(x0-.2,y0-.2)],z,z+cfg["floor_band"],cfg["slab"],"office-floor")
        # North facade is the principal distant owner view and remains clear
        # of the angled corner; complete panes avoid a facade-atlas fallback.
        north=[x0,x1,y1-0.5,y1]
        skin(north,pod_top,office_top,cfg["floors"][0],cfg["bays"][0],cfg["glass"][0],cfg["lit"][0],cfg["occupancy"][0],"office-north")
        slab(office,office_top,cfg["slab"],"office-terrace",0.8)
        box(expand(res,-8),office_top,res_base,cfg["glass"][1],"sky-lobby")
        supports(res,office_top+0.8,res_base,"sky-column")
        x0,x1,y0,y1=res;left=x0+cfg["balcony_left"];right=x1-cfg["balcony_right"];back=y1-cfg["balcony_depth"]
        plan=[(x0,y0),(x1,y0),(x1,y1),(right,y1),(right,back),(left,back),(left,y1),(x0,y1),(x0,y0)]
        from shapely.geometry import Polygon
        backing=Polygon(plan).buffer(-cfg["backing_inset"],join_style=2)
        poly(list(backing.exterior.coords),res_base,res_top,cfg["glass"][1],"residential")
        skin(res,res_base,res_top,cfg["floors"][1],cfg["bays"][1],cfg["glass"][1],cfg["lit"][1],cfg["occupancy"][1],"residential",skip_north=True)
        dz=(res_top-res_base)/cfg["floors"][1]
        for row in range(cfg["floors"][1]):
            z=res_base+row*dz
            # skin() already emits the floor plate through the open balcony;
            # a second coplanar slab here would shimmer at grazing angles.
            box([left,right,y1-.20,y1+.20],z+cfg["rail_height"],z+cfg["rail_height"]+cfg["rail_thickness"],cfg["frame"],"balcony-rail")
            for col in range(9):
                a=left+(right-left)*col/9;b=left+(right-left)*(col+1)/9
                box([a,a+cfg["frame_width"],back,y1],z,z+dz,cfg["frame"],"balcony-divider")
                if random(f"balcony/{row}/{col}")<cfg["occupancy"][1]:
                    box([a+.3,b-.3,back-.2,back+.2],z+.45,z+dz-.35,cfg["glass"][1],"balcony-pane",cfg["lit"][1])
        # Broad curtain-wall cheek strips flank the dark balcony stack. One
        # stops below the crown, matching the asymmetric upper elevation.
        box([x0,left,y1-.3,y1+.3],res_base,res_top-2.0,cfg["glass"][0],"north-west-cheek")
        box([right,x1,y1-.3,y1+.3],res_base,res_top-13.5,cfg["glass"][0],"north-east-cheek")
        crown=expand(res,cfg["crown_overhang"])
        box(expand(crown,-cfg["crown_backing_inset"]),res_top,top,cfg["canopy"],"crown-screen")
        ring(expand(crown,.20),top-cfg["crown_band_height"],top,cfg["crown_day"],"crown-blue-edge",.35,cfg["crown_blue"])
    validate_landmark(out, cfg["height"])
    return out


def validate_landmark(features, height):
    """Check emitted geometry and sparse structural supports, not broad area.

    A terrace/canopy legitimately rests on spaced columns, so the generic
    outer detector's 50%-of-plan support rule is unsuitable. Here every raised
    structural solid must meet a lower solid at its actual base elevation.
    Decorative face panels are carried by their host wall, not independent
    floors. Validation runs for targeted updates and full city bakes alike.
    """
    from shapely.geometry import Polygon
    from shapely.strtree import STRtree
    decorative=("-pane","-mullion","-floor","-rail","-fin","-cheek","-divider","-blue-edge")
    structural=[]
    for f in features:
        p=f["properties"];q=Polygon(f["geometry"]["coordinates"][0])
        if not q.is_valid or q.area<=0 or not 0<=p.get("b",0)<p["h"]<=height:
            raise ValueError(f"invalid landmark {p['part']}")
        if not p["part"].endswith(decorative):
            structural.append((p,q))
    polygons=[q for _,q in structural];tree=STRtree(polygons)
    for i,(p,q) in enumerate(structural):
        bottom=p.get("b",0)
        if bottom<=0.1: continue
        held=False
        for j in tree.query(q):
            below,r=structural[int(j)]
            if i==j or below.get("b",0)>=bottom-.05 or below["h"]<bottom-.11:
                continue
            if q.intersection(r).area>1e-15:
                held=True;break
        if not held:
            raise ValueError(f"unsupported landmark {p['part']} at {bottom}")
    if abs(max(f["properties"]["h"] for f in features)-height)>.01:
        raise ValueError("landmark roof height changed")


def patch_landmarks(bake, path, check=False):
    """Replace only exact legacy pieces, retaining all other data verbatim.

    This mode needs no raw city extract or other lane's outputs. A full outer
    bake calls the same builders. Fail closed if a legacy shape no longer
    matches, rather than deleting anything by a broad proximity envelope.
    """
    from collections import Counter
    from shapely.geometry import Polygon
    with open(path, encoding="utf-8") as f:
        fc = json.load(f)
    source = fc["features"]

    def signature(f):
        p=f["properties"]
        coords=f["geometry"]["coordinates"][0]
        # Ring start/winding are serialization details, not ownership.
        ring=[tuple(x) for x in coords]
        if ring and ring[0]==ring[-1]: ring.pop()
        alternatives=[]
        for points in (ring,list(reversed(ring))):
            j=min(range(len(points)),key=points.__getitem__)
            alternatives.append(tuple(points[j:]+points[:j]))
        return (min(alternatives),round(p.get("b",0),1),round(p["h"],1),p.get("k"))

    indices={}
    for i,f in enumerate(source):
        indices.setdefault(signature(f),[]).append(i)
    removed=set(); replacements=[]; report={}
    for name,cfg in LANDMARKS.items():
        mine={i for i,f in enumerate(source) if f["properties"].get("lm")==cfg["key"]}
        if not mine:
            raw=bake.to_metres(cfg["footprint"])
            r=bake.simplify_ring(raw,bake.SIMPLIFY_TOWER)
            old={"type":"Feature","geometry":{"type":"Polygon","coordinates":[bake.to_degrees(r)]},
                 "properties":{"h":cfg["height"],"t":1,"wd":"#688090","wg":"#688090","wn":"#172838","d":0},
                 "_m":r,"_h":cfg["height"],"_area":bake.ring_area(raw),"_base":"#688090",
                 "_name":name,"_fade":0,"_ovh":cfg["raw_height"],"_tower":True,"_dt":True}
            extras=bake.downtown_detail([old],{},use_landmarks=False)
            for legacy in [old]+extras:
                found=indices.get(signature(legacy),[])
                if len(found)!=1:
                    raise ValueError(f"{name}: legacy piece has {len(found)} matches at {legacy['properties'].get('b',0)}..{legacy['properties']['h']}; leave city untouched")
                mine.add(found[0])
        if removed.intersection(mine):
            raise ValueError("landmark ownership overlaps")
        removed.update(mine)
        new=build_landmark(bake,name)
        for f in new:
            p=f["properties"];shape=Polygon(f["geometry"]["coordinates"][0])
            if not shape.is_valid or shape.area<=0 or not 0<=p.get("b",0)<p["h"]<=cfg["height"]:
                raise ValueError(f"{name}: invalid {p['part']}")
        replacements.extend(new)
        report[name]={"removed":len(mine),"features":len(new),"top":max(f["properties"]["h"] for f in new),
                      "parts":dict(Counter(f["properties"]["part"] for f in new))}
    untouched=[f for i,f in enumerate(source) if i not in removed]
    result=untouched+replacements
    # Reruns are stable, and non-target feature values/order are untouched.
    assert [f for f in result if not f["properties"].get("lm")]==untouched
    report["preserved_features"]=len(untouched)
    report["preserved_sha256"]=hashlib.sha256(json.dumps(untouched,separators=(",",":"),sort_keys=True).encode()).hexdigest()
    if check:
        if source!=result:
            raise ValueError("landmark output is stale; run --landmarks-only")
    else:
        fc["features"]=result
        with open(path,"w",encoding="utf-8") as f:
            json.dump(fc,f,separators=(",",":"))
    return report
