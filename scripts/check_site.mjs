import fs from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url),read=n=>fs.readFileSync(new URL(n,root),'utf8');
const html=read('index.html'),app=read('app.js'),dataText=read('data.json'),quotesText=read('quotes.json'),fail=[];
const ok=(v,m)=>{if(!v)fail.push(m)};
ok(html.includes('<meta charset="utf-8">'),'missing UTF-8');ok(html.includes('id="price-lme-spread"'),'LME Cash-3M chart missing');ok(html.includes('<th>资料来源</th>'),'public source column missing');
ok(html.includes('class="nav" id="nav"'),'missing nav class');
ok(html.includes('id="timeframe-tech-grid"'),'timeframe technical grid missing');ok(html.includes('id="timeframe-conclusion"'),'timeframe conclusion missing');ok(app.includes('/api/technical?commodity=zinc'),'zinc technical endpoint missing');
ok(app.includes('/api/quotes?commodity=zinc'),'zinc realtime quote endpoint missing');ok(html.includes('id="overview-trade-profit"'),'trade profit chart missing');
ok(!html.includes('StoneX 2026 核心判断'),'StoneX overview card still present');ok(!html.includes('id="forecast-kpis"'),'forecast KPI container still present');
for(const id of ['overview','framework','price','mine','smelting','demand','inventory','balance','companies','policy','intelligence'])ok(html.includes(`id="${id}"`),`missing ${id}`);
const ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(x=>x[1]);ok(ids.filter((x,i)=>ids.indexOf(x)!==i).length===0,'duplicate ids');
ok(!/\b(?:NaN|Infinity|-Infinity)\b/.test(dataText),'non-finite data');
ok(!/(?:zhiji|知几|直集|智辑)/i.test(html+app+dataText+quotesText),'public source labels expose aggregator brand');
let data;try{data=JSON.parse(dataText)}catch(e){fail.push(`invalid data.json: ${e.message}`)}
if(data){
  ok(data.meta?.apiConnected===true,'network data disconnected');ok(data.meta?.sourceFiles?.length===4,'source files != 4');
  for(const item of Object.values(data.sourceRegistry||{}))ok(['网络','Mysteel','SMM'].includes(item.source),`invalid public source: ${item.source}`);
  ok(Object.keys(data.charts||{}).length>=22,'charts < 22');ok((data.kline?.candles||[]).length>=60,'K line < 60');
  for(const chart of ['monthSpread','concentrateImport','refinedNetImport','galvanizedRateSeasonal','zincOxideRateSeasonal','dieCastRateSeasonal','galvanizedInventorySeasonal','globalExchangeStock','refinedTradeProfit','lmeCash3mSpread'])ok((data.charts?.[chart]?.datasets||[]).some(x=>(x.data||[]).some(v=>v!=null)),`${chart} empty`);
  for(const chart of ['shfePrice','lmePrice','lmeCash3mSpread','globalExchangeStock']){
    const years=(data.charts?.[chart]?.datasets||[]).map(x=>Number(x.label)).filter(Number.isFinite);
    ok(years.length>0&&Math.min(...years)===2022,`${chart} does not start at 2022`);
  }
  ok((data.charts?.refinedTradeProfit?.datasets||[]).length===2,'trade profit series != 2');ok(data.latest?.lmeCash3mSpread?.[1]!=null,'latest LME Cash-3M missing');
  ok(data.latest?.ingotImportProfit?.[1]!=null,'latest ingot import profit missing');ok(data.latest?.ingotExportProfit?.[1]!=null,'latest ingot export profit missing');
  ok((data.researchFramework||[]).length>=16,'research framework incomplete');ok((data.cycleSignals||[]).length===4,'cycle signals != 4');
  ok((data.policyEvents||[]).length>=4,'policy events incomplete');ok(html.includes('id="policy-grid"'),'policy grid missing');ok(html.includes('id="social-grid"'),'social grid missing');
  ok((data.stonex?.forecast?.rows||[]).length>=10,'StoneX forecast empty');ok((data.stonex?.consumption?.rows||[]).length>=40,'StoneX consumption empty');
  ok((data.companies?.mine?.rows||[]).length>=20,'mine companies < 20');ok((data.companies?.smelter?.rows||[]).length>=10,'smelters < 10');ok(data.quote?.last>0,'quote missing');
}
try{new vm.Script(app);new vm.Script(read('data.js'));new vm.Script(read('vendor/chart.umd.min.js'))}catch(e){fail.push(`JavaScript: ${e.message}`)}
for(const asset of ['styles.css','zinc-overrides.css','vendor/chart.umd.min.js','assets/zn-insight.svg','site.webmanifest'])ok(fs.existsSync(new URL(asset,root)),`missing ${asset}`);
if(fail.length){console.error(fail.map(x=>`FAIL: ${x}`).join('\n'));process.exit(1)}
console.log(JSON.stringify({result:'site check passed',charts:Object.keys(data.charts).length,klineCandles:data.kline.candles.length,mineCompanies:data.companies.mine.rows.length,smelterCompanies:data.companies.smelter.rows.length,apiConnected:data.meta.apiConnected},null,2));