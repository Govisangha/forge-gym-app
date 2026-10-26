import {spawnSync} from 'node:child_process';
import {cp,mkdir,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,relative,basename} from 'node:path';
import {gzipSync} from 'node:zlib';
import {build} from 'esbuild';
const root=fileURLToPath(new URL('..',import.meta.url));
const compiled=spawnSync(process.execPath,['scripts/run-framework.mjs','build'],{cwd:root,stdio:'inherit'});
if(compiled.error)throw compiled.error;
if(compiled.status!==0)process.exit(compiled.status??1);
const output=resolve(root,'cloudflare-dist');
// The only recursively removed path is this fixed generated directory.
if(relative(root,output)!=='cloudflare-dist')throw new Error('Invalid build output');
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
const client=resolve(root,'dist/client');
await cp(client,output,{recursive:true,filter:path=>!['.vite','.assetsignore','vinext-client-entry-manifest.json'].includes(basename(path))});
async function list(path){const files=[];for(const entry of await readdir(path,{withFileTypes:true})){const full=resolve(path,entry.name);files.push(...entry.isDirectory()?await list(full):[full]);}return files;}
const staticPaths=(await list(output)).map(path=>'/'+relative(output,path).replaceAll('\\','/'));
const bundled=await build({stdin:{contents:`import app from './dist/server/index.js';\nimport {createPersonalForgeWorker} from './cloudflare/personal-worker.mjs';\nexport default createPersonalForgeWorker(app,${JSON.stringify(staticPaths)});`,resolveDir:root,sourcefile:'forge-cloudflare-entry.mjs'},outfile:resolve(output,'_worker.js'),bundle:true,splitting:false,format:'esm',platform:'neutral',target:'es2022',minify:true,external:['node:*','cloudflare:*'],conditions:['workerd','worker','browser'],mainFields:['module','main'],legalComments:'inline',metafile:true});
const unresolved=Object.values(bundled.metafile.outputs).flatMap(output=>output.imports).filter(item=>item.external&&!/^(node:|cloudflare:)/.test(item.path));
if(unresolved.length)throw new Error('Unresolved runtime imports: '+JSON.stringify(unresolved));
await writeFile(resolve(output,'_routes.json'),JSON.stringify({version:1,include:['/*'],exclude:['/_next/*','/favicon.svg','/manifest.webmanifest','/sw.js']},null,2)+'\n');
await writeFile(resolve(output,'_headers'),'/sw.js\n  Cache-Control: no-cache\n  Service-Worker-Allowed: /\n\n/_next/static/*\n  Cache-Control: public, max-age=31536000, immutable\n');
const worker=await readFile(resolve(output,'_worker.js'));
if(gzipSync(worker).length>3*1024*1024)throw new Error('Worker exceeds free-plan compressed size limit');
for(const path of await list(output))if((await readFile(path)).length>25*1024*1024)throw new Error('Asset too large: '+path);
console.log(`Cloudflare Pages output: cloudflare-dist (${(await list(output)).length} files)`);
