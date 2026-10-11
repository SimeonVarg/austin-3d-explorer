#!/usr/bin/env python3
"""Compare a fitted camera with actual app point projections and the photo warp."""
import argparse
import json
import math
from pathlib import Path
import numpy as np
from accept import Rejected, asset, write_json
from pose_check import angles_from_rotation


def check(pose, plan, snapshot, limit):
    if type(limit) not in (int,float) or not math.isfinite(limit) or limit<=0:
        raise Rejected('projection limit must be positive and finite')
    values=[plan[k] for k in ('outW','outH','cx','cy','fs','fp','enginePitch')] + [plan['pose'][k] for k in ('hfov','pitch','roll')]
    if any(type(v) not in (int,float) or not math.isfinite(v) for v in values) or min(plan[k] for k in ('outW','outH','fs','fp'))<=0:
        raise Rejected('invalid projection plan')
    angles_from_rotation(pose['R'],plan['pose']['hfov'])
    points=snapshot['points'];xyz=np.asarray([v['xyz'] for v in points],dtype=float)
    if xyz.ndim!=2 or xyz.shape[1]!=3 or len(xyz)<4 or not np.isfinite(xyz).all() or np.linalg.matrix_rank(xyz-xyz.mean(0))<3:
        raise Rejected('check needs at least four finite points spanning three dimensions')
    camera=np.asarray(pose['camera'],dtype=float);K=np.asarray(pose['K'],dtype=float)
    size=np.asarray(pose['image_size'],dtype=float)
    if camera.shape!=(3,) or K.shape!=(3,3) or size.shape!=(2,) or not np.isfinite(np.r_[camera,K.ravel(),size]).all() or min(size)<=0:
        raise Rejected('invalid camera, intrinsic matrix or source image size')
    coords=(np.asarray(pose['R'])@(xyz-camera).T).T
    pixels=(K@coords.T).T
    if np.any(pixels[:,2]<=0):raise Rejected('test point is behind the fitted camera')
    expected=pixels[:,:2]/pixels[:,2:] * np.array([plan['outW'],plan['outH']])/size
    engine=np.asarray([[v['engine']['x'],v['engine']['y']] for v in points],dtype=float)
    if not np.isfinite(engine).all():raise Rejected('app projection must be finite')
    tx=(engine[:,0]-plan['cx'])/plan['fs'];ty=(plan['cy']-engine[:,1])/plan['fs']
    e=math.radians(plan['enginePitch']-90)
    rays=np.column_stack([tx,ty*math.cos(e)+math.sin(e),-ty*math.sin(e)+math.cos(e)])
    pitch,roll=map(math.radians,[plan['pose']['pitch'],plan['pose']['roll']])
    up0=np.array([0,math.cos(pitch),-math.sin(pitch)])
    right=np.array([math.cos(roll),0,0])-math.sin(roll)*up0
    up=np.array([math.sin(roll),0,0])+math.cos(roll)*up0
    forward=np.array([0,math.sin(pitch),math.cos(pitch)])
    depth=rays@forward
    if np.any(depth<=0):raise Rejected('app ray is behind the output photo')
    actual=np.column_stack([plan['outW']/2+plan['fp']*(rays@right)/depth,
                            plan['outH']/2-plan['fp']*(rays@up)/depth])
    errors=np.linalg.norm(actual-expected,axis=1)
    return dict(status='CONSISTENT' if max(errors)<=limit else 'REJECT',limit_px=limit,
                max_error_px=float(max(errors)),mean_error_px=float(errors.mean()),
                points=[dict(name=v['name'],expected=expected[i].tolist(),actual=actual[i].tolist(),error_px=float(errors[i])) for i,v in enumerate(points)],
                limitation='Only camera convention/placement/warp agreement. This does not prove source camera, scene geometry, physical scale or photo likeness.')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for key in ('pose','plan','projection','out'):parser.add_argument('--'+key,required=True)
    parser.add_argument('--limit-px',required=True,type=float);a=parser.parse_args()
    records={k:asset(getattr(a,k)) for k in ('pose','plan','projection')}
    result=check(*(json.loads(Path(getattr(a,k)).read_text()) for k in ('pose','plan','projection')),a.limit_px)
    result['inputs']=records;write_json(a.out,result)
    print(json.dumps({k:result[k] for k in ('status','max_error_px','mean_error_px')}))
    raise SystemExit(1 if result['status']=='REJECT' else 0)
