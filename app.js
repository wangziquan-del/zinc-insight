(() => {
  "use strict";

  const DATA = window.ZINC_DATA || {};
  const LIVE_API_HOST = "https://tin-insight-api.wangziquan-tin.workers.dev";
  const charts = [];
  const nav = document.getElementById("nav");
  const navButtons = nav ? [...nav.querySelectorAll("button[data-tab]")] : [];
  const sections = [...document.querySelectorAll(".section")];
  const chapterRail = document.querySelector(".chapter-rail");
  const PALETTES = {
    "dark-journal": { text: "#c8d6e5", grid: "#1d2d3a", font: "Inter, Microsoft YaHei, sans-serif" },
    "light-journal": { text: "#3f4b55", grid: "#d9d2c4", font: "Inter, Microsoft YaHei, sans-serif" },
    "market-surge": { text: "#87a3b2", grid: "#172239", font: "Consolas, Microsoft YaHei, monospace" },
    "market-crash": { text: "#648f80", grid: "#153028", font: "Noto Sans SC, Microsoft YaHei, sans-serif" }
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[char]);
  }

  function number(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function fmt(value, digits = 1) {
    const parsed = number(value);
    return parsed == null ? "—" : parsed.toLocaleString("zh-CN", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function signed(value, digits = 1) {
    const parsed = number(value);
    if (parsed == null) return "—";
    return `${parsed > 0 ? "+" : ""}${fmt(parsed, digits)}`;
  }

  function pair(value) {
    return Array.isArray(value) ? value : [null, null];
  }

  function lastValue(chart) {
    if (!chart || !Array.isArray(chart.datasets)) return null;
    for (let datasetIndex = chart.datasets.length - 1; datasetIndex >= 0; datasetIndex -= 1) {
      const values = chart.datasets[datasetIndex].data || [];
      for (let index = values.length - 1; index >= 0; index -= 1) {
        if (number(values[index]) != null) return number(values[index]);
      }
    }
    return null;
  }

  function cssVar(name, fallback) {
    return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
  }

  function applyTheme(name) {
    if (!PALETTES[name]) name = "dark-journal";
    const palette = PALETTES[name];
    document.body.dataset.theme = name;
    if (window.Chart) {
      Chart.defaults.color = palette.text;
      Chart.defaults.borderColor = palette.grid;
      Chart.defaults.font.family = palette.font;
      charts.forEach(chart => {
        const legend = chart.options.plugins && chart.options.plugins.legend;
        if (legend && legend.labels) legend.labels.color = palette.text;
        Object.values(chart.options.scales || {}).forEach(scale => {
          if (scale.ticks) scale.ticks.color = palette.text;
          if (scale.title) scale.title.color = palette.text;
          if (scale.grid && scale.grid.display !== false) scale.grid.color = palette.grid;
        });
        chart.update("none");
      });
    }
    setTimeout(drawKline, 20);
  }

  function updateThemeClock(now = new Date()) {
    const dark = now.getHours() < 6 || now.getHours() >= 18;
    const name = dark ? "dark-journal" : "light-journal";
    if (!document.body.dataset.marketMode) applyTheme(name);
    const label = document.getElementById("theme-mode-label");
    const hero = document.getElementById("hero-theme");
    const clock = document.getElementById("theme-clock");
    if (label) label.textContent = dark ? "NIGHT JOURNAL" : "DAY JOURNAL";
    if (hero) hero.textContent = dark ? "NIGHT / AUTO" : "DAY / AUTO";
    if (clock) clock.textContent = `${now.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} · 06:00 / 18:00`;
  }

  function updateMarketMode(value) {
    const change = number(value);
    const next = change != null && change >= 3 ? "surge" : change != null && change <= -3 ? "crash" : "";
    if (!next) {
      delete document.body.dataset.marketMode;
      document.title = "锌语新愿｜全球锌产业监测台";
      updateThemeClock();
      return;
    }
    document.body.dataset.marketMode = next;
    document.title = next === "surge" ? "长夜临光 // 锌语新愿" : "绿野幻梦 // 锌语新愿";
    applyTheme(next === "surge" ? "market-surge" : "market-crash");
  }

  function merge(left, right) {
    const output = { ...left };
    Object.keys(right || {}).forEach(key => {
      if (right[key] && typeof right[key] === "object" && !Array.isArray(right[key]) && left[key] && typeof left[key] === "object") {
        output[key] = merge(left[key], right[key]);
      } else {
        output[key] = right[key];
      }
    });
    return output;
  }

  function chartOptions(extra = {}) {
    const base = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      normalized: true,
      spanGaps: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { usePointStyle: true, boxWidth: 8 } },
        tooltip: {
          backgroundColor: "rgba(3,10,15,.94)",
          borderColor: cssVar("--line", "#1d2d3a"),
          borderWidth: 1
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { maxTicksLimit: 9 } },
        y: { grid: { color: cssVar("--line", "#1d2d3a") }, ticks: { callback: value => fmt(value, 0) } }
      }
    };
    return merge(base, extra);
  }

  function makeChart(id, type, data, options = {}) {
    const canvas = document.getElementById(id);
    if (!canvas || !data || !Array.isArray(data.labels) || !data.labels.length || !window.Chart) return null;
    const empty = canvas.parentElement && canvas.parentElement.querySelector(".empty");
    if (empty) empty.style.display = "none";
    const chart = new Chart(canvas, { type, data, options: chartOptions(options) });
    charts.push(chart);
    return chart;
  }

  function seasonal(id, chart) {
    return makeChart(id, "line", chart, {
      elements: { point: { radius: 0 }, line: { tension: .14 } }
    });
  }

  function continuous(id, chart, options = {}) {
    return makeChart(id, "line", chart, merge({
      elements: { point: { radius: 0 }, line: { tension: .12 } }
    }, options));
  }

  function renderKpis(id, items) {
    const node = document.getElementById(id);
    if (!node) return;
    node.innerHTML = items.map(item => {
      const tone = item[3] ? ` style="color:${escapeHtml(item[3])}"` : "";
      return `<div class="kpi"><span class="label">${escapeHtml(item[0])}</span><strong${tone}>${escapeHtml(item[1])}</strong><small>${escapeHtml(item[2] || "—")}</small></div>`;
    }).join("");
  }

  function metricValue(row, year) {
    return row && row.values ? number(row.values[String(year)]) : null;
  }

  let overviewQuoteLoading = false;

  function quoteStamp(item, fallback) {
    if (!item) return fallback || "—";
    const stamp = [item.date, item.time].filter(Boolean).join(" ");
    return stamp || fallback || "—";
  }

  function renderOverviewKpis(live = null) {
    const latest = DATA.latest || {};
    const cachedQuote = DATA.quote || {};
    const shfe = pair(latest.shfe);
    const lme = pair(latest.lme);
    const social = pair(latest.socialStock);
    const tcImport = pair(latest.tcImport);
    const liveZn = live && live.zn;
    const liveLme = live && live.lme;
    const shfeValue = liveZn && liveZn.last != null ? number(liveZn.last) : shfe[1];
    const lmeValue = liveLme && liveLme.last != null ? number(liveLme.last) : lme[1];
    const shfeChange = liveZn && liveZn.change_pct != null
      ? number(liveZn.change_pct)
      : (cachedQuote.changePct != null ? number(cachedQuote.changePct) : null);
    renderKpis("overview-kpis", [
      ["沪锌主连", `${fmt(shfeValue, 0)} 元/吨`, quoteStamp(liveZn, cachedQuote.asOf || shfe[0]), shfeChange == null ? "" : (shfeChange >= 0 ? "#ff758f" : "#3dd6b6")],
      ["LME 3M", `${fmt(lmeValue, 1)} 美元/吨`, quoteStamp(liveLme, lme[0])],
      ["国内锌锭现货库存", `${fmt(social[1], 2)} 万吨`, social[0]],
      ["进口矿 TC", `${fmt(tcImport[1], 1)} 美元/干吨`, tcImport[0]]
    ]);
    if (shfeChange != null) updateMarketMode(shfeChange);
  }

  async function refreshOverviewQuotes() {
    if (overviewQuoteLoading) return;
    overviewQuoteLoading = true;
    const status = document.getElementById("live-status");
    try {
      const response = await fetch(`${LIVE_API_HOST}/api/quotes?commodity=zinc&t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload || (!payload.zn && !payload.lme)) throw new Error("empty zinc quote");
      renderOverviewKpis(payload);
      if (status) {
        const stamp = String(payload.updated_at || "").replace("T", " ").slice(0, 19);
        status.textContent = `沪锌 / LME 行情 · 15秒刷新${stamp ? ` · ${stamp}` : ""}`;
        status.className = "tag ok";
      }
    } catch (_) {
      if (status) {
        status.textContent = "实时服务暂不可用 · 显示最近缓存";
        status.className = "tag warn";
      }
    } finally {
      overviewQuoteLoading = false;
    }
  }

  function overview() {
    const latest = DATA.latest || {};
    renderOverviewKpis();
    const status = document.getElementById("live-status");
    if (status) {
      status.textContent = DATA.meta && DATA.meta.apiConnected ? "数据缓存已载入 · 正在连接实时行情" : "Excel 回退 · 正在连接实时行情";
      status.className = `tag ${DATA.meta && DATA.meta.apiConnected ? "ok" : "warn"}`;
    }
    const built = document.getElementById("build-date");
    if (built) built.textContent = ` ${String((DATA.meta || {}).builtAt || "—").replace("T", " ").slice(0, 19)}`;
    seasonal("overview-price", (DATA.charts || {}).shfePrice);
    seasonal("overview-lme", (DATA.charts || {}).lmePrice);
    seasonal("overview-stocks", (DATA.charts || {}).globalExchangeStock);
    continuous("overview-trade-profit", (DATA.charts || {}).refinedTradeProfit, {
      scales: {
        y: {
          grid: {
            color: context => Number(context.tick.value) === 0 ? "#ff758f" : cssVar("--line", "#1d2d3a"),
            lineWidth: context => Number(context.tick.value) === 0 ? 1.8 : 1
          }
        }
      }
    });

    const importProfit = pair(latest.ingotImportProfit);
    const exportProfit = pair(latest.ingotExportProfit);
    const callout = document.getElementById("overview-callout");
    if (callout) {
      callout.innerHTML = `<b>进出口利润交叉验证：</b>以 0 线判断贸易窗口。进口盈亏转正偏向增加国内供应，出口利润转正偏向减少国内供应；两条线谁更接近 0，可验证内外盘价差对应的贸易方向。最新进口盈亏 <b>${fmt(importProfit[1], 0)} 元/吨</b>（${escapeHtml(importProfit[0] || "—")}），出口利润 <b>${fmt(exportProfit[1], 0)} 元/吨</b>（${escapeHtml(exportProfit[0] || "—")}）。`;
    }
  }
  function frameworkSection() {
    const grid = document.getElementById("cycle-signal-grid");
    if (grid) grid.innerHTML = (DATA.cycleSignals || []).map(item => `<article class="tech-card ${escapeHtml(item.tone || "neutral")}">
      <h3>${escapeHtml(item.name)}<span class="score">${escapeHtml(item.state)}</span></h3>
      <p>${escapeHtml(item.detail)}</p></article>`).join("");
    const body = document.getElementById("framework-body");
    if (body) body.innerHTML = (DATA.researchFramework || []).map(item => `<tr>
      <td>${escapeHtml(item.module)}</td><td><b>${escapeHtml(item.metric)}</b></td>
      <td><span class="tag ${item.importance === "核心" ? "warn" : "ok"}">${escapeHtml(item.importance)}</span></td>
      <td>${escapeHtml(item.frequency)}</td><td>${escapeHtml(item.view)}</td><td>${escapeHtml(item.reason)}</td></tr>`).join("");
  }
  function priceSection() {
    const latest = DATA.latest || {};
    const quote = DATA.quote || {};
    renderKpis("price-kpis", [
      ["沪锌日涨跌", `${signed(quote.changePct, 2)}%`, quote.asOf || "—"],
      ["上海0#升贴水", `${signed(pair(latest.shanghaiPremium)[1], 0)} 元/吨`, pair(latest.shanghaiPremium)[0]],
      ["LME Cash−3M", `${signed(pair(latest.lmeCash3mSpread)[1], 1)} 美元/吨`, pair(latest.lmeCash3mSpread)[0]],
      ["60日区间", `${fmt((DATA.kline || {}).low60, 0)}–${fmt((DATA.kline || {}).high60, 0)}`, "沪锌主连"],
      ["RSI(14)", fmt((DATA.kline || {}).rsi14, 1), (DATA.kline || {}).trend || "—"]
    ]);
    seasonal("price-shfe", (DATA.charts || {}).shfePrice);
    seasonal("price-lme", (DATA.charts || {}).lmePrice);
    seasonal("price-lme-spread", (DATA.charts || {}).lmeCash3mSpread);
    seasonal("price-spread", (DATA.charts || {}).monthSpread);
    continuous("price-premium", (DATA.charts || {}).premium, {
      scales: { y: { title: { display: true, text: "元/吨" } } }
    });
  }

  function mineSection() {
    const latest = DATA.latest || {};
    renderKpis("mine-kpis", [
      ["国内矿产量", `${fmt(pair(latest.concentrateOutput)[1], 2)} 万吨`, pair(latest.concentrateOutput)[0]],
      ["港口矿库存", `${fmt(pair(latest.concentratePortStock)[1], 2)} 万吨`, pair(latest.concentratePortStock)[0]],
      ["北方国产 TC", `${fmt(pair(latest.tcNorth)[1], 0)} 元/金属吨`, pair(latest.tcNorth)[0]],
      ["进口 TC", `${fmt(pair(latest.tcImport)[1], 1)} 美元/干吨`, pair(latest.tcImport)[0]]
    ]);
    seasonal("mine-output", (DATA.charts || {}).concentrateOutput);
    seasonal("mine-import", (DATA.charts || {}).concentrateImport);
    seasonal("mine-port-stock", (DATA.charts || {}).concentratePortStock);
    const tc = JSON.parse(JSON.stringify((DATA.charts || {}).tc || { labels: [], datasets: [] }));
    (tc.datasets || []).forEach(dataset => { if (/进口/.test(dataset.label)) dataset.yAxisID = "y1"; });
    continuous("mine-tc", tc, {
      scales: {
        y: { position: "left", title: { display: true, text: "国产：元/金属吨" } },
        y1: { position: "right", title: { display: true, text: "进口：美元/干吨" }, grid: { drawOnChartArea: false } }
      }
    });
    renderMineBalance("mine-balance-chart", (DATA.balances || {}).mine || []);
    const body = document.getElementById("projects-body");
    if (body) body.innerHTML = (DATA.projects || []).map(row => `<tr>
      <td>${escapeHtml(row.country)}</td><td>${escapeHtml(row.project)}</td><td>${escapeHtml(row.stage)}</td>
      <td class="num">${fmt(row.y2024, 1)}</td><td class="num">${fmt(row.y2025, 1)}</td><td class="num">${fmt(row.y2026, 1)}</td>
      <td>${escapeHtml(row.note)}</td></tr>`).join("");
  }

  function smeltingSection() {
    const latest = DATA.latest || {};
    const trade = (DATA.charts || {}).refinedTrade || {};
    const imports = trade.datasets && trade.datasets[0] ? lastValue({ datasets: [trade.datasets[0]] }) : null;
    const exports = trade.datasets && trade.datasets[1] ? lastValue({ datasets: [trade.datasets[1]] }) : null;
    renderKpis("smelting-kpis", [
      ["精炼锌产量", `${fmt(pair(latest.refinedOutput)[1], 2)} 万吨`, pair(latest.refinedOutput)[0]],
      ["精炼锌净进口", `${signed(imports != null && exports != null ? imports - exports : null, 2)} 万吨`, "最新共同月份"],
      ["北方国产 TC", `${fmt(pair(latest.tcNorth)[1], 0)} 元/金属吨`, pair(latest.tcNorth)[0]],
      ["南方国产 TC", `${fmt(pair(latest.tcSouth)[1], 0)} 元/金属吨`, pair(latest.tcSouth)[0]]
    ]);
    seasonal("smelting-output", (DATA.charts || {}).refinedOutput);
    seasonal("smelting-net-import", (DATA.charts || {}).refinedNetImport);
    continuous("smelting-trade", (DATA.charts || {}).refinedTrade, {
      scales: { y: { title: { display: true, text: "万吨" } } }
    });
    continuous("smelting-profit", (DATA.charts || {}).smeltingProfit, {
      scales: { y: { title: { display: true, text: "元/吨（模型）" } } }
    });
  }

  function demandSection() {
    const latest = DATA.latest || {};
    renderKpis("demand-kpis", [
      ["镀锌开工率", `${fmt(pair(latest.galvanizedRate)[1], 1)}%`, pair(latest.galvanizedRate)[0]],
      ["氧化锌开工率", `${fmt(pair(latest.zincOxideRate)[1], 1)}%`, pair(latest.zincOxideRate)[0]],
      ["锌合金开工率", `${fmt(pair(latest.dieCastRate)[1], 1)}%`, pair(latest.dieCastRate)[0]],
      ["StoneX 2026消费", `${fmt(metricValue((DATA.forecastSummary || {}).consumption, 2026), 0)} kt`, "全球精炼锌"]
    ]);
    seasonal("demand-galvanized-rate", (DATA.charts || {}).galvanizedRateSeasonal);
    seasonal("demand-oxide-rate", (DATA.charts || {}).zincOxideRateSeasonal);
    seasonal("demand-diecast-rate", (DATA.charts || {}).dieCastRateSeasonal);
    continuous("demand-rates", (DATA.charts || {}).downstreamRates, {
      scales: { y: { suggestedMin: 0, suggestedMax: 100, title: { display: true, text: "%" } } }
    });
    seasonal("demand-inventory-seasonal", (DATA.charts || {}).galvanizedInventorySeasonal);
    continuous("demand-inventory", (DATA.charts || {}).galvanizedInventory, {
      scales: { y: { title: { display: true, text: "万吨" } } }
    });
    continuous("demand-pmi", (DATA.charts || {}).pmi, {
      scales: { y: { suggestedMin: 35, suggestedMax: 65 } }
    });
    renderStoneXCountries("demand-global", ((DATA.stonex || {}).consumption || {}), ["China", "India", "Japan", "Germany", "United States", "Europe"]);
  }

  function inventorySection() {
    const latest = DATA.latest || {};
    renderKpis("inventory-kpis", [
      ["SHFE锌库存", `${fmt(pair(latest.shfeStock)[1], 0)} 吨`, pair(latest.shfeStock)[0]],
      ["LME锌库存", `${fmt(pair(latest.lmeStock)[1], 0)} 吨`, pair(latest.lmeStock)[0]],
      ["国内现货库存", `${fmt(pair(latest.socialStock)[1], 2)} 万吨`, pair(latest.socialStock)[0]],
      ["精矿港口库存", `${fmt(pair(latest.concentratePortStock)[1], 2)} 万吨`, pair(latest.concentratePortStock)[0]]
    ]);
    seasonal("inventory-shfe", (DATA.charts || {}).shfeStock);
    seasonal("inventory-lme", (DATA.charts || {}).lmeStock);
    seasonal("inventory-social", (DATA.charts || {}).socialStock);
    seasonal("inventory-port", (DATA.charts || {}).concentratePortStock);
  }

  function renderMineBalance(id, rows) {
    const view = rows.slice(-36);
    makeChart(id, "bar", {
      labels: view.map(row => row.date),
      datasets: [
        { label: "总供应", data: view.map(row => row.totalSupply), backgroundColor: "#6e9fff88", borderWidth: 0 },
        { label: "冶炼需求", data: view.map(row => row.smelterUse), backgroundColor: "#f4b94288", borderWidth: 0 },
        { label: "月差", data: view.map(row => row.balance), type: "line", borderColor: "#3dd6b6", backgroundColor: "#3dd6b618", pointRadius: 0, borderWidth: 2, tension: .15 }
      ]
    }, { scales: { y: { title: { display: true, text: "万吨金属量" } } } });
  }

  function renderRefinedBalance(id, rows) {
    const view = rows.slice(-36);
    makeChart(id, "bar", {
      labels: view.map(row => row.date),
      datasets: [
        { label: "总供应", data: view.map(row => row.totalSupply), backgroundColor: "#6e9fff88", borderWidth: 0 },
        { label: "表观消费", data: view.map(row => row.apparentConsumption), backgroundColor: "#f4b94288", borderWidth: 0 },
        { label: "社库变化", data: view.map(row => row.stockChange), type: "line", borderColor: "#ff758f", pointRadius: 0, borderWidth: 2, tension: .15 }
      ]
    }, { scales: { y: { title: { display: true, text: "万吨" } } } });
  }

  function balanceSection() {
    const balances = DATA.balances || {};
    renderMineBalance("balance-mine", balances.mine || []);
    renderRefinedBalance("balance-refined", balances.refined || []);
    renderBalanceTable(balances.mine || [], balances.refined || []);
    renderGlobalBalance();
    renderQuarterlyBalance();
  }

  function renderBalanceTable(mineRows, refinedRows) {
    const mine = Object.fromEntries(mineRows.map(row => [row.date, row]));
    const refined = Object.fromEntries(refinedRows.map(row => [row.date, row]));
    const months = [...new Set([...Object.keys(mine), ...Object.keys(refined)])].sort().slice(-18).reverse();
    const body = document.getElementById("balance-body");
    if (!body) return;
    body.innerHTML = months.map(month => {
      const m = mine[month] || {};
      const r = refined[month] || {};
      const basis = r.basis || m.basis || "—";
      return `<tr><td>${month}</td><td class="num">${fmt(m.totalSupply, 2)}</td><td class="num">${fmt(m.smelterUse, 2)}</td>
        <td class="num">${signed(m.balance, 2)}</td><td class="num">${fmt(r.production, 2)}</td><td class="num">${signed(r.netImport, 2)}</td>
        <td class="num">${fmt(r.totalSupply, 2)}</td><td class="num">${fmt(r.apparentConsumption, 2)}</td><td class="num">${signed(r.stockChange, 2)}</td>
        <td class="basis-note">${escapeHtml(basis)}</td></tr>`;
    }).join("");
  }

  function renderGlobalBalance() {
    const summary = DATA.forecastSummary || {};
    const years = summary.years || [];
    makeChart("balance-global", "bar", {
      labels: years.map(String),
      datasets: [
        { label: "精矿平衡", data: years.map(year => metricValue(summary.concentrateBalance, year)), backgroundColor: "#6e9fff99" },
        { label: "锌锭平衡", data: years.map(year => metricValue(summary.metalBalance, year)), backgroundColor: "#3dd6b699" }
      ]
    }, { scales: { y: { title: { display: true, text: "千吨" } } } });
  }

  function renderQuarterlyBalance() {
    const rows = ((DATA.stonex || {}).quarterly || []).slice(-16);
    makeChart("balance-quarterly", "bar", {
      labels: rows.map(row => row.period),
      datasets: [
        { label: "供应", data: rows.map(row => row.supply), backgroundColor: "#6e9fff88" },
        { label: "消费", data: rows.map(row => row.consumption), backgroundColor: "#f4b94288" },
        { label: "平衡", data: rows.map(row => row.balance), type: "line", borderColor: "#3dd6b6", pointRadius: 2, yAxisID: "y1" }
      ]
    }, {
      scales: {
        y: { title: { display: true, text: "供应 / 消费（千吨）" } },
        y1: { position: "right", title: { display: true, text: "平衡（千吨）" }, grid: { drawOnChartArea: false } }
      }
    });
  }

  function renderStoneXCountries(id, dataset, preferred) {
    const rows = dataset.rows || [];
    const years = dataset.years || [];
    const selected = [];
    preferred.forEach(name => {
      const match = rows.find(row => row.name.toLowerCase() === name.toLowerCase());
      if (match && !selected.includes(match)) selected.push(match);
    });
    if (selected.length < 4) {
      rows.slice().sort((a, b) => (metricValue(b, 2026) || 0) - (metricValue(a, 2026) || 0)).forEach(row => {
        if (selected.length < 6 && !/total|growth|world/i.test(row.name) && !selected.includes(row)) selected.push(row);
      });
    }
    makeChart(id, "line", {
      labels: years.map(String),
      datasets: selected.slice(0, 6).map((row, index) => ({
        label: row.name,
        data: years.map(year => metricValue(row, year)),
        borderColor: ["#6e9fff", "#f4b942", "#3dd6b6", "#ff758f", "#a989ff", "#ff9f43"][index],
        backgroundColor: "transparent",
        pointRadius: 2,
        tension: .15
      }))
    }, { scales: { y: { title: { display: true, text: "千吨" } } } });
  }

  function selectedColumns(headers, kind) {
    const base = kind === "mine" ? [0, 1, 2] : [0, 1];
    headers.forEach((header, index) => {
      const label = String(header || "");
      if (/25Q[1-4]|25总计|26Q[1-4]|26年|最新指引|变化原因|备注|说明/.test(label)) base.push(index);
    });
    return [...new Set(base)].filter(index => index < headers.length);
  }

  function renderCompanyTable(kind, table, headId, bodyId) {
    const headers = table.headers || [];
    const columns = selectedColumns(headers, kind);
    const head = document.getElementById(headId);
    const body = document.getElementById(bodyId);
    if (head) head.innerHTML = `<tr>${columns.map(index => `<th class="${index >= (kind === "mine" ? 3 : 2) ? "num" : ""}">${escapeHtml(headers[index])}</th>`).join("")}</tr>`;
    if (body) body.innerHTML = (table.rows || []).map(row => `<tr>${columns.map(index => {
      const value = row[index];
      const numeric = number(value);
      return `<td class="${index >= (kind === "mine" ? 3 : 2) && numeric != null ? "num" : ""}">${numeric != null ? fmt(numeric, 2) : escapeHtml(value)}</td>`;
    }).join("")}</tr>`).join("");
  }

  function renderGenericTable(table, headId, bodyId) {
    const head = document.getElementById(headId);
    const body = document.getElementById(bodyId);
    if (head) head.innerHTML = `<tr>${(table.headers || []).map(header => `<th>${escapeHtml(header)}</th>`).join("")}</tr>`;
    if (body) body.innerHTML = (table.rows || []).map(row => `<tr>${(table.headers || []).map((_, index) => `<td>${escapeHtml(row[index])}</td>`).join("")}</tr>`).join("");
  }

  function companiesSection() {
    const companies = DATA.companies || {};
    renderCompanyTable("mine", companies.mine || {}, "mine-company-head", "mine-company-body");
    renderCompanyTable("smelter", companies.smelter || {}, "smelter-company-head", "smelter-company-body");
    renderGenericTable(companies.capex || {}, "capex-head", "capex-body");
    const calendar = document.getElementById("calendar-list");
    if (calendar) calendar.innerHTML = (DATA.calendar || []).map(item => `<article><time>${escapeHtml(item.date)}</time><div><b>${escapeHtml(item.company)}</b><p>${escapeHtml(item.event)}</p></div></article>`).join("");
    const log = document.getElementById("update-log");
    const rows = ((companies.log || {}).rows || []).slice(-5).reverse();
    if (log) log.innerHTML = rows.map(row => `<article><time>${escapeHtml(row[0])}</time><div><b>${escapeHtml(String(row[1] || "").slice(0, 38))}</b><p>${escapeHtml(String(row[2] || "官方财报 / 数据源"))}</p></div></article>`).join("");
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return /^(https?:)$/.test(url.protocol) ? url.href : "";
    } catch (_) {
      return "";
    }
  }

  function policySection() {
    const items = DATA.policyEvents || [];
    const grid = document.getElementById("policy-grid");
    if (grid) grid.innerHTML = items.map(item => {
      const url = safeExternalUrl(item.url);
      return `<article class="news">
        <span class="news-category">${escapeHtml(item.category || "政策 / 事件")}</span>
        <div class="date">${escapeHtml(item.date || "—")}</div>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.summary)}</p>
        <span class="news-source">${escapeHtml(item.source || "公开来源")}${item.official ? " · 官方源" : " · 聚合源"}</span>
        ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">查看原文核验 →</a>` : ""}
      </article>`;
    }).join("");
    const status = document.getElementById("policy-status");
    if (status) {
      status.textContent = `官方政策快照 · ${items.length} 条`;
      status.className = `tag ${items.length ? "ok" : "warn"}`;
    }
  }

  function renderSocial(items) {
    const grid = document.getElementById("social-grid");
    if (!grid) return;
    grid.innerHTML = items.map(item => {
      const url = safeExternalUrl(item.url);
      const heat = Math.max(0, Math.min(100, number(item.heat) || 0));
      return `<article class="news social-item">
        <span class="news-category">${escapeHtml(item.platform || "社交平台")} · ${escapeHtml(item.tone || "分歧")}</span>
        <div class="date">${escapeHtml(item.date || "—")}</div>
        <h3>${escapeHtml(item.title)}</h3>
        <p>${escapeHtml(item.author || "未知作者")} · 赞 ${fmt(item.likes, 0)} · 评 ${fmt(item.comments, 0)}</p>
        <div class="heat" title="互动热度代理"><i style="width:${heat}%"></i></div>
        ${url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">打开真实内容 →</a>` : ""}
      </article>`;
    }).join("");
  }

  function timeframeConclusion(items) {
    const status = Object.fromEntries(items.map(item => [String(item.frame || ""), item.status]));
    const small = status["小级别｜15 分钟"];
    const medium = status["中级别｜60 分钟"];
    const large = status["大级别｜日线"];
    if (small === "偏多" && medium === "偏多" && large === "偏多") return "小、中、大级别形成偏多共振；仍需用价格结构和风险位验证，不等同于追涨信号。";
    if (small === "偏空" && medium === "偏空" && large === "偏空") return "小、中、大级别形成偏空共振；仍需防范超跌反抽，不等同于追空信号。";
    if (large === "偏多" && small === "偏空") return "大级别保持偏多，小级别转弱，当前更像上涨结构中的回调或分歧阶段。";
    if (large === "偏空" && small === "偏多") return "大级别仍偏空，小级别修复，当前更像弱势结构中的反弹或分歧阶段。";
    if (medium === large && medium && small !== medium) return `中、大级别${medium}，小级别尚未确认，等待短周期重新与主趋势同向。`;
    return "三个级别方向分化，优先服从大级别、用中级别确认、小级别寻找节奏。";
  }

  function renderTimeframeTechnical(items, updatedAt, source) {
    const grid = document.getElementById("timeframe-tech-grid");
    if (!grid || !Array.isArray(items) || !items.length) return;
    grid.innerHTML = items.map(item => {
      const tone = ["up", "down", "neutral"].includes(item.tone) ? item.tone : "neutral";
      return `<article class="tech-card ${tone}"><h3>${escapeHtml(item.frame)}<span class="score">${escapeHtml(item.status)}</span></h3><p>${escapeHtml(item.detail)}</p></article>`;
    }).join("");
    const conclusion = document.getElementById("timeframe-conclusion");
    if (conclusion) conclusion.innerHTML = `<b>多周期结论：</b>${escapeHtml(timeframeConclusion(items))}`;
    const meta = document.getElementById("multi-tech-meta");
    if (meta) meta.textContent = `${source || "沪锌多周期技术分析"} · 更新 ${String(updatedAt || "—").replace("T", " ").slice(0, 16)}`;
  }

  async function refreshTimeframeTechnical() {
    const status = document.getElementById("multi-tech-status");
    const snapshotKey = "zinc-timeframe-tech-v1";
    try {
      const response = await fetch(`${LIVE_API_HOST}/api/technical?commodity=zinc&t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.commodity !== "zinc") throw new Error("commodity mismatch");
      const items = Array.isArray(payload.tech) ? payload.tech : [];
      if (!items.length) throw new Error("empty technical payload");
      renderTimeframeTechnical(items, payload.updated_at, payload.source);
      try { localStorage.setItem(snapshotKey, JSON.stringify(payload)); } catch (_) {}
      const failures = Object.keys(payload.errors || {}).length;
      if (status) {
        status.textContent = `${items.length}/3 级别已更新${failures ? " · 部分周期异常" : ""}`;
        status.className = `tag ${failures ? "warn" : "ok"}`;
      }
    } catch (error) {
      let restored = false;
      try {
        const cached = JSON.parse(localStorage.getItem(snapshotKey) || "null");
        if (cached && Array.isArray(cached.tech) && cached.tech.length) {
          renderTimeframeTechnical(cached.tech, cached.updated_at, `${cached.source || "多周期技术分析"} · 最近成功快照`);
          restored = true;
        }
      } catch (_) {}
      if (status) {
        status.textContent = restored ? "实时异常 · 保留最近快照" : "多周期接口暂不可用";
        status.className = "tag warn";
        status.title = String(error && error.message || error);
      }
    }
  }
  async function refreshSocialIntelligence() {
    const status = document.getElementById("social-status");
    try {
      const response = await fetch(`${LIVE_API_HOST}/api/social?commodity=zinc&t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (payload.keyword !== "沪锌") throw new Error("keyword mismatch");
      const items = Array.isArray(payload.items) ? payload.items : [];
      if (!items.length) throw new Error("empty social payload");
      renderSocial(items);
      const sources = Object.values(payload.sources || {});
      const ok = sources.filter(source => source.ok).length;
      if (status) {
        status.textContent = `真实结果 ${items.length} 条 · ${ok}/${sources.length} 渠道`;
        status.className = `tag ${ok ? "ok" : "warn"}`;
      }
    } catch (error) {
      if (status) {
        status.textContent = "远程 MCP 暂不可用 · 未生成模拟结果";
        status.className = "tag warn";
        status.title = String(error && error.message || error);
      }
    }
  }
  function ema(values, period) {
    if (!values.length) return [];
    const factor = 2 / (period + 1);
    const output = [values[0]];
    for (let index = 1; index < values.length; index += 1) output.push(values[index] * factor + output[index - 1] * (1 - factor));
    return output;
  }

  function intelligenceSection() {
    const kline = DATA.kline || {};
    const candles = kline.candles || [];
    const closes = candles.map(item => number(item.c)).filter(value => value != null);
    const macdFast = ema(closes, 12);
    const macdSlow = ema(closes, 26);
    const macd = closes.length ? macdFast[macdFast.length - 1] - macdSlow[macdSlow.length - 1] : null;
    const latest = number(kline.latest);
    const high = number(kline.high60);
    const low = number(kline.low60);
    const position = latest != null && high != null && low != null && high !== low ? (latest - low) / (high - low) : null;
    const frames = [
      ["道氏趋势", kline.trend || "数据不足", `收盘 ${fmt(latest, 0)}；60日区间 ${fmt(low, 0)}–${fmt(high, 0)}`, /多头/.test(kline.trend) ? "up" : /空头/.test(kline.trend) ? "down" : "neutral"],
      ["缠论位置", position == null ? "数据不足" : position > .67 ? "区间上沿" : position < .33 ? "区间下沿" : "中枢震荡", `价格处于60日区间 ${position == null ? "—" : fmt(position * 100, 0) + "%"} 分位`, position > .67 ? "up" : position < .33 ? "down" : "neutral"],
      ["MACD动能", macd == null ? "数据不足" : macd >= 0 ? "正向动能" : "负向动能", `日线 DIF 代理 ${signed(macd, 1)}；用于方向识别，不替代交易信号`, macd >= 0 ? "up" : "down"],
      ["RSI / 江恩", number(kline.rsi14) > 70 ? "偏热" : number(kline.rsi14) < 30 ? "偏冷" : "中性", `RSI(14) ${fmt(kline.rsi14, 1)}；结合60日高低点观察时间与空间`, number(kline.rsi14) > 70 ? "up" : number(kline.rsi14) < 30 ? "down" : "neutral"]
    ];
    const grid = document.getElementById("tech-grid");
    if (grid) grid.innerHTML = frames.map(item => `<article class="tech-card ${item[3]}"><h3>${item[0]}<span class="score">${escapeHtml(item[1])}</span></h3><p>${escapeHtml(item[2])}</p></article>`).join("");
    const status = document.getElementById("intelligence-status");
    if (status) {
      status.textContent = candles.length ? `网络日K · ${candles.length}根` : "日K回退 · 数据有限";
      status.className = `tag ${candles.length ? "ok" : "warn"}`;
    }
    const meta = document.getElementById("technical-meta");
    if (meta && candles.length) meta.textContent = `网络日K · ${candles[0].time}—${candles[candles.length - 1].time} · MA5 / MA20 / MA60 / MA120`;
    renderSources();
    setTimeout(drawKline, 30);
  }

  function renderSources() {
    const body = document.getElementById("source-body");
    const registry = DATA.sourceRegistry || {};
    if (body) body.innerHTML = Object.entries(registry).map(([label, item]) => {
      const ok = !item.error;
      return `<tr><td>${escapeHtml(label)}</td><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.name || "—")}</td>
        <td>${escapeHtml(item.source || "网络")}</td><td>${escapeHtml(item.unit || "—")}</td><td>${escapeHtml(item.frequency || "—")}</td><td>${escapeHtml(item.dataLatest || "—")}</td>
        <td class="${ok ? "source-ok" : "source-warn"}">${ok ? "已连接" : escapeHtml(item.error)}</td></tr>`;
    }).join("");
    const files = document.getElementById("source-files");
    if (files) files.innerHTML = ((DATA.meta || {}).sourceFiles || []).map(item => `<div class="file-item"><b>${escapeHtml(item.name)}</b><span>修改：${escapeHtml(String(item.modified || "").replace("T", " "))}</span><span>大小：${fmt(number(item.size) / 1024, 0)} KB</span></div>`).join("");
  }

  function drawKline() {
    const canvas = document.getElementById("kline-canvas");
    const block = DATA.kline || {};
    const candles = (block.candles || []).slice(-180);
    if (!canvas || !candles.length) return;
    const holder = canvas.parentElement;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(320, holder.clientWidth);
    const height = Math.max(300, holder.clientHeight);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const pad = { left: 58, right: 18, top: 26, bottom: 30 };
    const plotHeight = height - pad.top - pad.bottom;
    const highs = candles.map(item => number(item.h));
    const lows = candles.map(item => number(item.l));
    const max = Math.max(...highs);
    const min = Math.min(...lows);
    const range = Math.max(1, max - min);
    const y = value => pad.top + (max - value) / range * plotHeight;
    const step = (width - pad.left - pad.right) / candles.length;
    ctx.font = "11px Consolas, Microsoft YaHei, sans-serif";
    ctx.textAlign = "right";
    ctx.fillStyle = cssVar("--muted", "#789");
    ctx.strokeStyle = cssVar("--line", "#1d2d3a");
    ctx.lineWidth = 1;
    for (let index = 0; index <= 5; index += 1) {
      const value = max - range * index / 5;
      const yy = y(value);
      ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(width - pad.right, yy); ctx.stroke();
      ctx.fillText(fmt(value, 0), pad.left - 7, yy + 4);
    }
    const bodyWidth = Math.max(1, Math.min(5, step * .62));
    candles.forEach((item, index) => {
      const x = pad.left + step * (index + .5);
      const up = item.c >= item.o;
      ctx.strokeStyle = up ? "#ff758f" : "#3dd6b6";
      ctx.fillStyle = up ? "#ff758f" : "#3dd6b6";
      ctx.beginPath(); ctx.moveTo(x, y(item.h)); ctx.lineTo(x, y(item.l)); ctx.stroke();
      const top = y(Math.max(item.o, item.c));
      const bottom = y(Math.min(item.o, item.c));
      ctx.fillRect(x - bodyWidth / 2, top, bodyWidth, Math.max(1, bottom - top));
    });
    const total = (block.candles || []).length;
    const startIndex = Math.max(0, total - candles.length);
    const colors = { MA5: "#f4b942", MA20: "#6e9fff", MA60: "#a989ff", MA120: "#ffffff" };
    Object.entries(block.mas || {}).forEach(([name, values]) => {
      const subset = values.slice(startIndex);
      ctx.strokeStyle = colors[name] || "#fff";
      ctx.lineWidth = name === "MA120" ? 1.8 : 1.25;
      ctx.beginPath();
      let open = false;
      subset.forEach((value, index) => {
        if (value == null) { open = false; return; }
        const x = pad.left + step * (index + .5);
        const yy = y(value);
        if (!open) { ctx.moveTo(x, yy); open = true; } else ctx.lineTo(x, yy);
      });
      ctx.stroke();
    });
    let legendX = pad.left;
    ctx.textAlign = "left";
    Object.entries(block.mas || {}).forEach(([name, values]) => {
      const value = [...values].reverse().find(item => item != null);
      ctx.fillStyle = colors[name] || "#fff";
      const label = `${name} ${fmt(value, 0)}`;
      ctx.fillText(label, legendX, 16);
      legendX += ctx.measureText(label).width + 17;
    });
    const last = candles[candles.length - 1];
    ctx.textAlign = "right";
    ctx.fillStyle = last.c >= last.o ? "#ff758f" : "#3dd6b6";
    ctx.font = "700 12px Inter, Microsoft YaHei, sans-serif";
    ctx.fillText(`收盘 ${fmt(last.c, 0)}`, width - pad.right, 16);
  }

  function activateSection(button, resize = true) {
    if (!button) return;
    const index = Math.max(0, navButtons.indexOf(button));
    navButtons.forEach(item => {
      item.classList.toggle("active", item === button);
      item.setAttribute("aria-selected", item === button ? "true" : "false");
    });
    sections.forEach(section => section.classList.toggle("active", section.id === button.dataset.tab));
    if (nav) nav.style.setProperty("--nav-progress", `${(index + 1) / navButtons.length * 100}%`);
    if (chapterRail) {
      chapterRail.querySelector("strong").textContent = String(index + 1).padStart(2, "0");
      chapterRail.querySelector("em").textContent = button.dataset.tab.toUpperCase();
    }
    history.replaceState(null, "", `#${button.dataset.tab}`);
    if (resize) setTimeout(() => { charts.forEach(chart => chart.resize()); drawKline(); }, 70);
  }

  function setupMotion() {
    const targets = [...document.querySelectorAll(".section .kpi,.section .card,.section .tech-card")];
    targets.forEach((node, index) => {
      node.classList.add("ui-reveal");
      node.style.setProperty("--reveal-delay", `${(index % 6) * 45}ms`);
    });
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      targets.forEach(node => node.classList.add("ui-visible"));
      return;
    }
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add("ui-visible");
        observer.unobserve(entry.target);
      }
    }), { threshold: .08, rootMargin: "40px 0px -4%" });
    targets.forEach(node => observer.observe(node));
  }

  function setupAuth() {
    const expected = "dfc1d541e6dbbc1f24d98dde8da2f19bd6fc57565ff43ff04a012a12958966ca";
    const key = "zinc-auth-v1";
    const gate = document.getElementById("auth-gate");
    const panel = document.getElementById("auth-panel");
    const form = document.getElementById("auth-form");
    const input = document.getElementById("auth-password");
    const submit = document.getElementById("auth-submit");
    const error = document.getElementById("auth-error");
    const steps = [...document.querySelectorAll("[data-auth-step]")];
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.body.classList.add("site-locked");
    const unlock = (immediate = false) => {
      document.body.classList.remove("site-locked");
      if (immediate) { gate.classList.add("hidden"); return; }
      gate.classList.add("auth-opening");
      setTimeout(() => gate.classList.add("hidden"), reduced ? 40 : 560);
      setTimeout(() => window.dispatchEvent(new Event("resize")), 80);
    };
    try {
      if (sessionStorage.getItem(key) === "ok") { unlock(true); return; }
    } catch (_) {}
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (submit.disabled) return;
      error.textContent = "";
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input.value));
      const hex = Array.from(new Uint8Array(digest)).map(value => value.toString(16).padStart(2, "0")).join("");
      if (hex !== expected) {
        error.textContent = "口令不正确";
        panel.classList.remove("auth-denied");
        requestAnimationFrame(() => panel.classList.add("auth-denied"));
        setTimeout(() => panel.classList.remove("auth-denied"), 340);
        input.select();
        return;
      }
      try { sessionStorage.setItem(key, "ok"); } catch (_) {}
      input.value = "";
      input.disabled = true;
      submit.disabled = true;
      submit.textContent = "认证中";
      gate.classList.add("auth-verifying");
      const delays = reduced ? [0, 40, 80] : [120, 430, 740];
      steps.forEach((step, index) => setTimeout(() => step.classList.add("active"), delays[index]));
      setTimeout(() => { submit.textContent = "已连接"; unlock(false); }, reduced ? 150 : 1040);
    });
  }

  function init() {
    setupAuth();
    updateThemeClock();
    setInterval(() => updateThemeClock(), 60_000);
    overview();
    refreshOverviewQuotes();
    setInterval(refreshOverviewQuotes, 15_000);
    frameworkSection();
    priceSection();
    mineSection();
    smeltingSection();
    demandSection();
    inventorySection();
    balanceSection();
    companiesSection();
    policySection();
    intelligenceSection();
    refreshTimeframeTechnical();
    refreshSocialIntelligence();
    navButtons.forEach(button => button.addEventListener("click", () => activateSection(button)));
    const requested = location.hash.replace("#", "");
    activateSection(navButtons.find(button => button.dataset.tab === requested) || navButtons[0], false);
    setupMotion();
    window.addEventListener("resize", drawKline);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
