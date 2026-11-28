const fs=require('fs'),path=require('path');
const APP='C:\\Users\\admin\\WorkBuddy\\2026-11-15-18-33-52\\HongHub-Desktop\\app';
const files=fs.readdirSync(APP).filter(f=>f.endsWith('.js'));
const defs=[];
for(const f of files){
  const txt=fs.readFileSync(path.join(APP,f),'utf8');
  const re=/data-act="([^"]+)"/g; let m;
  while((m=re.exec(txt))) defs.push({f,v:m[1],i:m.index});
}
const handlers=fs.readFileSync(path.join(APP,'kh-admin.js'),'utf8')+'\n'+fs.readFileSync(path.join(APP,'kh-app.js'),'utf8');
const uniq=[...new Set(defs.map(d=>d.v))].sort();
const missing=uniq.filter(v=>!new RegExp("'"+v.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+"'").test(handlers));
console.log('data-act 总数(去重) '+uniq.length);
console.log(missing.length?('无 handler: '+missing.join(', ')):'全部 data-act 都有 handler');
