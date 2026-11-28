const fs = require('fs');
const P = 'C:\\Users\\admin\\WorkBuddy\\2026-11-15-18-33-52\\HongHub-Desktop\\scripts\\config-items.json';
const j = JSON.parse(fs.readFileSync(P, 'utf8'));
const T = [37, 58, 59, 60, 63, 65, 66, 69, 70, 71, 72, 75, 77, 78];
let n = 0;
j.items.forEach(it => {
  if (T.includes(it.no)) {
    it.status = '已有';
    it.batch = '1.7.94';
    if (!it.note || !/1\.7\.94/.test(it.note)) {
      it.note = (it.note ? it.note + '；' : '') + '1.7.94 已实现（清单 81/0/0）';
    }
    n++;
  }
});
j.version = '1.7.94';
j.generated = '2026-11-23';
fs.writeFileSync(P, JSON.stringify(j, null, 2) + '\n', 'utf8');
const st = {};
j.items.forEach(i => { st[i.status] = (st[i.status] || 0) + 1; });
console.log('updated', n, 'of', j.items.length, st);
