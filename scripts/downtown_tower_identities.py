"""Downtown tower massing and architectural skins for the outer-ring bake.

Public height/position corrections live in outer_heights.json. Plan dimensions,
setbacks and finish values here are bounded photo fits, not survey measurements.
The two previously authored landmarks remain in downtown_landmarks.py.

Glass bodies retain the shared atlas (including its night windows); only actual
slabs, recessed balconies, fins and crowns become extra geometry. No individual
window meshes, image textures or private reference paths are embedded here.
"""
import json
import math
from pathlib import Path


TUNING = {
    "bearing": 18.0, "floor_band": 0.32, "band_projection": 0.36,
    "balcony_projection": 1.4, "rail_height": 1.05, "rail_depth": 0.22,
    "pier_width": 0.65, "mullion_width": 0.24, "mullion_depth": 0.32,
    "lobby_height": 5.2, "podium_band": 0.7, "crown_edge": 0.4,
    "crown_slices": 24, "curve_segments": 16, "crown_light": "#d5dce1",
    "podium_floor": 3.8, "podium_glass_height": 1.35,
    "lobby_glass": "#31424b", "rail_glass": "#5c7780",
    "recess": "#273940", "roof": "#747f83", "terrace": "#acb4b2",
    "ring_width": 0.5, "chamfer_cut": 3, "pier_spacing": 8,
    "balcony_field": (0.35,0.65), "balcony_depth_factor": 1.7,
    "fallback_podium_margin": 6, "lobby_pier_margin": 3,
    "lobby_pier_spacing": 9, "lobby_pier_width": 0.9,
}

# Photo-fit dimensions are data, including secondary roof and podium choices.
# Values are local metres unless named as a fraction, count, side or slice.
FORM_DETAILS = {
    "jenga": dict(floor_pitch=3.35, pier_width=0.5,
        terrace_projection=1.8, terrace_depth=0.75,
        trench_fields=(((0.12,0.23),(0.44,0.55),(0.76,0.87)),
                       ((0.12,0.23),(0.44,0.55),(0.76,0.87)),
                       ((0.12,0.23),(0.44,0.55),(0.76,0.87)),
                       ((0.23,0.36),(0.64,0.77))),
        trench_depth=2.5, trench_back_depth=0.18, trench_back_color="#263d4b",
        slab_projection=0.25, deck_overlap=0.18, deck_projection=0.25,
        trench_pier_depth=0.32,
        crown_shift=(3,2), core_inset=5, core_gap=1, crown_pier_spacing=6,
        crown_pier_width=0.7, lattice_levels=(0.7,5), lattice_top_gap=0.5, lattice_depth=0.45),
    "austonian": dict(south_balcony=(0.42,0.59), north_balcony=(0.20,0.37),
        north_deck_inset=4, upper_pier_halfwidth=0.375, upper_pier_span=50,
        crown_insets=(5,3,5,3), core_gap=5, screen_depth=0.55, crown_slope=4, rim_depth=0.35),
    "frost": dict(core_inset=8, corner_cut=5, shoulder_width=12, shoulder_end_inset=4,
        cross_shoulder_inset=7, cross_shoulder_width=11, shoulder_levels=(0.58,0.67,0.75,0.82),
        pier_spacing=4, core_pier_width=0.28, petal_retreat=6, petal_fold_out=2,
        petal_fold_in=4, petal_tip_taper=1, rib_halfwidth=0.22),
    "sail": dict(slices_per_floor=2, terrace_begin=0.28, terrace_steps=10,
        terrace_divisor=7, corner_cut=1.5, slab_projection=0.25, slab_depth=0.28,
        terrace_slices=(20,30,40,50,60), terrace_front=2, terrace_back=0.6, terrace_depth=0.7),
    "american": dict(steps=9, west_step=2.6, south_step=2.1, cap_projection=0.35,
        cap_depth=0.85, cap_width=1.4, wing_steps=3, wing_projection=8, wing_step=3,
        wing_width=9, wing_base_height=10, wing_height_step=4, wing_cap_depth=0.7),
    "congress": dict(gables=3, side_step=3, end_step=7, initial_drop=14, slices=16),
    "northshore": dict(lower_top=48, middle_top=88, middle_inset=16, upper_inset=30,
        floor_pitch=3.35, pier_spacing=12, pier_width=1.5, terrace_projection=0.8, terrace_depth=1.2),
    "republic": dict(seam_depth=0.2, fin_steps=12, fin_corner_margin=1),
    "360": dict(annex_west=14, annex_overlap=6, annex_north=8, annex_top=55, annex_rows=10,
        corner_cut=4, south_balcony=(0.08,0.92), north_balcony=(0.08,0.40),
        core_inset=5, core_height=6, mast_offsets=(5,4,4,5)),
    "fairmont": dict(mechanical_height=4, corner_cut=4, roof_side_inset=7,
        roof_end_inset=2, mast_offsets=(10,9,4,5), light_depth=0.5),
    "modern": dict(balcony_start=10, balcony_rows_offset=3, south_balcony=(0.04,0.96),
        east_balcony=(0.10,0.43), pier_spacing=11, pier_width=0.8, core_inset=3,
        comb_count=5, comb_end_margin=3, comb_width=0.65, comb_back=3, comb_front=0.5,
        beam_back=3.5, beam_front=2.8, beam_depth=0.6),
    "natiivo": dict(pier_spacing=7, pier_width=1.6, balcony_field=(0.18,0.80),
        cap_projection=1, cap_depth=1),
    "rainey": dict(amenity_inset=3, amenity_halfheight=5, amenity_pier_spacing=10,
        amenity_pier_width=1.1, pier_spacing=9, pier_width=1.3, south_balcony=(0.32,0.68),
        east_balcony=(0.06,0.27), roof_side_inset=5, roof_end_inset=4),
    "seaholm": dict(balcony_field=(0.1,0.86), pier_spacing=13, pier_width=0.85, cap_depth=1),
    "colorado": dict(panel_rows=10, slab_projection=0.15, pier_spacing=11,
        pier_width=0.6, core_inset=3, blade_depth=0.8, blade_projection=1.2),
    "marriott": dict(wing_projection=8, wing_overlap=2, wing_end_inset=4,
        wing_height_fraction=0.74, pier_spacing=5.8, pier_width=0.85,
        slab_projection=0.30, cap_depth=0.65),
    "w": dict(balcony_height_fraction=0.45, balcony_field=(0.37,0.63),
        balcony_row_divisor=2, minimum_balcony_rows=4, wing_projection=0.5, wing_width=3, cap_depth=0.6),
    "415": dict(trench=(0.44,0.72), trench_depth=3.5, pier_spacing=10, pier_width=1.3,
        screen_slices=20, screen_width_fraction=0.58, screen_drop=11, rim_depth=0.7,
        terrace_depth=0.65, crown_night="#e9c798"),
    "east44": dict(corner_cut=3, balcony_field=(0.18,0.62), edge_balcony=(0.18,0.86),
        pier_spacing=3, pier_width=0.35, crown_drop=5, crown_slices=16,
        crown_depth=0.65, crown_inset=3, crown_core_gap=6, podium_pier_spacing=3.2,
        podium_pier_width=0.4, podium_pier_depth=0.35),
    "paseo": dict(amenity_height=6, amenity_inset=5, amenity_pier_spacing=12,
        amenity_pier_width=1.5, pier_spacing=8.8, pier_width=1.65,
        south_balcony=(0.06,0.93), east_balcony=(0.12,0.70),
        upper_step=4, upper_inset=10, roof_blade_projection=1.5, roof_blade_depth=0.65,
        mechanical_insets=(8,15,5,8)),
    "travis": dict(spine_from_east=6, spine_width=2.2, spine_depth=0.65,
        pier_spacing=8, pier_width=0.8, balcony_field=(0.20,0.48),
        side_balcony=(0.12,0.92), upper_balcony_gap=14, crown_side_step=5,
        crown_side_width=6, crown_band_rows=3, roof_rim_depth=0.5),
    "atx": dict(office_top=76, office_margin=5, office_rows=10, transfer_height=8,
        transfer_inset=4, transfer_pier_spacing=10, transfer_pier_width=1.4,
        residential_rows=33, trench=(0.43,0.62), trench_depth=3,
        side_balcony=(0.08,0.92), wing_inset=9, top_beam_height=6,
        roof_edge_depth=0.4, street_fin_spacing=3, street_fin_width=0.4,
        street_fin_color="#9b7750"),
    "indeed": dict(join_start=-10, join_retreat=8, wing_front_inset=5, wing_back_inset=4,
        wing_top=133, fold_width=0.85, fold_color="#30434f", roof_drop=22,
        roof_slices=24, roof_edge_depth=0.4, pier_spacing=8, pier_width=0.32,
        terrace_levels=(78,91,104), terrace_width=11, terrace_depth=2,
        terrace_height=0.65, terrace_guard_height=1.05),
}

# r is [west,east,south,north] in the street-aligned metre frame. Every
# aesthetic choice is declared here; the builder below shares its primitives.
TOWER_IDENTITIES = {
    "The Independent": dict(key="independent", form="jenga", r=[-21,21,-18,18], podium=18, floors=58,
        glass="#426a89", frame="#aebac2", podium_color="#aeb7b7", crown=10,
        stages=[(18,73,-4,0),(73,116,5,1),(116,158,-5,-2),(158,None,3,2)]),
    "The Austonian": dict(key="austonian", form="austonian", r=[-20,20,-16,16], podium=24, floors=56,
        glass="#456f88", frame="#c5ccca", podium_color="#c7c3b6", crown=13),
    "Frost Bank Tower": dict(key="frost-bank", form="frost", r=[-25,25,-22,22], podium=8, floors=33,
        glass="#456f80", frame="#a5b9bf", podium_color="#8b9e9f", crown=32,
        crown_glass="#88aaa9", crown_night="#c6d9d9"),
    "360 Condominiums": dict(key="360-condominiums", form="360", r=[-15,15,-19,19], podium=19, floors=45, facade_floors=44,
        glass="#668ba3", frame="#bdc8cc", podium_color="#aaaead", crown=14),
    "Block 185": dict(key="block-185", form="sail", r=[-35,35,-31,31], podium=28, floors=35,
        glass="#527d91", frame="#a8bac0", podium_color="#849399", crown=0,
        terrace_color="#d4cdc2", sail_retreat=59, sail_power=2.0, south_retreat=26),
    "Modern Austin Residences": dict(key="modern-austin", form="modern", r=[-17,17,-17,17], podium=30, floors=55,
        glass="#4d6575", frame="#b9c0bc", podium_color="#8c9494", crown=5),
    "Natiivo": dict(key="natiivo", form="natiivo", r=[-15,15,-14,14], podium=21, floors=33,
        glass="#496272", frame="#d4d1c5", podium_color="#a8aaa2", crown=1),
    "70 Rainey": dict(key="70-rainey", form="rainey", r=[-18,18,-14,14], podium=32, floors=33,
        glass="#52788b", frame="#414e58", podium_color="#555f60", crown=5,
        center=[-97.739113,30.258575], height=127.7),
    "Northshore": dict(key="northshore", form="northshore", r=[-32,32,-17,17], podium=24, floors=38,
        glass="#5b7c8d", frame="#c4c5b9", podium_color="#b5b4a7", crown=2),
    "Seaholm Residences": dict(key="seaholm", form="seaholm", r=[-27,27,-12,12], podium=19, floors=30,
        glass="#637d85", frame="#c2c6c9", podium_color="#b1b6b7", crown=1),
    "Colorado Tower": dict(key="colorado-tower", form="colorado", r=[-23,23,-17,17], podium=19, floors=29,
        glass="#4d768a", frame="#8899a4", podium_color="#818c91", crown=5),
    "One American Center": dict(key="one-american", form="american", r=[-23,23,-20,20], podium=16, floors=32,
        glass="#d0cabb", frame="#b8b0a1", podium_color="#cbc4b3", crown=35,
        cap="#8e8170"),
    "100 Congress": dict(key="100-congress", form="congress", r=[-21,21,-16,16], podium=12, floors=22,
        glass="#827269", frame="#b6aa96", podium_color="#b8ac94", crown=22,
        crown_glass="#52646e"),
    "JW Marriott": dict(key="jw-marriott", form="marriott", r=[-29,29,-16,16], podium=20, floors=34,
        glass="#a08c7d", frame="#a68876", podium_color="#c6bcaa", crown=3,
        center=[-97.742935,30.26466], height=124.4),
    "Fairmont Austin": dict(key="fairmont", form="fairmont", r=[-31,31,-16,16], podium=23, floors=36, facade_height=124,
        glass="#85999f", frame="#c6cdcc", podium_color="#a6aaa5", crown=52, crown_night="#476ce0"),
    "W Austin": dict(key="w-austin", form="w", r=[-24,24,-15,15], podium=23, floors=36,
        glass="#44728c", frame="#687f8c", podium_color="#25394b", crown=0.6,
        center=[-97.746994,30.265926], height=145.3, dark_wing="#344f61"),
    "The Republic": dict(key="republic", form="republic", r=[-26,26,-23,23], podium=28, floors=46,
        glass="#567d94", frame="#bdc9cf", podium_color="#899da5", crown=43, reveal="#273b48",
        shaft_retreat=18, upper_retreat=6, upper_start=0.78, corner_cut=4,
        seam_x=4, seam_width=1.1, fin_spacing=3.5, fin_width=0.38, fin_depth=0.6),
    "415 Colorado": dict(key="415-colorado", form="415", r=[-19,19,-16,16], podium=38, floors=50,
        glass="#65898e", frame="#bec1b8", podium_color="#647a80", crown=18),
    "44 East": dict(key="44-east", form="east44", r=[-19,19,-14,14], podium=30, floors=50,
        glass="#497a93", frame="#adbfc5", podium_color="#424b50", crown=10),
    "Paseo": dict(key="paseo", form="paseo", r=[-21,21,-15,15], podium=36, floors=48,
        glass="#527278", frame="#c8c7b9", podium_color="#b6ac98", crown=8),
    "The Travis": dict(key="the-travis", form="travis", r=[-15,15,-14,14], podium=24, floors=50,
        glass="#386b84", frame="#c9c9bd", podium_color="#a8b3b1", crown=12),
    "ATX Tower": dict(key="atx-tower", form="atx", r=[-18.5,18.5,-15,15], podium=36, floors=58,
        glass="#748b9e", frame="#b4bdc1", podium_color="#6f797d", crown=18),
    "Indeed Tower": dict(key="indeed-tower", form="indeed", r=[-25,25,-20,20], podium=8, floors=36,
        glass="#7195ad", frame="#b8c9d2", podium_color="#94a7ad", crown=27,
        glazed_podium=True),
}

# Heights and centres remain the existing public-data inventory authority.
_inventory = json.loads(Path(__file__).with_name("outer_heights.json").read_text(encoding="utf-8"))
for _cfg in TOWER_IDENTITIES.values():
    _cfg["detail"] = FORM_DETAILS[_cfg["form"]]
for _row in _inventory["by_point"]:
    if _row.get("name") in TOWER_IDENTITIES:
        _cfg = TOWER_IDENTITIES[_row["name"]]
        _cfg.setdefault("center", [_row["lon"], _row["lat"]])
        _cfg.setdefault("height", _row["height"])


def build_tower_identity(bake, name, height=None, fade=0, footprint=None):
    """Return the complete replacement feature list for one named tower.

    ``footprint`` is the already matched source footprint in bake metre space.
    It is used for the podium, preserving parcel alignment while shaft widths
    and all distinctive roof forms are explicit building-specific photo fits.
    """
    from downtown_facade_profiles import profile_for
    cfg = TOWER_IDENTITIES[name]
    detail = cfg["detail"]
    h = cfg["height"] if height is None else height
    if abs(h - cfg["height"]) > 0.8:
        raise ValueError(f"{name}: public height changed; refit authored tower")
    origin = bake.to_metres([cfg["center"]])[0]
    angle = math.radians(cfg.get("bearing", TUNING["bearing"]))
    cs, sn = math.cos(angle), math.sin(angle)
    out = []
    r = cfg["r"]
    ph = cfg["podium"]
    fp = profile_for(name, "residential" if cfg["form"] in (
        "jenga", "austonian", "360", "modern", "natiivo", "rainey", "northshore", "seaholm", "415", "east44", "paseo", "travis", "atx")
        else "commercial", h, (r[1]-r[0])*(r[3]-r[2]))

    def world(p):
        return (origin[0]+p[0]*cs+p[1]*sn, origin[1]-p[0]*sn+p[1]*cs)

    def poly(points, z0, z1, color, role, patterned=False, glass=False, emit=False, night=None, metric=False):
        if z1 <= z0:
            return
        points = list(points)
        if points[0] != points[-1]:
            points.append(points[0])
        solid = bake.piece(points if metric else [world(p) for p in points], z0, z1,
                           color, fade, kind=None if patterned else "c", tower=patterned)
        props = solid["properties"]
        props.update(lm=cfg["key"], part=role, d=0)
        if patterned:
            props["fp"] = fp
        if glass and not patterned:
            props["lmGlass"] = 1
        if emit:
            props["lmEmit"] = 1
            props["wn"] = night or TUNING["crown_light"]
        out.append(solid)
        return solid

    def rect(rr):
        a,b,c,d=rr
        return [(a,c),(b,c),(b,d),(a,d)]

    def box(rr,z0,z1,color,role,**kw):
        return poly(rect(rr),z0,z1,color,role,**kw)

    def expand(rr,n):
        a,b,c,d=rr
        return [a-n,b+n,c-n,d+n]

    def moved(rr,x=0,y=0):
        return [rr[0]+x,rr[1]+x,rr[2]+y,rr[3]+y]

    def chamfer(rr,cut=TUNING["chamfer_cut"]):
        a,b,c,d=rr
        cut=min(cut,(b-a)/3,(d-c)/3)
        return [(a+cut,c),(b-cut,c),(b,c+cut),(b,d-cut),(b-cut,d),(a+cut,d),(a,d-cut),(a,c+cut)]

    def ellipse(rr):
        a,b,c,d=rr
        return [((a+b)/2+(b-a)/2*math.cos(i*2*math.pi/TUNING["curve_segments"]),
                 (c+d)/2+(d-c)/2*math.sin(i*2*math.pi/TUNING["curve_segments"]))
                for i in range(TUNING["curve_segments"])]

    def ring(rr,z,thick,color=None,role="terrace-edge",width=TUNING["ring_width"],emit=False,night=None):
        a,b,c,d=rr
        for edge in ([a,b,c,c+width],[a,b,d-width,d],[a,a+width,c+width,d-width],[b-width,b,c+width,d-width]):
            box(edge,z,z+thick,color or cfg["frame"],role,emit=emit,night=night)

    def bands(rr,z0,z1,count,projection=None,color=None,shape=None):
        rr=expand(rr,TUNING["band_projection"] if projection is None else projection)
        dz=(z1-z0)/max(1,count)
        for row in range(1,count+1):
            z=min(z1-TUNING["floor_band"],z0+row*dz)
            poly((shape or rect)(rr),z,z+TUNING["floor_band"],color or cfg["frame"],"floor-band")

    def shaft(rr,z0,z1,count=None,shape=None,balconies=False):
        poly((shape or rect)(rr),z0,z1,cfg["glass"],"tower-glazing",patterned=True)
        if count:
            bands(rr,z0,z1,count,projection=TUNING["balcony_projection"] if balconies else None,shape=shape)

    def piers(rr,z0,z1,spacing=TUNING["pier_spacing"],width=None,color=None,sides=(0,1,2,3)):
        a,b,c,d=rr;w=width or TUNING["pier_width"];depth=TUNING["mullion_depth"]
        for side in sides:
            lo,hi=(a,b) if side%2==0 else (c,d)
            count=max(1,round((hi-lo)/spacing))
            for j in range(count+1):
                p=lo+(hi-lo)*j/count
                edge=([p-w/2,p+w/2,c-depth,c+depth] if side==0 else
                      [b-depth,b+depth,p-w/2,p+w/2] if side==1 else
                      [p-w/2,p+w/2,d-depth,d+depth] if side==2 else
                      [a-depth,a+depth,p-w/2,p+w/2])
                box(edge,z0,z1,color or cfg["frame"],"facade-pier")

    def balcony_stack(rr,z0,z1,count,side=0,frac=TUNING["balcony_field"],inset=0):
        # Separate narrow fields project beyond the glass body. The set-back
        # body remains visible behind each deck; no fake dark wall rectangles.
        a,b,c,d=rr;dep=TUNING["balcony_projection"]*TUNING["balcony_depth_factor"]
        s,t=frac;lo,hi=(a,b) if side%2==0 else (c,d)
        v0,v1=lo+(hi-lo)*s,lo+(hi-lo)*t
        field=([v0,v1,c-dep,c+inset] if side==0 else [b-inset,b+dep,v0,v1] if side==1 else
               [v0,v1,d-inset,d+dep] if side==2 else [a-dep,a+inset,v0,v1])
        rail=(field[:2]+[field[2],field[2]+TUNING["rail_depth"]] if side==0 else
              [field[1]-TUNING["rail_depth"],field[1],field[2],field[3]] if side==1 else
              field[:2]+[field[3]-TUNING["rail_depth"],field[3]] if side==2 else
              [field[0],field[0]+TUNING["rail_depth"],field[2],field[3]])
        dz=(z1-z0)/count
        for j in range(count):
            z=z0+j*dz
            box(field,z,z+TUNING["floor_band"],cfg["frame"],"balcony-deck")
            box(rail,z+TUNING["floor_band"],z+TUNING["rail_height"],TUNING["rail_glass"],"balcony-guard",glass=True)

    # Street-scaled podium and an actual inset, darker lobby. Source footprint
    # is retained instead of making every parcel a new large rectangle.
    podium_ring=footprint or [world(p) for p in rect(expand(r,TUNING["fallback_podium_margin"]))]
    poly(podium_ring,0,TUNING["lobby_height"],TUNING["lobby_glass"],"lobby-glass",metric=True,glass=True)
    z=TUNING["lobby_height"]
    if cfg.get("glazed_podium"):
        poly(podium_ring,z,ph,cfg["glass"],"podium-glazing",metric=True,glass=True)
        z=ph
    while z < ph:
        cap=min(ph,z+TUNING["podium_floor"]-TUNING["podium_glass_height"])
        poly(podium_ring,z,cap,cfg["podium_color"],"podium-spandrel",metric=True)
        end=min(ph,z+TUNING["podium_floor"])
        poly(podium_ring,cap,end,TUNING["lobby_glass"],"podium-window-band",metric=True,glass=True)
        z=end
    poly(podium_ring,ph,ph+TUNING["podium_band"],cfg["frame"],"podium-cap",metric=True)
    piers(expand(r,TUNING["lobby_pier_margin"]),0,TUNING["lobby_height"],spacing=TUNING["lobby_pier_spacing"],width=TUNING["lobby_pier_width"],color=cfg["podium_color"])
    form=cfg["form"]
    top=h-cfg["crown"]
    floor_height=cfg.get("facade_height",h)
    count=max(4,round(cfg.get("facade_floors",cfg["floors"])*(min(top,floor_height)-ph)/floor_height))

    if form=="jenga":
        for i,(z0,z1,x,y) in enumerate(cfg["stages"]):
            z1=top if z1 is None else z1
            rr=moved(r,x,y)
            fields=detail["trench_fields"][i]
            def notched(q):
                a,b,c,d=q;depth=detail["trench_depth"]
                pts=[(a,c)]
                for s,t in fields:
                    lo,hi=a+(b-a)*s,a+(b-a)*t
                    pts.extend([(lo,c),(lo,c+depth),(hi,c+depth),(hi,c)])
                pts.extend([(b,c),(b,d)])
                for s,t in reversed(fields):
                    lo,hi=a+(b-a)*s,a+(b-a)*t
                    pts.extend([(hi,d),(hi,d-depth),(lo,d-depth),(lo,d)])
                pts.append((a,d))
                return pts
            rows=round((z1-z0)/detail["floor_pitch"])
            shaft(rr,z0,z1,shape=notched)
            bands(rr,z0,z1,rows,projection=detail["slab_projection"],shape=notched)
            # Cut the glass body itself: these are open balcony trenches,
            # with dark rear walls and decks inside the original facade line.
            a,b,c,d=rr
            for side in (0,2):
                front=c if side==0 else d
                back=front+(detail["trench_depth"] if side==0 else -detail["trench_depth"])
                for s,t in fields:
                    lo,hi=a+(b-a)*s,a+(b-a)*t
                    box([lo,hi,back-detail["trench_back_depth"],back+detail["trench_back_depth"]],z0,z1,detail["trench_back_color"],"recessed-balcony-back",glass=True)
                    for edge in (lo,hi):
                        box([edge-detail["pier_width"]/2,edge+detail["pier_width"]/2,front-detail["trench_pier_depth"],front+detail["trench_pier_depth"]],z0,z1,cfg["frame"],"balcony-edge-pier")
                    deck=[lo-detail["deck_overlap"],hi+detail["deck_overlap"],
                          front-detail["deck_projection"] if side==0 else back-detail["deck_overlap"],
                          back+detail["deck_overlap"] if side==0 else front+detail["deck_projection"]]
                    rail=[deck[0],deck[1],front-TUNING["rail_depth"]/2,front+TUNING["rail_depth"]/2]
                    for row in range(rows):
                        z=z0+row*(z1-z0)/rows
                        box(deck,z,z+TUNING["floor_band"],cfg["frame"],"recessed-balcony-deck")
                        box(rail,z+TUNING["floor_band"],z+TUNING["rail_height"],TUNING["rail_glass"],"recessed-balcony-guard",glass=True)
            box(expand(rr,detail["terrace_projection"]),z0,z0+detail["terrace_depth"],cfg["frame"],"cantilever-terrace")
        rr=moved(r,*detail["crown_shift"])
        box(expand(rr,-detail["core_inset"]),top,h-detail["core_gap"],cfg["glass"],"crown-core",glass=True)
        piers(rr,top,h,spacing=detail["crown_pier_spacing"],width=detail["crown_pier_width"])
        for z in (*(top+dz for dz in detail["lattice_levels"]),h-detail["lattice_top_gap"]):
            ring(rr,z,detail["lattice_depth"],role="open-crown-lattice",emit=True)
    elif form=="austonian":
        shaft(r,ph,top,count,shape=ellipse)
        # Broad concrete upper framing and the vertical recessed balcony slot
        # distinguish the round shaft from a generic tapered office building.
        balcony_stack(r,ph,top,count,side=0,frac=detail["south_balcony"])
        balcony_stack(r,ph,top,count,side=2,frac=detail["north_balcony"],inset=detail["north_deck_inset"])
        for x,y in ellipse(r):
            box([x-detail["upper_pier_halfwidth"],x+detail["upper_pier_halfwidth"],y-detail["upper_pier_halfwidth"],y+detail["upper_pier_halfwidth"]],top-detail["upper_pier_span"],top,cfg["frame"],"curved-facade-pier")
        cr=[r[0]+detail["crown_insets"][0],r[1]-detail["crown_insets"][1],r[2]+detail["crown_insets"][2],r[3]-detail["crown_insets"][3]]
        poly(ellipse(cr),top,h-detail["core_gap"],cfg["glass"],"curved-crown-core",glass=True)
        outer=ellipse(cr);inner=ellipse(expand(cr,-detail["screen_depth"]))
        for j,a in enumerate(outer):
            k=(j+1)%len(outer);b=outer[k]
            # The crown is a curved screen with an oblique top, not a mast.
            zh=h-detail["crown_slope"]+detail["crown_slope"]*max(a[0]-cr[0],b[0]-cr[0])/(cr[1]-cr[0])
            panel=[a,b,inner[k],inner[j]]
            poly(panel,top,zh,cfg["glass"],"curved-crown-screen",glass=True)
            poly(panel,zh-detail["rim_depth"],zh,cfg["frame"],"sloped-crown-rim")
    elif form=="frost":
        shaft(expand(r,-detail["core_inset"]),ph,top,shape=lambda rr:chamfer(rr,detail["corner_cut"]))
        # Staggered buttresses make the shaft itself stepped, before its four
        # folded crown petals. No pyramid or single gable substitutes for it.
        for rr,zh in (([r[0],r[0]+detail["shoulder_width"],r[2]+detail["shoulder_end_inset"],r[3]-detail["shoulder_end_inset"]],h*detail["shoulder_levels"][0]),
                      ([r[1]-detail["shoulder_width"],r[1],r[2]+detail["shoulder_end_inset"],r[3]-detail["shoulder_end_inset"]],h*detail["shoulder_levels"][1]),
                      ([r[0]+detail["cross_shoulder_inset"],r[1]-detail["cross_shoulder_inset"],r[2],r[2]+detail["cross_shoulder_width"]],h*detail["shoulder_levels"][2]),
                      ([r[0]+detail["cross_shoulder_inset"],r[1]-detail["cross_shoulder_inset"],r[3]-detail["cross_shoulder_width"],r[3]],h*detail["shoulder_levels"][3])):
            shaft(rr,ph,zh)
            piers(rr,ph,zh,spacing=detail["pier_spacing"],width=TUNING["mullion_width"])
        cr=expand(r,-detail["core_inset"])
        shaft(cr,h*detail["shoulder_levels"][1],top,shape=lambda rr:chamfer(rr,detail["corner_cut"]))
        piers(cr,ph,top,spacing=detail["pier_spacing"],width=detail["core_pier_width"])
        a,b,c,d=cr
        for side in range(4):
            for j in range(TUNING["crown_slices"]):
                t=j/TUNING["crown_slices"];u=(j+1)/TUNING["crown_slices"]
                width=(b-a if side%2==0 else d-c)*(1-t)/2
                inset=t*detail["petal_retreat"]
                fold_out=detail["petal_fold_out"]*(1-t)**detail["petal_tip_taper"]
                fold_in=detail["petal_fold_in"]*(1-t)**detail["petal_tip_taper"]
                pts=([(-width,c+inset),(0,c-fold_out+inset),(width,c+inset),(0,c+fold_in+inset)] if side==0 else
                     [(b-inset,-width),(b+fold_out-inset,0),(b-inset,width),(b-fold_in-inset,0)] if side==1 else
                     [(-width,d-inset),(0,d+fold_out-inset),(width,d-inset),(0,d-fold_in-inset)] if side==2 else
                     [(a+inset,-width),(a-fold_out+inset,0),(a+inset,width),(a+fold_in+inset,0)])
                z=top+(h-top)*t;zu=top+(h-top)*u
                poly(pts,z,zu,cfg["crown_glass"],"folded-crown-petal",glass=True,emit=True,night=cfg["crown_night"])
                # Silver folded-edge ribs make the individual petals legible.
                for x,y in (pts[0],pts[1],pts[2]):
                    box([x-detail["rib_halfwidth"],x+detail["rib_halfwidth"],y-detail["rib_halfwidth"],y+detail["rib_halfwidth"]],z,zu,cfg["frame"],"crown-fold-rib")
    elif form=="sail":
        # Two slices per storey keep the curving western sail recognisable
        # without a large triangle mesh. The south face separately terraces.
        levels=cfg["floors"]*detail["slices_per_floor"]
        for j in range(levels):
            t=j/levels;u=(j+1)/levels
            west=r[0]+cfg["sail_retreat"]*(t**cfg["sail_power"])
            south=r[2]+cfg["south_retreat"]*(math.floor(max(0,t-detail["terrace_begin"])*detail["terrace_steps"])/detail["terrace_divisor"])
            rr=[west,r[1],south,r[3]]
            z=ph+(h-ph)*t;zu=ph+(h-ph)*u
            shaft(rr,z,zu,shape=lambda q:chamfer(q,detail["corner_cut"]))
            if j%detail["slices_per_floor"]==0:
                poly(chamfer(expand(rr,detail["slab_projection"]),detail["corner_cut"]),z,z+detail["slab_depth"],cfg["frame"],"sail-floor-edge")
            if j in detail["terrace_slices"]:
                box([west,r[1],south-detail["terrace_front"],south+detail["terrace_back"]],z,z+detail["terrace_depth"],cfg["terrace_color"],"south-terrace")
    elif form=="american":
        shaft(r,ph,top)
        # Terraces ascend from the south and west; the north/east stay tall.
        for j in range(detail["steps"]):
            rr=[r[0]+j*detail["west_step"],r[1],r[2]+j*detail["south_step"],r[3]]
            z=top+j*(h-top)/detail["steps"];zu=top+(j+1)*(h-top)/detail["steps"]
            shaft(rr,z,zu)
            ring(expand(rr,detail["cap_projection"]),zu-detail["cap_depth"],detail["cap_depth"],cfg["cap"],"brown-terrace-cap",width=detail["cap_width"])
        for j in range(detail["wing_steps"]):
            rr=[r[0]-detail["wing_projection"]+j*detail["wing_step"],r[0]+detail["wing_width"],r[2]-detail["wing_projection"]+j*detail["wing_step"],r[3]-detail["wing_step"]]
            shaft(rr,ph,ph+detail["wing_base_height"]+j*detail["wing_height_step"])
            ring(rr,ph+detail["wing_base_height"]+j*detail["wing_height_step"],detail["wing_cap_depth"],cfg["cap"],"podium-step")
    elif form=="congress":
        shaft(r,ph,top)
        # Three triangular, bronze-glass gables step toward a full-width ridge.
        for k in range(detail["gables"]):
            rr=[r[0]+k*detail["side_step"],r[1]-k*detail["side_step"],r[2]+k*detail["end_step"],r[3]]
            base=top-detail["initial_drop"]+k*detail["end_step"]; peak=h-detail["initial_drop"]+k*detail["end_step"]
            for j in range(detail["slices"]):
                t=j/detail["slices"];u=(j+1)/detail["slices"]
                q=[rr[0]+(rr[1]-rr[0])*t/2,rr[1]-(rr[1]-rr[0])*t/2,rr[2],rr[3]]
                box(q,base+(peak-base)*t,base+(peak-base)*u,cfg["crown_glass"],"stepped-glass-gable",glass=True)
    elif form=="northshore":
        stages=[([r[0],r[1],r[2],r[3]],ph,detail["lower_top"]),([r[0]+detail["middle_inset"],r[1],r[2],r[3]],detail["lower_top"],detail["middle_top"]),([r[0]+detail["upper_inset"],r[1],r[2],r[3]],detail["middle_top"],top)]
        for rr,z,zu in stages:
            shaft(rr,z,zu,round((zu-z)/detail["floor_pitch"]))
            piers(rr,z,zu,spacing=detail["pier_spacing"],width=detail["pier_width"])
            ring(expand(rr,detail["terrace_projection"]),zu,detail["terrace_depth"],role="cream-terrace")
        ring(expand(stages[-1][0],detail["terrace_projection"]),top+detail["terrace_depth"],h-top-detail["terrace_depth"],role="flat-crown")
    elif form=="republic":
        # The diagonal begins low on the occupied shaft, not at a pyramid cap.
        # The opposing side clips back only near the flat crown. Storey slices
        # keep the long incline cheap while preserving its projected outline.
        def republic_plan(t):
            upper=max(0,(t-cfg["upper_start"])/(1-cfg["upper_start"]))
            return [r[0]+cfg["shaft_retreat"]*t,r[1]-cfg["upper_retreat"]*upper,r[2],r[3]]
        for j in range(cfg["floors"]):
            t=j/cfg["floors"];u=(j+1)/cfg["floors"]
            rr=republic_plan(t)
            shaft(rr,ph+(h-ph)*t,ph+(h-ph)*u,shape=lambda q:chamfer(q,cfg["corner_cut"]))
        x=cfg["seam_x"];w=cfg["seam_width"]
        for y in (r[2],r[3]):
            box([x-w/2,x+w/2,y-detail["seam_depth"],y+detail["seam_depth"]],ph,h,cfg["reveal"],"full-height-glass-seam")
        # Pale close vertical fins on the offset side, segmented only where
        # the edge slopes. Fin faces overlap the glazed body for real contact.
        start=cfg["upper_start"];steps=detail["fin_steps"]
        spans=[(0,start)]+[(start+(1-start)*j/steps,start+(1-start)*(j+1)/steps) for j in range(steps)]
        for t,u in spans:
            rr=republic_plan(t)
            lo,hi=r[2]+cfg["corner_cut"]+detail["fin_corner_margin"],r[3]-cfg["corner_cut"]-detail["fin_corner_margin"]
            n=round((hi-lo)/cfg["fin_spacing"])
            for j in range(n+1):
                y=lo+(hi-lo)*j/n
                box([rr[1]-cfg["fin_depth"],rr[1]+cfg["fin_depth"],y-cfg["fin_width"]/2,y+cfg["fin_width"]/2],
                    ph+(h-ph)*t,ph+(h-ph)*u,cfg["frame"],"pale-side-fin")
    elif form=="indeed":
        # The lower wing and main slab meet on a full-height diagonal fold.
        # Storey slices describe that crease without a dense custom mesh.
        for j in range(cfg["floors"]):
            t=j/cfg["floors"];u=(j+1)/cfg["floors"]
            z=ph+(top-ph)*t;zu=ph+(top-ph)*u
            x=detail["join_start"]+detail["join_retreat"]*t
            shaft([x,r[1],r[2],r[3]],z,zu)
            if z<detail["wing_top"]:
                shaft([r[0],x,r[2]+detail["wing_front_inset"],r[3]-detail["wing_back_inset"]],z,min(zu,detail["wing_top"]))
                box([x-detail["fold_width"],x+detail["fold_width"],r[2],r[2]+detail["wing_front_inset"]],
                    z,min(zu,detail["wing_top"]),detail["fold_color"],"diagonal-glass-fold",glass=True)
        high=[detail["join_start"]+detail["join_retreat"],r[1],r[2],r[3]]
        piers(high,ph,top,spacing=detail["pier_spacing"],width=detail["pier_width"],sides=(0,2))
        for j in range(detail["roof_slices"]):
            t=j/detail["roof_slices"];u=(j+1)/detail["roof_slices"]
            rr=[high[0]+(high[1]-high[0])*t,high[0]+(high[1]-high[0])*u,r[2],r[3]]
            zh=h-detail["roof_drop"]*t
            box(rr,top,zh,cfg["glass"],"oblique-glazed-roof",glass=True)
            box(rr,zh-detail["roof_edge_depth"],zh,cfg["frame"],"sloping-roof-edge")
        for z in detail["terrace_levels"]:
            rr=[r[0],r[0]+detail["terrace_width"],r[2]+detail["wing_front_inset"]-detail["terrace_depth"],r[2]+detail["wing_front_inset"]]
            box(rr,z,z+detail["terrace_height"],cfg["frame"],"projecting-office-terrace")
            ring(rr,z+detail["terrace_height"],detail["terrace_guard_height"],color=TUNING["rail_glass"],role="office-terrace-guard")
    elif form=="atx":
        office=expand(r,detail["office_margin"])
        shaft(office,ph,detail["office_top"],detail["office_rows"])
        base=detail["office_top"]+detail["transfer_height"]
        shaft(expand(r,-detail["transfer_inset"]),detail["office_top"],base)
        piers(r,detail["office_top"],base,spacing=detail["transfer_pier_spacing"],width=detail["transfer_pier_width"])
        piers(r,0,TUNING["lobby_height"],spacing=detail["street_fin_spacing"],width=detail["street_fin_width"],color=detail["street_fin_color"])
        a,b,c,d=r
        lo=a+(b-a)*detail["trench"][0];hi=a+(b-a)*detail["trench"][1]
        depth=detail["trench_depth"]
        def notched(east):
            return [(a,c),(lo,c),(lo,c+depth),(hi,c+depth),(hi,c),(east,c),(east,d),(a,d)]
        poly(notched(b),base,top,cfg["glass"],"residential-glazing",patterned=True)
        balcony_stack([a,b,c+depth,d],base,top,detail["residential_rows"],side=0,frac=detail["trench"])
        balcony_stack(r,base,top,detail["residential_rows"],side=3,frac=detail["side_balcony"])
        upper=[a,b-detail["wing_inset"],c,d]
        poly(notched(upper[1]),top,h-detail["top_beam_height"],cfg["glass"],"notched-upper-screen",glass=True)
        box(upper,h-detail["top_beam_height"],h,cfg["glass"],"upper-screen-bridge",glass=True)
        ring(upper,h-detail["roof_edge_depth"],detail["roof_edge_depth"],role="flat-upper-roof-edge")
    elif form=="travis":
        shaft(r,ph,top,count)
        piers(r,ph,top,spacing=detail["pier_spacing"],width=detail["pier_width"])
        balcony_stack(r,ph,top-detail["upper_balcony_gap"],count,side=0,frac=detail["balcony_field"])
        balcony_stack(r,ph,top-detail["upper_balcony_gap"],count,side=3,frac=detail["side_balcony"])
        x=r[1]-detail["spine_from_east"]
        for y in (r[2],r[3]):
            box([x,x+detail["spine_width"],y-detail["spine_depth"],y+detail["spine_depth"]],ph,h,cfg["frame"],"full-height-cream-spine")
        upper=[r[0],r[1]-detail["crown_side_width"],r[2],r[3]]
        shaft(upper,top,h,detail["crown_band_rows"])
        shaft([upper[1],r[1],r[2],r[3]],top,h-detail["crown_side_step"],detail["crown_band_rows"])
        ring(upper,h-detail["roof_rim_depth"],detail["roof_rim_depth"],role="flat-upper-crown")
    elif form=="paseo":
        base=ph+detail["amenity_height"]
        shaft(expand(r,-detail["amenity_inset"]),ph,base)
        piers(r,ph,base,spacing=detail["amenity_pier_spacing"],width=detail["amenity_pier_width"])
        shaft(r,base,top-detail["upper_step"],count)
        piers(r,base,top-detail["upper_step"],spacing=detail["pier_spacing"],width=detail["pier_width"])
        balcony_stack(r,base,top-detail["upper_step"],count,side=0,frac=detail["south_balcony"])
        balcony_stack(r,base,top-detail["upper_step"],count,side=1,frac=detail["east_balcony"])
        upper=[r[0]+detail["upper_inset"],r[1],r[2],r[3]]
        shaft(upper,top-detail["upper_step"],top)
        box(expand(upper,detail["roof_blade_projection"]),top-detail["roof_blade_depth"],top,cfg["frame"],"projecting-roof-blade")
        west,east,south,north=detail["mechanical_insets"]
        box([r[0]+west,r[1]-east,r[2]+south,r[3]-north],top,h,cfg["frame"],"offset-mechanical-crown")
    elif form=="415":
        # The deep open balcony trench divides the residential bays; a curved
        # glass screen rises over the narrower half of the occupied roof.
        a,b,c,d=r
        lo=a+(b-a)*detail["trench"][0];hi=a+(b-a)*detail["trench"][1]
        trench=detail["trench_depth"]
        plan=[(a,c),(lo,c),(lo,c+trench),(hi,c+trench),(hi,c),(b,c),(b,d),(a,d)]
        poly(plan,ph,top,cfg["glass"],"notched-residential-glazing",patterned=True)
        bands(r,ph,top,count,shape=lambda rr:plan)
        balcony_stack([a,b,c+trench,d],ph,top,count,side=0,frac=detail["trench"])
        piers(r,ph,top,spacing=detail["pier_spacing"],width=detail["pier_width"])
        screen_end=a+(b-a)*detail["screen_width_fraction"]
        for j in range(detail["screen_slices"]):
            t=j/detail["screen_slices"];u=(j+1)/detail["screen_slices"]
            zh=h-detail["screen_drop"]*(1-math.sqrt(max(0,1-t*t)))
            rr=[a,screen_end,c+(d-c)*t,c+(d-c)*u]
            box(rr,top,zh,cfg["glass"],"curved-upper-screen",glass=True)
            box(rr,zh-detail["rim_depth"],zh,cfg["frame"],"curved-screen-rim",emit=True,night=detail["crown_night"])
        ring([screen_end,b,c,d],top-detail["terrace_depth"],detail["terrace_depth"],role="roof-terrace-light",emit=True,night=detail["crown_night"])
    elif form=="east44":
        shape=lambda q:chamfer(q,detail["corner_cut"])
        shaft(r,ph,top,count,shape=shape)
        balcony_stack(r,ph,top,count,side=0,frac=detail["balcony_field"])
        balcony_stack(r,ph,top,count,side=1,frac=detail["edge_balcony"])
        rr=[r[0]+detail["corner_cut"],r[1]-detail["corner_cut"],r[2],r[3]]
        piers(rr,ph,top,spacing=detail["pier_spacing"],width=detail["pier_width"],sides=(0,2))
        # The parking podium follows the mapped parcel, which is offset from
        # this narrow shaft. Attach its screen fins to those actual walls.
        boundary=list(podium_ring)
        if boundary[0]!=boundary[-1]:
            boundary.append(boundary[0])
        for start,end in zip(boundary,boundary[1:]):
            dx=end[0]-start[0];dy=end[1]-start[1];length=math.hypot(dx,dy)
            if length<=detail["podium_pier_width"]:
                continue
            nx=-dy/length*detail["podium_pier_depth"];ny=dx/length*detail["podium_pier_depth"]
            tx=dx/length*detail["podium_pier_width"]/2;ty=dy/length*detail["podium_pier_width"]/2
            n=max(1,round(length/detail["podium_pier_spacing"]))
            for j in range(n):
                x=start[0]+dx*(j+0.5)/n;y=start[1]+dy*(j+0.5)/n
                poly([(x-tx-nx,y-ty-ny),(x+tx-nx,y+ty-ny),(x+tx+nx,y+ty+ny),(x-tx+nx,y-ty+ny)],
                    TUNING["lobby_height"],ph,cfg["frame"],"podium-screen-fin",metric=True)
        box(expand(r,-detail["crown_inset"]),top,h-detail["crown_core_gap"],cfg["glass"],"crown-core",glass=True)
        for j in range(detail["crown_slices"]):
            t=j/detail["crown_slices"];u=(j+1)/detail["crown_slices"]
            x=rr[0]+(rr[1]-rr[0])*t;xn=rr[0]+(rr[1]-rr[0])*u
            zh=h-detail["crown_drop"]*t
            for y in (r[2],r[3]):
                box([x,xn,y-detail["crown_depth"],y+detail["crown_depth"]],top,zh,cfg["glass"],"angled-crown-screen",glass=True)
                box([x,x+detail["pier_width"],y-detail["crown_depth"],y+detail["crown_depth"]],top,zh,cfg["frame"],"crown-rib")
    else:
        if form=="360":
            shaft([r[0]-detail["annex_west"],r[0]+detail["annex_overlap"],r[2],r[3]+detail["annex_north"]],ph,detail["annex_top"],detail["annex_rows"])
            shaft(r,ph,top,count,shape=lambda q:chamfer(q,detail["corner_cut"]))
            balcony_stack(r,ph,top,count,side=0,frac=detail["south_balcony"])
            balcony_stack(r,ph,top,count,side=2,frac=detail["north_balcony"])
            box(expand(r,-detail["core_inset"]),top,top+detail["core_height"],cfg["glass"],"roof-mechanical",glass=True)
            box([r[1]-detail["mast_offsets"][0],r[1]-detail["mast_offsets"][1],r[2]+detail["mast_offsets"][2],r[2]+detail["mast_offsets"][3]],top,h,cfg["frame"],"corner-spire")
        elif form=="fairmont":
            shaft(r,ph,top-detail["mechanical_height"],count,shape=lambda q:chamfer(q,detail["corner_cut"]))
            # The public total includes a 170-foot spire: its hotel body must
            # not be extruded to the mast tip. Body height is total minus mast.
            rr=[r[0]+detail["roof_side_inset"],r[1]-detail["roof_side_inset"],r[2]+detail["roof_end_inset"],r[3]-detail["roof_end_inset"]]
            shaft(rr,top-detail["mechanical_height"],top)
            box([r[1]-detail["mast_offsets"][0],r[1]-detail["mast_offsets"][1],r[2]+detail["mast_offsets"][2],r[2]+detail["mast_offsets"][3]],top,h,cfg["frame"],"corner-spire")
            ring(rr,top-detail["light_depth"],detail["light_depth"],role="crown-light-line",emit=True,night=cfg["crown_night"])
        elif form=="modern":
            shaft(r,ph,top,count)
            balcony_stack(r,ph+detail["balcony_start"],top,count-detail["balcony_rows_offset"],side=0,frac=detail["south_balcony"])
            balcony_stack(r,ph+detail["balcony_start"],top,count-detail["balcony_rows_offset"],side=1,frac=detail["east_balcony"])
            piers(r,ph,top,spacing=detail["pier_spacing"],width=detail["pier_width"])
            box(expand(r,-detail["core_inset"]),top,h,cfg["glass"],"offset-flat-crown",glass=True)
            # Open crown comb and an exposed pergola edge above the glazing.
            for i in range(detail["comb_count"]):
                x=r[0]+detail["comb_end_margin"]+i*(r[1]-r[0]-2*detail["comb_end_margin"])/(detail["comb_count"]-1)
                box([x,x+detail["comb_width"],r[3]-detail["comb_back"],r[3]+detail["comb_front"]],top,h,cfg["frame"],"roof-comb-pier")
            box([r[0],r[1],r[3]-detail["beam_back"],r[3]-detail["beam_front"]],h-detail["beam_depth"],h,cfg["frame"],"roof-pergola-beam")
        elif form=="natiivo":
            shaft(r,ph,top,count)
            piers(r,ph,top,spacing=detail["pier_spacing"],width=detail["pier_width"])
            balcony_stack(r,ph,top,count,side=0,frac=detail["balcony_field"])
            ring(expand(r,detail["cap_projection"]),h-detail["cap_depth"],detail["cap_depth"],role="cream-roof-frame")
        elif form=="rainey":
            shaft(expand(r,-detail["amenity_inset"]),ph-detail["amenity_halfheight"],ph+detail["amenity_halfheight"])
            piers(r,ph-detail["amenity_halfheight"],ph+detail["amenity_halfheight"],spacing=detail["amenity_pier_spacing"],width=detail["amenity_pier_width"])
            shaft(r,ph+detail["amenity_halfheight"],top,count)
            piers(r,ph+detail["amenity_halfheight"],top,spacing=detail["pier_spacing"],width=detail["pier_width"])
            balcony_stack(r,ph+detail["amenity_halfheight"],top,count,side=0,frac=detail["south_balcony"])
            balcony_stack(r,ph+detail["amenity_halfheight"],top,count,side=1,frac=detail["east_balcony"])
            box([r[0]+detail["roof_side_inset"],r[1],r[2]+detail["roof_end_inset"],r[3]],top,h,cfg["frame"],"stepped-roof")
        elif form=="seaholm":
            shaft(r,ph,top,count)
            balcony_stack(r,ph,top,count,side=0,frac=detail["balcony_field"])
            piers(r,ph,top,spacing=detail["pier_spacing"],width=detail["pier_width"])
            ring(r,h-detail["cap_depth"],detail["cap_depth"],role="flat-cream-crown")
        elif form=="colorado":
            shaft(r,ph,top)
            # Broad multistorey reflective panels, a recessed top floor and
            # projecting roof blade distinguish this office from apartments.
            bands(r,ph,top,detail["panel_rows"],projection=detail["slab_projection"],color=cfg["frame"])
            piers(r,ph,top,spacing=detail["pier_spacing"],width=detail["pier_width"])
            box(expand(r,-detail["core_inset"]),top,h-detail["blade_depth"],cfg["glass"],"roof-glazing",glass=True)
            box(expand(r,detail["blade_projection"]),h-detail["blade_depth"],h,cfg["frame"],"roof-blade")
        elif form=="marriott":
            shaft(r,ph,top)
            # Cream service wing and reddish grid carry different materials.
            box([r[0]-detail["wing_projection"],r[0]+detail["wing_overlap"],r[2]+detail["wing_end_inset"],r[3]],ph,h*detail["wing_height_fraction"],cfg["podium_color"],"cream-service-wing")
            piers(r,ph,h,spacing=detail["pier_spacing"],width=detail["pier_width"],color=cfg["frame"])
            bands(r,ph,top,count,projection=detail["slab_projection"],color=cfg["frame"])
            ring(r,h-detail["cap_depth"],detail["cap_depth"],role="open-roof-frame")
        elif form=="w":
            shaft(r,ph,top,count)
            balcony_stack(r,ph+top*detail["balcony_height_fraction"],top,max(detail["minimum_balcony_rows"],count//detail["balcony_row_divisor"]),side=0,frac=detail["balcony_field"])
            box([r[0]-detail["wing_projection"],r[0]+detail["wing_width"],r[2],r[3]],ph,top,cfg["dark_wing"],"dark-vertical-wing")
            ring(r,h-detail["cap_depth"],detail["cap_depth"],role="flat-crown")
        else:
            raise ValueError(form)
    return out
