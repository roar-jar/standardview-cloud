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


def _post(path, payload, timeout=200):
    req = urllib.request.Request(
        f"{BACKEND}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


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
