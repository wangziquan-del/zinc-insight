import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url),read=n=>fs.readFileSync(new URL(n,root),'utf8');
const html=read('index.html'),dataText=read('data.json'),fail=[];
const ok=(v,m)=>{if(!v)fail.push(m)};
ok(html.includes('<meta charset="utf-8">'),'missing UTF-8');
ok(html.includes('class="nav" id="nav"'),'missing nav class');
for(const id of ['overview','price','mine','smelting','demand','inventory','balance','companies','intelligence'])ok(html.includes(`id="${id}"`),`missing ${id}`);
const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(x=>x[1]);ok(ids.filter((x,i)=>ids.indexOf(x)!==i).length===0,'duplicate ids');
ok(!/\b(?:NaN|Infinity|-Infinity)\b/.test(dataText),'non-finite data');
let data;try{data=JSON.parse(dataText)}catch(e){fail.push(`invalid data.json: ${e.message}`)}
if(data){ok(data.meta?.apiConnected===true,'Zhiji disconnected');ok(data.meta?.sourceFiles?.length===4,'source files != 4');ok(Object.keys(data.charts||{}).length>=15,'charts < 15');ok((data.kline?.candles||[]).length>=60,'K line < 60');ok((data.companies?.mine?.rows||[]).length>=20,'mine companies < 20');ok((data.companies?.smelter?.rows||[]).length>=10,'smelters < 10');ok(data.quote?.last>0,'quote missing')}
try{new vm.Script(read('app.js'));new vm.Script(read('data.js'));new vm.Script(read('vendor/chart.umd.min.js'))}catch(e){fail.push(`JavaScript: ${e.message}`)}
for(const asset of ['styles.css','zinc-overrides.css','vendor/chart.umd.min.js','assets/zn-insight.svg','site.webmanifest'])ok(fs.existsSync(new URL(asset,root)),`missing ${asset}`);
if(fail.length){console.error(fail.map(x=>`FAIL: ${x}`).join('\n'));process.exit(1)}
console.log(JSON.stringify({result:'site check passed',charts:Object.keys(data.charts).length,klineCandles:data.kline.candles.length,mineCompanies:data.companies.mine.rows.length,smelterCompanies:data.companies.smelter.rows.length,apiConnected:data.meta.apiConnected},null,2));