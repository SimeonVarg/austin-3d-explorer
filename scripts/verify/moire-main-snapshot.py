#!/usr/bin/env python3
"""Build out/r2-main from HEAD using only read-only git commands.
Unchanged tracked runtime files are symlinks; modified files and entry HTML are
materialized HEAD blobs. No git writes. Rerun before each cost suite if code changed.
"""
import hashlib, json, os, re, shutil, subprocess
from pathlib import Path, PurePosixPath
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'out'
DEST=OUT/'r2-main'
DIRS={'js','data','vendor','wasm','assets','css','fonts','img','images'}
ROOT_EXT={'.html','.css','.svg','.png','.jpg','.jpeg','.ico','.webmanifest','.json'}
SKIP={'node_modules','out','private','.git','__pycache__'}
def git(*args):
    return subprocess.check_output(['git','-C',str(ROOT),*args])
def safe(rel):
    p=PurePosixPath(rel)
    if p.is_absolute() or ':' in rel or '\\' in rel or any(x in ('','..','.') for x in p.parts):
        raise RuntimeError('Unsafe tracked path: '+rel)
    return p

def main():
    if OUT.is_symlink() or DEST.is_symlink():
        raise RuntimeError('Refuse symlinked output root')
    OUT.mkdir(exist_ok=True)
    if OUT.resolve()!=ROOT/'out':raise RuntimeError('Output escaped work copy')
    head=git('rev-parse','HEAD').decode().strip()
    changed=set(git('diff','--name-only','-z','HEAD','--').decode().split('\0'))
    tree=git('ls-tree','-r','-z','HEAD').split(b'\0')
    entries=[]
    for line in tree:
        if not line:continue
        metadata,name=line.split(b'\t',1);rel=name.decode();p=safe(rel)
        if any(x.startswith('.') or x in SKIP for x in p.parts):continue
        if len(p.parts)>1 and p.parts[0] not in DIRS:continue
        if len(p.parts)==1 and p.suffix not in ROOT_EXT:continue
        mode,kind,oid=metadata.decode().split()
        if kind!='blob' or mode=='120000':continue
        entries.append((rel,p))
    # Rebuild only this dedicated generated tree; never follow an output symlink.
    if DEST.exists():shutil.rmtree(DEST)
    DEST.mkdir()
    report={'baselineHEAD':head,'materialized':[],'linked':[],'rootReferences':[],
      'method':'HEAD blobs for changed tracked runtime files and HTML entry points; unchanged tracked files symlinked to work copy',
      'limitation':'Symlinks remain live: regenerate this snapshot after any subsequent tracked runtime edit. External CDN responses are shared with candidate.'}
    for rel,p in entries:
        target=DEST.joinpath(*p.parts)
        target.parent.mkdir(parents=True,exist_ok=True)
        if not target.parent.resolve().is_relative_to(DEST.resolve()):raise RuntimeError('Output parent escaped snapshot')
        source=ROOT.joinpath(*p.parts)
        materialize=rel in changed or rel in ('index.html','_harness.html') or not source.is_file() or source.is_symlink()
        if materialize:
            content=git('show',head+':'+rel);target.write_bytes(content)
            report['materialized'].append({'path':rel,'sha256':hashlib.sha256(content).hexdigest()})
        else:
            target.symlink_to(os.path.relpath(source,target.parent));report['linked'].append(rel)
            content=source.read_bytes() if p.suffix in ('.js','.html','.css') else None
        if content is not None and p.suffix in ('.js','.html','.css'):
            for n,line in enumerate(content.decode('utf-8',errors='replace').splitlines(),1):
                # A leading slash or location.origin may bypass the nested base;
                # report rather than rewriting main behavior.
                if re.search(r"[\"']/(?!/)|location\.origin|<base\b",line):
                    report['rootReferences'].append({'path':rel,'line':n,'text':line.strip()[:200]})
    (DEST/'snapshot.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'directory':str(DEST),'baselineHEAD':head,'materialized':[x['path'] for x in report['materialized']],
      'symlinkCount':len(report['linked']),'rootReferenceCount':len(report['rootReferences']),
      'urlPath':'/out/r2-main/index.html'},indent=2))
if __name__=='__main__':main()
