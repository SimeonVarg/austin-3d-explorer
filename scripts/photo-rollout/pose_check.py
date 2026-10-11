#!/usr/bin/env python3
"""A small reprojection error cannot excuse a physically impossible photo camera."""
import argparse
import json
import math
from pathlib import Path
from accept import Rejected, asset, write_json


def app_view(recipe, camera, local_angles):
    """Honor a stored recipe frame; recomputing its OBB can rotate the camera 90 degrees."""
    frame=recipe.get('frame')
    if not isinstance(frame,dict) or not isinstance(frame.get('obb'),dict):
        raise Rejected('an explicit recipe frame is required; resolve implicit frames with the existing fitter')
    o=frame['obb'];ax,ay,mx,my=o['ax'],o['ay'],o['mx'],o['my']
    values=[*camera,*o['o'],ax,ay,mx,my,*[local_angles[k] for k in ('yaw','pitch','roll','hfov')]]
    if any(type(v) not in (int,float) or not math.isfinite(v) for v in values) or mx<=0 or my<=0 or abs(ax*ax+ay*ay-1)>1e-6:
        raise Rejected('invalid explicit frame or local pose')
    north=math.degrees(math.atan2(-ay,ax))
    de,dn=camera[0]*ax-camera[1]*ay,camera[0]*ay+camera[1]*ax
    return dict(pose=dict(h=camera[2],yaw=(local_angles['yaw']+north)%360,
                         pitch=local_angles['pitch'],roll=local_angles['roll'],hfov=local_angles['hfov']),
                latlon=dict(lat=o['o'][1]+dn/my,lon=o['o'][0]+de/mx))


def check(value):
    camera=value['camera'];ground=value.get('ground_z')
    if len(camera)!=3 or any(type(v) not in (int,float) or not math.isfinite(v) for v in camera):
        raise Rejected('camera must contain three finite local coordinates')
    result={'status':'CHECK','reasons':[],'height_above_ground':None}
    if ground is None:
        result['reasons'].append('ground elevation at the camera is unknown')
        return result
    if type(ground) not in (int,float) or not math.isfinite(ground):
        raise Rejected('ground_z must be finite or null')
    height=camera[2]-ground;result['height_above_ground']=height
    if height<=0:
        result['status']='REJECT'
        result['reasons'].append('camera is at or below the supplied ground plane')
        return result
    bounds=value.get('height_range')
    if bounds is not None:
        if len(bounds)!=2 or any(type(v) not in (int,float) or not math.isfinite(v) for v in bounds) or not 0<bounds[0]<bounds[1]:
            raise Rejected('height_range must contain increasing positive finite bounds')
        if not bounds[0]<=height<=bounds[1]:
            result['status']='REJECT';result['reasons'].append('camera is outside the supplied capture-height bounds')
            return result
    if value.get('ground_support')!='independent' or not value.get('ground_source'):
        result['reasons'].append('ground is model-derived or lacks independent evidence')
    if bounds is None or value.get('height_support')!='observed':
        result['reasons'].append('capture-height bounds lack direct observation')
    limit=value.get('error_limit_px')
    if limit is None:
        result['reasons'].append('no application-specific error limit was supplied')
    else:
        if type(limit) not in (int,float) or not math.isfinite(limit) or limit<=0:raise Rejected('error limit must be positive and finite')
        for field in ['mean_error_px','heldout_error_px']:
            error=value.get(field)
            if type(error) not in (int,float) or not math.isfinite(error) or error<0:raise Rejected(field+' must be finite and nonnegative')
            if error>limit:
                result['status']='REJECT';result['reasons'].append(field+' exceeds supplied error limit')
    if not result['reasons']:result['status']='SUPPORTED'
    result['limitation']='Physical and residual checks do not prove subject identity, metric scale, hidden geometry or a correct ground surface.'
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--pose',required=True);p.add_argument('--out',required=True)
    p.add_argument('--recipe');p.add_argument('--view-out');a=p.parse_args()
    value=json.loads(Path(a.pose).read_text());result=check(value);result['input']=asset(a.pose)
    if a.view_out:
        if not a.recipe:p.error('--view-out requires --recipe')
        if result['status']!='REJECT':
            view=app_view(json.loads(Path(a.recipe).read_text()),value['camera'],value['local_angles'])
            view['status']=result['status'];write_json(a.view_out,view)
            result.update(recipe=asset(a.recipe),app_view=asset(a.view_out))
    write_json(a.out,result)
    print(json.dumps(result,indent=2));raise SystemExit(1 if result['status']=='REJECT' else 0)
