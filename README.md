# DutyCal — 자율학습 감독 편성 시스템

학교 자율학습(야간 자율학습) 감독 교사를 **월 단위로 자동 편성**하고, **월간 달력**에서 확인·수정하며,
**교사별·학년별 감독 누계와 공정성**을 관리하는 웹 서비스입니다.

```
기본 정보 설정 → 자동 편성(미리보기) → 확정 → 달력에서 교체·변경 → 누계·공정성 확인 → 월 마감 → 인쇄
```

> 개발 진행 상황: Phase 1~5 완료. Phase 6(Docker 배포·백업/복원)은 진행 예정입니다.
> 전체 요구사항은 [REQUIREMENTS.md](REQUIREMENTS.md)를 참고하세요.

---

## 주요 기능

**자동 편성**
- 월 × 학년 단위로 하루 학년별 1명씩 배정합니다.
- 공정성 기준: 누계가 적은 교사를 먼저 뽑고, 누계가 같으면 순번대로 돌아갑니다. 월~목 그룹과 금요일 그룹은 따로 관리합니다.
- 제약: 방과후 요일, 감독 불가일, 학년·금요일 감독 가능 여부, 같은 날 두 학년 중복 금지를 지킵니다.
- 미리보기(DRAFT) → 확정 → 마감 단계로 진행하고, 기간을 지정한 부분 재편성과 🔒 고정 셀을 지원합니다.

**월간 달력**
- 변경된 셀은 노란색 ↻, 고정 셀은 🔒, 미배정 칸은 빨간 테두리, 미리보기는 점선으로 표시합니다.
- 교사별 이번 달·누계 현황 패널과 공정성 지표를 함께 보여 줍니다.
- 미배정 칸에는 학년부장이 교사를 직접 지정할 수 있습니다.

**본인 감독 교체**
- 모든 교사가 본인 감독을 **넘기기** 또는 **맞교환**할 수 있습니다. 학년 구분이 없고 동의 없이 즉시 반영됩니다.
- 방과후·불가일 같은 사유는 경고만 표시하고, 같은 날 두 학년을 감독하게 되는 경우만 막습니다.
- 교체되면 상대 교사와 학년부장에게 앱 내 알림(🔔)이 갑니다.

**특별 일정**
- 공휴일·시험·행사 등을 **학년 단위**로 등록합니다. 예: 2학년 수학여행일에는 1·3학년만 편성합니다.

**통계·이력·출력**
- 학기 프리셋 또는 직접 고른 기간으로 통계를 봅니다.
- 변경 이력을 조회할 수 있습니다. 조회 범위는 권한별로 다릅니다.
- **A4 가로 1페이지 인쇄**를 지원합니다.

**감독표 배포 API**
- 학교 홈페이지 등 외부 시스템이 월별 감독표를 JSON으로 받아 갈 수 있습니다.
- 관리자가 발급한 **API 연동 계정(조회 전용 키)** 으로 호출합니다.

### 역할과 권한

| 역할 | 할 수 있는 일 |
|---|---|
| 관리자 (ADMIN) | 교사·특별 일정·학년부장 지정, API 연동 계정 등 전체 설정, 모든 학년 편성·마감 해제 |
| 학년부장 | 담당 학년의 편성·확정·재편성·마감, 담당 학년 셀 변경·고정·미배정 칸 지정 |
| 일반 교사 | 감독표·통계 조회, 본인 감독 교체, 본인 감독 불가일·방과후 요일 등록 |

모든 권한 검사는 서버에서 합니다.

---

## 기술 스택

| 영역 | 사용 기술 |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS (달력 그리드 직접 구현) |
| Backend | Node.js, Express 4, TypeScript (ESM) |
| DB | SQLite + Prisma ORM |
| 인증 | 교사별 개인 PIN (bcrypt) + express-session (httpOnly 쿠키) |
| 테스트 | Vitest + Supertest (서버) |

---

## 시작하기 (개발 환경, Windows PowerShell 기준)

### 1. 준비물
- **Node.js 20 이상** (22 권장)
- Git

### 2. 설치

```powershell
git clone https://github.com/nerhwida/DSMDutyCal.git
cd DSMDutyCal
npm install
```

> **사내망·학교망에서 `npm install`이나 Prisma 명령이 `self-signed certificate in certificate chain` 오류로 실패하면**
> 네트워크가 TLS를 가로채는 환경입니다. 같은 PowerShell 창에서 아래를 먼저 실행한 뒤 다시 시도하세요.
> ```powershell
> $env:NODE_OPTIONS = "--use-system-ca"
> ```

### 3. 환경 변수 설정

`.env.example`을 복사해 **루트와 `server/` 두 곳**에 `.env`를 만듭니다. Prisma CLI는 `server/`의 `.env`를 읽습니다.

```powershell
Copy-Item .env.example .env
Copy-Item .env.example server\.env
```

| 변수 | 설명 | 기본값 |
|---|---|---|
| `PORT` | API 서버 포트 | `4000` |
| `CLIENT_ORIGIN` | 프론트엔드 주소 (CORS 허용) | `http://localhost:5173` |
| `DATABASE_URL` | SQLite 파일 경로 (`server/prisma/` 기준) | `file:./dev.db` |
| `SESSION_SECRET` | 세션 서명 키 — **반드시 긴 임의 문자열로 변경** | |
| `SESSION_HOURS` | 로그인 유지 시간 | `8` |
| `ADMIN_NAME` / `ADMIN_INITIAL_PIN` | 최초 실행 시 자동 생성되는 관리자 계정 | `관리자` / `0000` |
| `LOGIN_MAX_ATTEMPTS` / `LOGIN_LOCKOUT_MINUTES` | 로그인 실패 잠금 정책 | `5` / `5` |

`SESSION_SECRET`용 임의 문자열은 다음 명령으로 만들 수 있습니다.

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

### 4. 데이터베이스 준비

```powershell
cd server
npx prisma migrate deploy   # 스키마 적용 (dev.db 생성)
npx prisma generate         # Prisma 클라이언트 생성
npm run prisma:seed         # (선택) 샘플 교사 15명·학년부장 3명·2026년 공휴일
cd ..
```

> 샘플 교사 이름은 모두 가상이며 초기 PIN은 `1234`입니다(최초 로그인 시 변경). 실제 운영에서는 시드 없이
> 관리자 계정으로 로그인해 교사를 직접 등록하세요.

### 5. 실행

```powershell
npm run dev
```

- 웹: http://localhost:5173
- API: http://localhost:4000

관리자 계정(`ADMIN_NAME` / `ADMIN_INITIAL_PIN`)으로 로그인합니다.

---

## 자주 쓰는 명령

```powershell
npm run dev            # 서버(:4000) + 클라이언트(:5173) 동시 실행
npm run dev:server     # 서버만
npm run dev:client     # 클라이언트만
npm run build          # 서버 tsc 빌드 → 클라이언트 vite 빌드
npm run test           # 서버 테스트 (테스트 전용 DB 사용, dev.db는 건드리지 않음)
```

특정 테스트만 실행하기 (`server/`에서):

```powershell
npx vitest run src/scheduler/engine.test.ts
npx vitest run -t "맞교환"
```

> **Windows 참고:** 개발 서버가 실행 중이면 Prisma 엔진 파일이 잠겨 `prisma generate`가 `EPERM`으로 실패합니다.
> 스키마를 바꿀 때는 개발 서버를 멈춘 뒤 실행하세요.

---

## 초기 설정 순서 (관리자)

1. **교사 관리**: 교사를 등록하고 초기 PIN을 발급합니다. 교사는 최초 로그인 때 PIN을 바꿔야 합니다.
2. **학년부장 지정**: 1·2·3학년 부장을 정합니다.
3. **감독 가능 학년·금요일 감독 여부·방과후 요일**을 설정하고, 학년별 순번을 드래그로 정합니다(월~목·금요일 각각).
4. **일정 관리**: 해당 연도 공휴일을 불러오고, 시험·행사 등 특별 일정을 등록합니다(감독 제외 학년 선택).
5. **초기 누계**: 서비스 도입 전 감독 횟수를 입력합니다(공정성 계산에 반영).
6. 학년부장이 **월간 달력**에서 자동 편성 → 확인 → 확정합니다.

---

## 감독표 배포 API

외부 시스템에서 월별·날짜별 1·2·3학년 감독 교사를 JSON으로 받아 갈 수 있습니다.

1. 관리자가 **API 연동** 탭에서 연동 계정을 만들면 `dcf_…` 키가 **한 번만** 표시됩니다.
2. 요청 헤더에 키를 넣어 호출합니다.

```http
GET /api/public/duty/2026/10
X-API-Key: dcf_xxxxxxxxxxxxxxxx
```

```json
{
  "year": 2026,
  "month": 10,
  "grades": [{ "grade": 1, "status": "CONFIRMED", "published": true }, "..."],
  "days": [
    { "date": "2026-10-01", "weekday": "목", "type": "OPERATING",
      "duty": { "1": { "teacherId": 3, "name": "김○○" }, "2": null, "3": null } },
    { "date": "2026-10-14", "weekday": "수", "type": "OPERATING",
      "specialDays": [{ "grade": 2, "type": "EVENT", "title": "2학년 수학여행" }],
      "duty": { "1": { "teacherId": 5, "name": "이○○" }, "2": null, "3": { "teacherId": 9, "name": "박○○" } } },
    { "date": "2026-10-09", "weekday": "금", "type": "SPECIAL",
      "specialDays": [{ "grade": 1, "type": "HOLIDAY", "title": "한글날" }, "..."] }
  ]
}
```

- **확정·마감된 학년만 공개**하고, 미리보기(편성 중) 학년은 `null`입니다.
- `type`: `WEEKEND`(주말) · `SPECIAL`(전 학년 특별 일정) · `OPERATING`(한 학년 이상 운영)
- 연동 계정 키로는 이 API만 호출할 수 있습니다. 다른 API는 `403`이고, 앱 로그인도 할 수 없습니다.
- CORS가 앱 주소만 허용하므로 **서버 간 호출** 용도입니다.

---

## 프로젝트 구조

```
DSMDutyCal/
├─ client/                  # React 프론트엔드
│  └─ src/
│     ├─ pages/             # 달력·내 감독·통계·이력·교사/일정 관리 등 화면
│     ├─ components/        # 팝오버(교체·관리 변경·미배정 지정·재편성), 현황 패널, 알림
│     └─ lib/date.ts        # 'YYYY-MM-DD' 문자열 날짜 유틸
├─ server/                  # Express API
│  ├─ prisma/               # schema.prisma, 마이그레이션, seed.ts
│  └─ src/
│     ├─ scheduler/         # 자동 편성 엔진 (DB 없는 순수 함수 + 단위 테스트)
│     ├─ services/          # DB 연동 로직 (편성·배정 변경·통계·이력·배포)
│     ├─ routes/            # REST API + 통합 테스트
│     ├─ permissions/       # 권한 미들웨어
│     └─ auth/              # PIN 로그인·세션
├─ REQUIREMENTS.md          # 요구사항 명세 (개정 이력 포함)
└─ CLAUDE.md                # 개발 가이드 (설계 결정·주의사항)
```

---

## 운영 시 보안 체크리스트

이 저장소는 공개되어 있으므로 기본값이 모두에게 알려져 있습니다. 운영 서버에서는 반드시 다음을 확인하세요.

- [ ] `SESSION_SECRET`을 긴 임의 문자열로 바꿨다.
- [ ] `ADMIN_INITIAL_PIN`을 `0000`이 아닌 값으로 바꿨고, 최초 로그인 후 관리자 PIN을 다시 변경했다.
- [ ] `.env`와 DB 파일(`*.db`)이 저장소에 올라가지 않는다(`.gitignore`에 포함됨).
- [ ] HTTPS로 서비스한다면 `server/src/auth/session.ts`의 쿠키 `secure` 옵션을 `true`로 바꿨다.
- [ ] 샘플 시드(`npm run prisma:seed`)를 운영 DB에 실행하지 않았다.

> 현재 세션은 서버 메모리에 저장되므로, 서버를 재시작하면 모든 사용자가 다시 로그인해야 합니다.

---

## 배포 (Phase 6 예정)

Docker(단일 컨테이너 + SQLite 볼륨), `docker-compose`, 관리자 화면의 DB 백업/복원 기능을 준비 중입니다.
완료되면 이 절에 설치·운영 방법을 추가합니다.

---

## 문서

- [REQUIREMENTS.md](REQUIREMENTS.md) — 기능·데이터 모델·API·권한 매트릭스 전체 명세와 개정 이력
- [CLAUDE.md](CLAUDE.md) — 개발 시 알아야 할 설계 결정과 주의사항
