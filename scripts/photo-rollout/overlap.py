#!/usr/bin/env python3
"""Discover candidate planar overlap in an explicit small photo set; never approve a camera.

Plan: {"views": [{"id": "front", "file": "/private/photo.jpg"}, ...]}
Files may also be relative to the plan. No review labels or GPS are required.
CLI: python overlap.py --plan /private/plan.json --out /private/new-output-directory
Outputs contain private paths, hashes and correspondences; never write them into Git.
"""
import os
os.environ.update(OMP_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1', VECLIB_MAXIMUM_THREADS='1')
import argparse, io, itertools, json, re, sys, time
from pathlib import Path
import cv2
import numpy as np
from PIL import Image
from accept import Rejected, private_path, sha, write_json

MAX_IMAGES = 12  # At most 66 pair fits; use existing building groups for larger collections.
MAX_FILE_BYTES = 100 * 1024 * 1024
MAX_PIXELS = 50_000_000
LONG_EDGE = 1600
RATIO = .70
STRICT_RATIO = .60
ERROR_PX = 3.0
MIN_SUPPORT = 20
MIN_HULL = .01
MIN_EIGEN_RATIO = .02
MIN_LOCAL_GRID = 6
BROAD_HULL = .03
DRAW_LIMIT = 12
cv2.setNumThreads(0)  # Sequential mode; macOS GCD ignores a positive thread limit.
cv2.ocl.setUseOpenCL(False)
cv2.setRNGSeed(31)

LIMITS = [
    "Manual confirmation of distinctive physical landmarks is required for every candidate.",
    "Repeated features can support a coherent wrong plane; counts are not confidence probabilities.",
    "Planar overlap does not prove furniture identity, depth, metric scale, camera baseline or calibration.",
    "Half-fit errors withhold already-selected inliers, not independent photos or cameras.",
    "No lens calibration; low texture, occlusion and large viewpoint changes can hide real overlap.",
    "Lossy re-encodes, crops and near-duplicate views can evade duplicate hashes; independence is not inferred.",
    "Missing GPS or building assignment stays unknown; no grouping or semantic identity is inferred.",
]


def spread(p, shape):
    h, w = shape[:2]
    q = p / [w, h]
    eig = np.linalg.eigvalsh(np.cov(q.T)) if len(q) > 2 else [0, 1]
    local = (q-q.min(0))/np.maximum(np.ptp(q,axis=0),1e-12) if len(q) else q
    return dict(bbox_normalized=[q.min(0).tolist(),q.max(0).tolist()] if len(q) else None,
                hull_normalized=cv2.convexHull(q.astype(np.float32))[:,0,:].tolist() if len(q)>2 else [],
                local_occupied_4x4=int(len(set(map(tuple,np.clip((local*4).astype(int),0,3))))),
                hull_fraction=float(cv2.contourArea(cv2.convexHull(q.astype(np.float32)))) if len(q)>2 else 0,
                eigen_ratio=float(eig[0] / max(eig[1], 1e-12)),
                occupied_4x4=int(len(set(map(tuple, np.clip((q*4).astype(int), 0, 3))))))


def errors(H, p, q):
    if H is None: return np.full(len(p), np.inf)
    try:
        f = cv2.perspectiveTransform(p[:,None,:], H)[:,0,:]
        b = cv2.perspectiveTransform(q[:,None,:], np.linalg.inv(H))[:,0,:]
        return np.maximum(np.linalg.norm(f-q, axis=1), np.linalg.norm(b-p, axis=1))
    except (cv2.error, np.linalg.LinAlgError): return np.full(len(p), np.inf)


def analyze(a, b):
    knn = cv2.BFMatcher(cv2.NORM_L2)
    def good(x, y):
        return {m.queryIdx: (m.trainIdx, m.distance/max(n.distance,1e-12))
                for m,n in knn.knnMatch(x,y,k=2) if m.distance < RATIO*n.distance}
    if any(v['des'] is None or len(v['des'])<2 for v in [a,b]):
        ab,ba={},{}
    else:
        ab, ba = good(a['des'],b['des']), good(b['des'],a['des'])
    matches = sorted([(i,j,max(r,ba[j][1])) for i,(j,r) in ab.items() if j in ba and ba[j][0] == i], key=lambda t:t[2])
    # SIFT can give multiple orientations at one location: count physical support once.
    retained = []
    for i,j,r in matches:
        p,q = np.array(a['kp'][i].pt), np.array(b['kp'][j].pt)
        if any(np.linalg.norm(p-x[3])<3 or np.linalg.norm(q-x[4])<3 for x in retained): continue
        retained.append((i,j,r,p,q))
    p = np.array([m[3] for m in retained],np.float32).reshape(-1,2)
    q = np.array([m[4] for m in retained],np.float32).reshape(-1,2)
    rec = dict(pair=[a['name'],b['name']], mutual_ratio_matches=len(matches), unique_matches=len(p))
    H = None
    if len(p) >= 8:
        H,_ = cv2.findHomography(p,q,cv2.USAC_MAGSAC,ERROR_PX,maxIters=10000,confidence=.999)
    if H is not None and not np.isfinite(H).all(): H=None
    err=errors(H,p,q); keep=err<ERROR_PX
    pi,qi=p[keep],q[keep]
    sp=[spread(pi,a['im'].shape),spread(qi,b['im'].shape)]
    reasons=[]
    if keep.sum()<MIN_SUPPORT: reasons.append('few_inliers')
    if min(s['hull_fraction'] for s in sp)<MIN_HULL: reasons.append('small_patch')
    if min(s['eigen_ratio'] for s in sp)<MIN_EIGEN_RATIO: reasons.append('near_collinear')
    if min(s['local_occupied_4x4'] for s in sp)<MIN_LOCAL_GRID: reasons.append('clustered_support')
    # Predict withheld *correspondences*, not a held-out camera or physical scale.
    heldout=[]
    if len(pi)>=12:
        rng=np.random.default_rng(31)
        for _ in range(3):
            idx=rng.permutation(len(pi)); train, test=idx[:len(idx)//2],idx[len(idx)//2:]
            ht,_=cv2.findHomography(pi[train],qi[train],cv2.USAC_MAGSAC,ERROR_PX,maxIters=5000)
            median=float(np.median(errors(ht,pi[test],qi[test])))
            heldout.append(median if np.isfinite(median) else None)
    if not heldout or any(e is None or e>ERROR_PX for e in heldout): reasons.append('unstable_half_fit')
    strict=int(sum(retained[i][2]<STRICT_RATIO for i in np.flatnonzero(keep)))
    if strict<10: reasons.append('weak_descriptor_margin')
    rec.update(homography_inliers=int(keep.sum()), strict_descriptor_inliers=strict,
        inlier_fraction=float(keep.mean()) if len(keep) else 0,
        median_symmetric_error_px=float(np.median(err[keep])) if keep.any() else None,
        spread=sp, half_fit_median_errors_px=heldout, candidate=not reasons,
        extent='broad_image_patch' if min(s['hull_fraction'] for s in sp)>=BROAD_HULL else 'limited_patch',
        status='REVIEW_CANDIDATE' if not reasons else 'INSUFFICIENT_SUPPORT',
        manual_landmark_confirmation_required=True,
        caution_flags=reasons, homography=H.tolist() if H is not None else None,
        inlier_points_resized=[pi.tolist(),qi.tolist()],
        inference='planar overlap candidate only; manual inspection required; no object identity or metric camera claim')
    return rec


def sheet(records, photos, out):
    selected=sorted(records,key=lambda r:r['homography_inliers'],reverse=True)[:3]
    rows=[]
    for rec in selected:
        a,b=[photos[x] for x in rec['pair']]
        thumb=[]
        for item in [a,b]:
            im=item['im']; scale=500/max(im.shape[:2]); small=cv2.resize(im,None,fx=scale,fy=scale)
            canvas=np.full((500,500,3),245,np.uint8); canvas[:small.shape[0],:small.shape[1]]=small
            thumb.append((canvas,scale))
        panel=np.concatenate([thumb[0][0],thumb[1][0]],axis=1)
        p,q=[np.array(x).reshape(-1,2) for x in rec['inlier_points_resized']]
        # Greedy farthest-point sampling reveals spatial support rather than displaying a dense blob.
        chosen=[]
        if len(p):
            chosen=[0]
            while len(chosen)<min(DRAW_LIMIT,len(p)):
                distances=np.min(np.linalg.norm(p[:,None,:]-p[chosen][None,:,:],axis=2),axis=1)
                distances[chosen]=-1; chosen.append(int(np.argmax(distances)))
        for n,idx in enumerate(chosen):
            x=np.round(p[idx]*thumb[0][1]).astype(int); y=np.round(q[idx]*thumb[1][1]).astype(int)+[500,0]
            color=tuple(int(v) for v in np.random.default_rng(n+10).integers(40,220,3))
            cv2.line(panel,tuple(x),tuple(y),color,1,cv2.LINE_AA)
            for point in [x,y]:
                cv2.circle(panel,tuple(point),4,color,1,cv2.LINE_AA)
                cv2.putText(panel,str(n+1),tuple(point+[4,-3]),cv2.FONT_HERSHEY_SIMPLEX,.35,color,1,cv2.LINE_AA)
        header=np.full((48,1000,3),255,np.uint8)
        title=f"{' / '.join(rec['pair'])}: {rec['homography_inliers']} inliers / {rec['unique_matches']} matches; candidate={rec['candidate']}"
        cv2.putText(header,title,(10,20),cv2.FONT_HERSHEY_SIMPLEX,.52,(15,15,15),1,cv2.LINE_AA)
        flags=', '.join(rec['caution_flags']) or rec['extent']+'; PLANAR only; MANUAL LANDMARK CHECK REQUIRED'
        cv2.putText(header,flags,(10,40),cv2.FONT_HERSHEY_SIMPLEX,.45,(35,35,100),1,cv2.LINE_AA)
        rows.append(np.concatenate([header,panel]))
    path=private_path(out/'match-sheet.jpg')
    if not cv2.imwrite(str(path),np.concatenate(rows),[cv2.IMWRITE_JPEG_QUALITY,93]):
        raise Rejected('could not write match sheet')

def load_plan(path):
    path=Path(path).expanduser().resolve()
    data=path.read_bytes()
    if len(data)>1024*1024: raise Rejected('plan exceeds 1 MiB')
    try: plan=json.loads(data)
    except (UnicodeError,json.JSONDecodeError) as error: raise Rejected('invalid plan JSON') from error
    views=plan.get('views') if isinstance(plan,dict) else None
    if not isinstance(views,list) or not 2<=len(views)<=MAX_IMAGES:
        raise Rejected(f'plan must list 2 to {MAX_IMAGES} views; group large collections before matching')
    ids,files,rows=set(),set(),[]
    for item in views:
        if not isinstance(item,dict): raise Rejected('each view must be an object')
        name,file=item.get('id'),item.get('file')
        if not isinstance(name,str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,63}',name):
            raise Rejected('view id must be 1 to 64 simple letters, digits, dots, underscores or dashes')
        if not isinstance(file,str) or not file.strip(): raise Rejected('each view needs an image file')
        file=Path(file).expanduser()
        if not file.is_absolute(): file=path.parent/file
        file=file.resolve()
        if name in ids or file in files: raise Rejected('duplicate view id or resolved image path')
        if not file.is_file() or not 0<file.stat().st_size<=MAX_FILE_BYTES:
            raise Rejected('image file is missing, empty, or larger than 100 MiB')
        ids.add(name);files.add(file);rows.append(dict(id=name,file=file))
    return dict(file=str(path),sha256=sha(data)),rows


def load_view(row):
    """Decode once, apply the recorded EXIF orientation explicitly, then resize without cropping."""
    data=row['file'].read_bytes()
    if not 0<len(data)<=MAX_FILE_BYTES: raise Rejected('image file size changed or exceeds 100 MiB')
    try:
        with Image.open(io.BytesIO(data)) as image:
            stored=list(image.size); orientation=image.getexif().get(274,1)
            if image.width*image.height>MAX_PIXELS: raise Rejected('image exceeds 50 megapixels')
            if getattr(image,'n_frames',1)!=1: raise Rejected('animated or multiframe input is unsupported')
            if 'A' in image.getbands() or 'transparency' in image.info:
                raise Rejected('transparent image formats are unsupported')
    except (OSError,Image.DecompressionBombError) as error:
        raise Rejected('cannot read image header') from error
    if type(orientation) is not int or orientation not in range(1,9):
        raise Rejected('invalid EXIF orientation')
    image=cv2.imdecode(np.frombuffer(data,np.uint8),cv2.IMREAD_COLOR|cv2.IMREAD_IGNORE_ORIENTATION)
    if image is None or list(image.shape[1::-1])!=stored:
        raise Rejected('image decoder failed or dimensions differ from header')
    if orientation==2: image=np.fliplr(image)
    elif orientation==3: image=np.flip(image,axis=(0,1))
    elif orientation==4: image=np.flipud(image)
    elif orientation==5: image=image.transpose(1,0,2)
    elif orientation==6: image=np.rot90(image,3)
    elif orientation==7: image=np.flip(image.transpose(1,0,2),axis=(0,1))
    elif orientation==8: image=np.rot90(image)
    image=np.ascontiguousarray(image)
    size=list(image.shape[:2]); scale=min(1,LONG_EDGE/max(size))
    if min(round(d*scale) for d in size)<1: raise Rejected('image is too narrow to normalize')
    pixels_sha=sha(str(size).encode()+image.tobytes())
    small=cv2.resize(image,None,fx=scale,fy=scale,interpolation=cv2.INTER_LINEAR)
    kp,des=cv2.SIFT_create(nfeatures=6500).detectAndCompute(cv2.cvtColor(small,cv2.COLOR_BGR2GRAY),None)
    record=dict(id=row['id'],file=str(row['file']),sha256=sha(data),oriented_bgr_sha256=pixels_sha,
                stored_wh=stored,exif_orientation_applied=orientation,oriented_hw=size,
                resized_hw=list(small.shape[:2]),resize_scale_xy=[small.shape[1]/size[1],small.shape[0]/size[0]],
                requested_resize_scale=scale,keypoints=len(kp),location='unknown',building_assignment='unknown',
                normalization='OpenCV 8-bit BGR; explicit EXIF transform; whole frame; INTER_LINEAR resize; no lens or color calibration')
    return dict(name=row['id'],im=small,kp=kp,des=des,record=record)


def discover(plan_path,output):
    output=private_path(output)
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise Rejected('output directory must be empty; preserve previous trials')
    plan,rows=load_plan(plan_path)
    cv2.setNumThreads(0)
    cv2.ocl.setUseOpenCL(False)
    started=time.perf_counter(); photos={}; hashes,pixels=set(),set()
    cv2.setRNGSeed(31)
    for row in rows:
        photo=load_view(row); rec=photo['record']
        if rec['sha256'] in hashes or rec['oriented_bgr_sha256'] in pixels:
            raise Rejected('duplicate source bytes or normalized pixels; duplicates are not independent views')
        hashes.add(rec['sha256']);pixels.add(rec['oriented_bgr_sha256']);photos[row['id']]=photo
    extracted=time.perf_counter()
    pairs=[analyze(a,b) for a,b in itertools.combinations(photos.values(),2)]
    matched=time.perf_counter()
    output.mkdir(parents=True,exist_ok=True)
    sheet(pairs,photos,output)
    result=dict(schema=1,kind='private-photo-overlap-candidates',plan=plan,
                images=[p['record'] for p in photos.values()],pairs=pairs,limits=LIMITS,
                runtime=dict(opencv=cv2.__version__,numpy=np.__version__,threads=cv2.getNumThreads(),opencl=cv2.ocl.useOpenCL()),
                settings=dict(long_edge=LONG_EDGE,sift_features=6500,ratio=RATIO,strict_ratio=STRICT_RATIO,
                              symmetric_error_px=ERROR_PX,min_support=MIN_SUPPORT,min_hull=MIN_HULL,
                              min_eigen_ratio=MIN_EIGEN_RATIO,min_local_grid=MIN_LOCAL_GRID,broad_hull=BROAD_HULL),
                timing=dict(feature_seconds=extracted-started,matching_seconds=matched-extracted,total_seconds=time.perf_counter()-started))
    write_json(output/'results.json',result)
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan',required=True,type=Path)
    parser.add_argument('--out',required=True,type=Path)
    args=parser.parse_args()
    result=discover(args.plan,args.out)
    # Private coordinates and paths belong in the receipt, not a public console log.
    print(json.dumps(dict(pairs=len(result['pairs']),review_candidates=sum(p['candidate'] for p in result['pairs']),
                          seconds=round(result['timing']['total_seconds'],2),manual_landmark_confirmation_required=True)))


if __name__=='__main__':
    try: main()
    except (Rejected,OSError,ValueError,cv2.error) as error:
        print('Overlap discovery failed: '+str(error),file=sys.stderr)
        raise SystemExit(1)
