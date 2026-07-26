"""Refresh deployed data from Zhiji without local Excel files."""
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_site as z


def main():
    data = json.loads((ROOT / "data.json").read_text(encoding="utf-8"))
    key = z.load_api_key()
    if not key:
        raise RuntimeError("ZHIJI_API_KEY is not configured")
    series, metadata = z.fetch_api_bundle(key)
    if not any(series.values()):
        raise RuntimeError("Zhiji returned no usable series")
    now = datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(timespec="seconds")
    meta = data["meta"]
    meta.setdefault("excelBuiltAt", meta.get("builtAt"))
    meta.update(builtAt=now, liveRefreshedAt=now, apiConnected=True,
                refreshMode="GitHub Actions / Zhiji API")
    data["sourceRegistry"].update(metadata)
    try:
        quote = z.fetch_quote(key)
        if quote.get("last") is not None:
            data["quote"] = quote
    except Exception as exc:
        meta["warnings"].append({"source": "直集实时行情刷新", "issue": type(exc).__name__})
    try:
        rows = z.fetch_kline(key)
        if rows:
            data["kline"] = z.enrich_kline(rows)
    except Exception as exc:
        rows = []
        meta["warnings"].append({"source": "直集日K刷新", "issue": type(exc).__name__})

    latest = data["latest"]
    quote = data.get("quote", {})
    if quote.get("last") is not None:
        latest["shfe"] = [quote.get("asOf"), quote["last"]]
    latest_map = {
        "lme": "lme_price", "shfeStock": "shfe_stock", "lmeStock": "lme_stock",
        "socialStock": "social_stock", "concentratePortStock": "concentrate_port_stock",
        "tcImport": "tc_import", "tcNorth": "tc_north", "tcSouth": "tc_south",
        "refinedOutput": "refined_output", "concentrateOutput": "concentrate_output",
        "oreImport": "concentrate_import",
        "galvanizedRate": "galvanized_rate", "zincOxideRate": "zinc_oxide_rate",
        "dieCastRate": "die_cast_rate", "shanghaiPremium": "shanghai_premium",
    }
    for target, source in latest_map.items():
        if series.get(source):
            latest[target] = z.series_latest(series[source])

    charts = data["charts"]
    if rows:
        charts["shfePrice"] = z.seasonal_chart([[x["time"][:10], x["c"]] for x in rows])
    seasonal = {
        "lmePrice": "lme_price", "refinedOutput": "refined_output",
        "concentrateOutput": "concentrate_output", "shfeStock": "shfe_stock",
        "lmeStock": "lme_stock", "socialStock": "social_stock",
        "concentratePortStock": "concentrate_port_stock", "concentrateImport": "concentrate_import",
        "galvanizedRateSeasonal": "galvanized_rate",
        "zincOxideRateSeasonal": "zinc_oxide_rate",
        "dieCastRateSeasonal": "die_cast_rate",
        "galvanizedInventorySeasonal": "galvanized_inventory",
    }
    for chart, source in seasonal.items():
        if series.get(source):
            charts[chart] = z.seasonal_chart(series[source])
    groups = {
        "tc": ({"北方50%Zn国产TC": "tc_north", "南方50%Zn国产TC": "tc_south",
                "进口50%Zn TC": "tc_import"}, 420),
        "downstreamRates": ({"镀锌板卷开工率": "galvanized_rate",
                "氧化锌开工率": "zinc_oxide_rate", "锌合金开工率": "die_cast_rate"}, 300),
        "galvanizedInventory": ({"镀锌板卷社会库存": "galvanized_inventory",
                "钢厂厂内库存": "galvanized_mill_inventory"}, 300),
    }
    for chart, (mapping, limit) in groups.items():
        payload = {label: series.get(source, []) for label, source in mapping.items()}
        if any(payload.values()):
            charts[chart] = z.continuous_chart(payload, limit=limit)
    refined_net_import = z.monthly_difference(
        series.get("refined_import", []), series.get("refined_export", []), scale=0.0001
    )
    if refined_net_import:
        latest["refinedNetImport"] = z.series_latest(refined_net_import)
        charts["refinedNetImport"] = z.seasonal_chart(refined_net_import)
    if series.get("refined_import") or series.get("refined_export"):
        charts["refinedTrade"] = z.continuous_chart({
            "进口": [[day, value / 10000] for day, value in series.get("refined_import", [])],
            "出口": [[day, value / 10000] for day, value in series.get("refined_export", [])],
        }, limit=None)

    previous_signals = {item.get("name"): item for item in data.get("cycleSignals", [])}
    tc_value = z.series_latest(series.get("tc_import", []))[1]
    galvanized_value = z.series_latest(series.get("galvanized_rate", []))[1]
    oxide_value = z.series_latest(series.get("zinc_oxide_rate", []))[1]
    die_cast_value = z.series_latest(series.get("die_cast_rate", []))[1]
    social_percentile = z.calendar_month_percentile(series.get("social_stock", []))
    data["cycleSignals"] = [
        {
            "name": "矿端",
            "state": "极紧" if tc_value is not None and tc_value < 0 else "偏紧" if tc_value is not None and tc_value < 50 else "宽松",
            "detail": f"进口 TC {tc_value:,.1f} 美元/干吨" if tc_value is not None else "TC 暂无有效值",
            "tone": "down" if tc_value is not None and tc_value < 0 else "neutral",
        },
        previous_signals.get("冶炼", {
            "name": "冶炼", "state": "待确认", "detail": "利润模型暂无有效值", "tone": "neutral",
        }),
        {
            "name": "需求",
            "state": "镀锌偏强、其他分化" if galvanized_value is not None and galvanized_value >= 80 else "需求偏弱",
            "detail": f"镀锌 {galvanized_value or 0:.1f}% / 氧化锌 {oxide_value or 0:.1f}% / 合金 {die_cast_value or 0:.1f}%",
            "tone": "up" if galvanized_value is not None and galvanized_value >= 80 else "down",
        },
        {
            "name": "库存",
            "state": "季节性高位" if social_percentile is not None and social_percentile >= 75 else "季节性低位" if social_percentile is not None and social_percentile <= 25 else "季节性中位",
            "detail": f"国内现货库存处于历史同月 {social_percentile:.0f}% 分位" if social_percentile is not None else "历史同月分位待补",
            "tone": "down" if social_percentile is not None and social_percentile >= 75 else "up" if social_percentile is not None and social_percentile <= 25 else "neutral",
        },
    ]

    z.write_data(data)
    print(json.dumps({"liveRefreshedAt": now,
        "seriesUpdated": sum(bool(x) for x in series.values()),
        "quote": quote.get("last"), "klineBars": len(rows)}, ensure_ascii=False))


if __name__ == "__main__":
    main()