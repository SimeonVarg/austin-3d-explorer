/** Pristine HEAD assets without checkout/git writes or privileged symlinks.
 * Unchanged tracked files use hardlinks, falling back to copies if necessary.
 * Modified tracked runtime files and entry HTML use git-show HEAD contents.
 * Only the dedicated out/r2-main tree is written. Regenerate after source edits.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const runtimeDirs=new Set(['js','data','vendor','wasm','assets','css','fonts','img','images']);
const rootExtensions=new Set(['.html','.css','.svg','.png','.jpg','.jpeg','.ico','.webmanifest','.json']);
const skip=new Set(['node_modules','out','private','.git','__pycache__']);
export function createMainSnapshot(root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..')) {
  root=fs.realpathSync(root);
  const out=path.join(root,'out'),destination=path.join(out,'r2-main');
  const symlink=p=>{try{return fs.lstatSync(p).isSymbolicLink();}catch(e){if(e.code==='ENOENT')return false;throw e;}};
  if(symlink(out)||symlink(destination))throw Error('Refusing symlinked snapshot output root');
  fs.mkdirSync(out,{recursive:true});
  if(fs.realpathSync(out)!==out)throw Error('Snapshot output escapes work copy');
  const git=(...args)=>execFileSync('git',['-C',root,...args],{maxBuffer:128*1024*1024});
  const head=git('rev-parse','HEAD').toString().trim();
  const changed=new Set(git('diff','--name-only','-z','HEAD','--').toString().split('\0'));
  const entries=[];
  for(const line of git('ls-tree','-r','-z','HEAD').toString().split('\0')) {
    if(!line)continue;
    const tab=line.indexOf('\t'),meta=line.slice(0,tab).split(' '),rel=line.slice(tab+1),parts=rel.split('/');
    if(tab<0||path.posix.isAbsolute(rel)||rel.includes(':')||rel.includes('\\')||parts.some(p=>!p||p==='.'||p==='..'))throw Error('Unsafe tracked snapshot path');
    if(parts.some(p=>p.startsWith('.')||skip.has(p)))continue;
    if(parts.length>1&&!runtimeDirs.has(parts[0]))continue;
    if(parts.length===1&&!rootExtensions.has(path.posix.extname(rel)))continue;
    if(meta[1]!=='blob'||meta[0]==='120000')continue;
    entries.push({rel,parts});
  }
  fs.rmSync(destination,{recursive:true,force:true});fs.mkdirSync(destination);
  const report={baselineHEAD:head,materialized:[],hardlinks:[],copies:[],
    method:'HEAD blobs for changed tracked runtime files and HTML entry points; unchanged tracked files hardlinked, with copy fallback',
    limitation:'Hardlinks share source bytes: regenerate before a new measurement suite after any source edit. No untracked files are included.'};
  for(const {rel,parts} of entries) {
    const target=path.join(destination,...parts),source=path.join(root,...parts),parent=path.dirname(target);
    fs.mkdirSync(parent,{recursive:true});
    if(path.relative(destination,fs.realpathSync(parent)).startsWith('..'))throw Error('Snapshot parent escaped output');
    let sourceRegular=false;
    try{sourceRegular=fs.lstatSync(source).isFile();}catch(e){if(e.code!=='ENOENT')throw e;}
    if(changed.has(rel)||rel==='index.html'||rel==='_harness.html'||!sourceRegular) {
      const contents=git('show',head+':'+rel);fs.writeFileSync(target,contents);
      report.materialized.push({path:rel,sha256:crypto.createHash('sha256').update(contents).digest('hex')});
    } else {
      try{fs.linkSync(source,target);report.hardlinks.push(rel);}
      catch(e){fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);report.copies.push({path:rel,linkError:e.code||String(e)});}
    }
  }
  fs.writeFileSync(path.join(destination,'snapshot.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const report=createMainSnapshot();
  console.log(JSON.stringify({baselineHEAD:report.baselineHEAD,materialized:report.materialized.map(x=>x.path),hardlinks:report.hardlinks.length,copies:report.copies.length,urlPath:'/out/r2-main/index.html'},null,2));
}
