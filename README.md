# Standard View — 정적 배포 버전 (Cloudflare Pages)

원본 Standard View는 브라우저가 FastAPI 백엔드를 실시간 호출하는 구조라, 서버 없이는 동작하지 않고 API 키가 필요해 그대로는 정적 호스팅에 올릴 수 없다.

이 저장소는 그 서비스를 **서버 없는 정적 사이트**로 재구성한 버전이다.

- 데이터를 미리 계산해 `public/data/*.json` **스냅샷**으로 저장한다.
- 프론트엔드는 실행 시 그 JSON만 읽는다. (`src/staticApi.js` 가 `/api/*` 호출을 스냅샷으로 응답)
- 백엔드 서버도, 브라우저에 노출되는 API 키도 없다.
- GitHub에 push하면 Cloudflare Pages가 자동 빌드·배포한다.

> 교육용 재구성 버전이며 투자 판단의 근거로 사용하지 않는다.

---

## 구조

```
standardview-cloud/
├─ src/                     프론트엔드 (React + Vite)
│  ├─ staticApi.js          ★ /api/* 요청을 스냅샷 JSON으로 응답하는 인터셉터
│  └─ ...
├─ public/data/            ★ 미리 구운 스냅샷 (git에 커밋됨 = 공개 데이터)
│  ├─ companies.json        검색 대상 기업 목록
│  ├─ analyze/<코드>.json    기업별 재무 분석 결과
│  ├─ opinion/<이름>.json    기업별 AI 재무 의견
│  └─ meta.json             생성 시각·기업 수
├─ scripts/generate_snapshots.py   스냅샷 생성기
└─ vite.config.js
```

현재 스냅샷: 삼성전자 · SK하이닉스 · 카카오 · NAVER · 현대자동차 · LG전자

---

## 로컬 실행

```bash
npm install
npm run dev          # http://localhost:5173 (개발 모드 = 실제 백엔드 사용)
```

정적 동작을 로컬에서 확인하려면 빌드 후 미리보기:

```bash
npm run build
npm run preview      # dist/ 를 정적으로 서빙
# 또는 http://localhost:4173/?static=1 로 접속하면 스냅샷 모드 강제
```

---

## Cloudflare Pages 배포 (GitHub 연동)

1. 이 폴더를 GitHub 저장소로 push 한다.
   ```bash
   git remote add origin https://github.com/<계정>/standardview-cloud.git
   git push -u origin main
   ```
2. [Cloudflare 대시보드](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
3. 방금 push한 저장소를 선택하고 빌드 설정을 입력한다.

   | 항목 | 값 |
   |---|---|
   | Framework preset | Vite |
   | Build command | `npm run build` |
   | Build output directory | `dist` |

4. **Save and Deploy**. 몇 분 뒤 `https://<프로젝트>.pages.dev` 공개 URL이 나온다.
5. 이후 GitHub에 push할 때마다 자동으로 재빌드·재배포된다.

> 환경 변수·시크릿을 넣을 필요가 없다. 정적 배포이므로 API 키는 이 저장소에 존재하지 않는다.

---

## 스냅샷 갱신

데이터를 최신으로 바꾸려면 스냅샷을 다시 굽고 커밋한다. 스냅샷 생성은 **원본 Standard View 백엔드**를 잠깐 띄워두고 그걸 호출하는 방식이다.

```bash
# 1) 원본 백엔드 실행 (DART/네이버 키가 들어간 .env 필요) — 예: 포트 8002
#    (원본 저장소의 backend 를 uvicorn 으로 실행)

# 2) 스냅샷 생성
BACKEND=http://localhost:8002 npm run snapshot          # 재무 + AI 의견까지 (느림)
SKIP_OPINION=1 BACKEND=http://localhost:8002 npm run snapshot   # 재무만 (빠름)

# 3) 커밋 & push → Cloudflare 자동 재배포
git add public/data && git commit -m "chore: 스냅샷 갱신" && git push
```

대상 기업을 바꾸려면 `scripts/generate_snapshots.py` 의 `COMPANIES` 목록을 수정한다.

> **AI 의견(opinion)** 은 원본 백엔드가 로컬 Claude CLI를 호출해 생성한다. CLI가 없는 환경에서는 `SKIP_OPINION=1` 로 재무만 갱신하고, 의견은 CLI가 있는 곳에서 별도로 생성한다.

### (선택) 자동 갱신

GitHub Actions로 주기적 갱신을 붙이려면, 백엔드를 CI에서 잠깐 실행 → `SKIP_OPINION=1` 로 재무 스냅샷 생성 → `public/data` 커밋하는 워크플로우를 추가한다. 이때 DART/네이버 키는 **Actions Secrets** 에만 둔다. (브라우저 번들에는 절대 넣지 않는다.)

---

## 정적 배포에서 빠진 것

기본 범위는 **재무 분석 탭**이다. 산업 인텔리전스·Macro Deal·Deal Memo·인사이트 저장은 실시간 LLM/수집이 필요해 이 정적 버전에서는 비활성화되어 있다(요청 시 "준비 중" 응답). 이 기능들을 정적으로 지원하려면 해당 결과도 스냅샷으로 미리 구워 계약(JSON)에 추가하면 된다 — 강의 64~67회차에서 다루는 확장 지점이다.
