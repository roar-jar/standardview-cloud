#!/usr/bin/env python3
"""
정적 배포용 스냅샷 생성기.

실행 중인 Standard View 백엔드(기본 http://localhost:8002)를 호출해
지정한 기업들의 검색/분석/AI의견 결과를 public/data 아래 JSON으로 굽는다.
GitHub Actions에서는 백엔드를 잠깐 띄운 뒤 이 스크립트를 실행하는 방식으로 확장한다.

사용:
    python scripts/generate_snapshots.py               # 기본 목록
    BACKEND=http://localhost:8002 python scripts/generate_snapshots.py
    SKIP_OPINION=1 python scripts/generate_snapshots.py # AI 의견 생략(빠름)
"""
import json
import os
import sys
import time
import urllib.request

BACKEND = os.environ.get("BACKEND", "http://localhost:8002")
SKIP_OPINION = os.environ.get("SKIP_OPINION", "") == "1"
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", "public", "data"))

# 스냅샷을 구울 기업 목록 (교육용 대표 종목)
COMPANIES = [
    "삼성전자", "SK하이닉스", "카카오", "NAVER", "현대자동차", "LG전자",
]

# 산업 인텔리전스: 미리 구울 섹터 목록
SECTORS = ["반도체", "2차전지", "AI", "바이오텍", "자동차"]

# 산업 인텔리전스: 기업별 산업동향을 구울 대상 (재무 목록과 동일)
INDUSTRY_COMPANIES = ["삼성전자", "SK하이닉스", "카카오", "NAVER", "현대자동차", "LG전자"]


def _post(path, payload, timeout=200):
    req = urllib.request.Request(
        f"{BACKEND}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _get(path, timeout=60):
    with urllib.request.urlopen(f"{BACKEND}{path}", timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _save(rel_path, obj):
    full = os.path.join(DATA, rel_path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)


def gen_industry():
    """산업 인텔리전스 스냅샷: 섹터별 분석 + 기업별 산업동향."""
    if SKIP_OPINION:
        return
    for sec in SECTORS:
        print(f"[산업-섹터] {sec} (뉴스+AI, ~2분)", flush=True)
        try:
            r = _post("/api/industry-analysis",
                      {"industry": sec, "text_input": "", "scope": "domestic"})
            _save(os.path.join("industry", "sector", f"{sec}.json"), r)
        except Exception as e:
            print(f"  실패(무시): {e}", flush=True)
    for name in INDUSTRY_COMPANIES:
        print(f"[산업-기업] {name} (뉴스+AI, ~2분)", flush=True)
        try:
            r = _post("/api/company-industry-trends",
                      {"corp_name": name, "industry": "", "text_input": "", "scope": "domestic"})
            _save(os.path.join("industry", "company", f"{name}.json"), r)
        except Exception as e:
            print(f"  실패(무시): {e}", flush=True)


def gen_macro():
    """매크로 스냅샷: 지표 카탈로그+값, 종합 분석, 뉴스 브리프."""
    print("[매크로] indicators", flush=True)
    try:
        _save(os.path.join("macro", "indicators.json"), _get("/api/macro/indicators"))
    except Exception as e:
        print(f"  indicators 실패(무시): {e}", flush=True)
    if SKIP_OPINION:
        return
    print("[매크로] analyze (AI, ~2분)", flush=True)
    try:
        r = _post("/api/macro/analyze",
                  {"scope": "domestic", "selected_indicators": [],
                   "sector": "", "company_name": "",
                   "use_default_if_empty": True, "force_refresh": False})
        _save(os.path.join("macro", "analyze.json"), r)
    except Exception as e:
        print(f"  analyze 실패(무시): {e}", flush=True)
    print("[매크로] news-brief (AI, ~2분)", flush=True)
    try:
        r = _post("/api/macro/news-brief", {"scope": "domestic"})
        _save(os.path.join("macro", "news-brief.json"), r)
    except Exception as e:
        print(f"  news-brief 실패(무시): {e}", flush=True)


def pick_listed(results, name):
    """검색 결과 중 상장(종목코드 보유) + 이름이 가장 근접한 항목."""
    listed = [r for r in results if r.get("stock_code")]
    exact = [r for r in listed if r.get("corp_name") == name]
    if exact:
        return exact[0]
    if listed:
        return listed[0]
    return results[0] if results else None


def main():
    os.makedirs(os.path.join(DATA, "analyze"), exist_ok=True)
    os.makedirs(os.path.join(DATA, "opinion"), exist_ok=True)

    companies_index = []
    for name in COMPANIES:
        print(f"[검색] {name}", flush=True)
        try:
            sr = _post("/api/search", {"query": name})
        except Exception as e:
            print(f"  검색 실패: {e}", flush=True)
            continue
        corp = pick_listed(sr.get("results", []), name)
        if not corp:
            print(f"  결과 없음", flush=True)
            continue
        code = corp["corp_code"]
        companies_index.append({
            "corp_name": corp["corp_name"],
            "corp_code": code,
            "stock_code": corp.get("stock_code", ""),
        })

        print(f"[분석] {corp['corp_name']} ({code})", flush=True)
        try:
            ar = _post("/api/analyze-multi", {"corps": [corp, None, None]})
        except Exception as e:
            print(f"  분석 실패: {e}", flush=True)
            continue
        # 엑셀 파일명은 정적 배포에서 무의미하므로 제거
        ar.pop("filename", None)
        with open(os.path.join(DATA, "analyze", f"{code}.json"), "w", encoding="utf-8") as f:
            json.dump(ar, f, ensure_ascii=False)

        if SKIP_OPINION:
            continue
        yearly0 = (ar.get("yearly") or [{}])[0]
        if not yearly0:
            print("  재무 없음 — 의견 생략", flush=True)
            continue
        print(f"[의견] {corp['corp_name']} (Claude, 최대 ~2분)", flush=True)
        try:
            op = _post("/api/opinion",
                       {"corp_name": corp["corp_name"], "yearly": yearly0},
                       timeout=200)
            with open(os.path.join(DATA, "opinion", f"{corp['corp_name']}.json"),
                      "w", encoding="utf-8") as f:
                json.dump(op, f, ensure_ascii=False)
        except Exception as e:
            print(f"  의견 실패(무시): {e}", flush=True)
        time.sleep(1)

    # 산업 인텔리전스 · 매크로 스냅샷
    gen_industry()
    gen_macro()

    with open(os.path.join(DATA, "companies.json"), "w", encoding="utf-8") as f:
        json.dump(companies_index, f, ensure_ascii=False, indent=2)

    meta = {
        "generated_at": os.environ.get("GENERATED_AT", ""),
        "count": len(companies_index),
        "companies": [c["corp_name"] for c in companies_index],
    }
    with open(os.path.join(DATA, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(f"\n완료: {len(companies_index)}개 기업 → {DATA}", flush=True)


if __name__ == "__main__":
    sys.exit(main())
