import {createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
export const hash = b => createHash('sha256').update(b).digest('hex');
const extensions=new Set(['.md','.html','.css','.js','.mjs','.ts','.tsx','.json','.svg','.png','.jpg','.jpeg','.webp','.txt','.yaml','.yml']);
export function safeName(name){
 if(typeof name!=='string'||name.length>800||name!==name.normalize('NFC')||/[\\\x00-\x1f\x7f]/.test(name)||name.startsWith('/')||name.split('/').some(p=>!p||p==='.'||p==='..'||p.startsWith('.'))||!extensions.has(path.posix.extname(name).toLowerCase())||/(^|\/)(node_modules|audit|audits|logs|sessions|credentials|secrets|recovery|backups)(\/|$)/i.test(name)||/(secret|credential|id_rsa|id_ed25519|\.env|\.pem$|\.key$)/i.test(name)) throw new Error('共有/閲覧対象外のパスです');
 return name;
}
export function validateManifest(input){
 if(!Array.isArray(input)||input.length>2000) throw new Error('ファイル数の上限を超えています');
 let total=0;const seen=new Set();
 const files=input.map(f=>{
  const name=safeName(f.path);const folded=name.toLowerCase();if(seen.has(folded))throw new Error('重複パスです');seen.add(folded);
  if(typeof f.data!=='string'||f.data.length>2800000||! /^[A-Za-z0-9+/]*={0,2}$/.test(f.data))throw new Error('ファイル形式が不正です');
  const bytes=Buffer.from(f.data,'base64');total+=bytes.length;
  if(bytes.toString('base64')!==f.data||bytes.length>2*1024*1024||total>20*1024*1024||hash(bytes)!==f.sha256)throw new Error('バイト列/hash/容量が不正です');
  if(!['.png','.jpg','.jpeg','.webp'].includes(path.extname(name).toLowerCase())&&/(-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|sk-ant-[A-Za-z0-9_-]{20,})/.test(bytes.toString('utf8')))throw new Error('秘密情報と思われる内容を共有できません');
  return {path:name,sha256:f.sha256,data:f.data};
 }).sort((a,b)=>a.path.localeCompare(b.path,'en'));
 return {files,hash:hash(JSON.stringify(files.map(f=>({path:f.path,sha256:f.sha256}))))};
}
export async function readSafe(root,name){
 safeName(name);const base=await fs.realpath(root);let cursor=base;
 for(const part of name.split('/')){cursor=path.join(cursor,part);const stat=await fs.lstat(cursor);if(stat.isSymbolicLink())throw new Error('symlinkは対象外です');}
 const handle=await fs.open(cursor,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const before=await handle.stat();if(!before.isFile()||before.size>2*1024*1024)throw new Error('通常ファイル/容量を確認してください');const bytes=await handle.readFile();const after=await handle.stat();if(before.ino!==after.ino||before.mtimeMs!==after.mtimeMs||before.size!==after.size)throw new Error('書込中です');return bytes;}finally{await handle.close();}
}
export async function snapshot(root){
 const result=[];let count=0;
 async function walk(dir,relative=''){
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
   if(entry.name.startsWith('.')||['node_modules','audit','audits','logs','sessions','credentials','secrets','recovery','backups'].includes(entry.name.toLowerCase()))continue;
   const name=relative?`${relative}/${entry.name}`:entry.name;
   if(entry.isSymbolicLink())throw new Error('symlinkを含む案件は共有できません');
   if(entry.isDirectory())await walk(path.join(dir,entry.name),name);
   else if(entry.isFile()){
    try{safeName(name);}catch{continue;}
    if(++count>2000)throw new Error('ファイル数上限です');const bytes=await readSafe(root,name);result.push({path:name,sha256:hash(bytes),data:bytes.toString('base64')});
   }
  }
 }
 await walk(root);return validateManifest(result);
}
export async function materialize(root,manifest){
 const checked=validateManifest(manifest.files??manifest);await fs.mkdir(root,{recursive:true,mode:0o700});
 if((await fs.readdir(root)).length)throw new Error('新しい専用フォルダだけへ配置できます');
 for(const f of checked.files){const dest=path.join(root,f.path);await fs.mkdir(path.dirname(dest),{recursive:true,mode:0o700});await fs.writeFile(dest,Buffer.from(f.data,'base64'),{flag:'wx',mode:0o600});}
 return checked;
}
export async function stableSnapshot(root){
 let previous=await snapshot(root);
 for(let i=0;i<3;i++){await new Promise(r=>setTimeout(r,120));const next=await snapshot(root);if(previous.hash===next.hash)return next;previous=next;}
 throw new Error('書込中です。安定してから再読取します');
}
