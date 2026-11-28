const fs=require('fs'),vm=require('vm');
const src=fs.readFileSync(process.argv[2],'utf8');
const ctx={window:{},module:{exports:{}},exports:{},console};
ctx.globalThis=ctx.window;
vm.createContext(ctx);
try{vm.runInContext(src,ctx,{timeout:5000});}catch(e){console.log('ERR',e.message);}
const M=ctx.MOVIES||ctx.window.MOVIES||(ctx.module.exports&&ctx.module.exports.MOVIES);
if(!M){console.log('no MOVIES, keys:',Object.keys(ctx).slice(0,20));process.exit(0);}
console.log('count',M.length);
const cats={},tags={},yr={};
M.forEach(m=>{cats[m.category]=(cats[m.category]||0)+1;(m.tags||[]).forEach(t=>tags[t]=(tags[t]||0)+1);const y=String(m.year||'?');yr[y]=(yr[y]||0)+1;});
console.log('cats',JSON.stringify(cats));
console.log('tags',JSON.stringify(tags));
console.log('years',JSON.stringify(yr));
console.log('sample',JSON.stringify(M[0]).slice(0,300));
