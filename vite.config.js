import {defineConfig} from 'vite';
import {mkdirSync,copyFileSync} from 'node:fs';
export default defineConfig({build:{outDir:'dist/client'},plugins:[{name:'worker-entry',closeBundle(){mkdirSync('dist/server',{recursive:true});copyFileSync('worker.js','dist/server/index.js')}}]});
