// Reproduce the comment/whitespace-only app build; no compression or renaming.
// Install: npm install --prefix out/minify --cache out/npm-cache terser@5.51.2 --no-audit --no-fund
import fs from 'node:fs';
import {minify} from '../out/minify/node_modules/terser/main.js';
const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8');
const result=await minify(source,{compress:false,mangle:false,format:{comments:false}});
fs.writeFileSync(new URL('../js/app.js',import.meta.url),result.code+'\n');
