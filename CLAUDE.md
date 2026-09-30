# CLAUDE.md

이 파일은 이 저장소에서 작업하는 Claude Code(claude.ai/code)를 위한 안내서다.

## 프로젝트 개요

DutyCal — 학교 자율학습 감독 편성 시스템. 전체 명세는 `REQUIREMENTS.md`(한국어)에 있으며, 새 기능을
구현하기 전에 반드시 읽는다. 개발은 명세에 정의된 단계(Phase 1–6)로 진행하며, 단계마다 완료 기준이 있다.
현재 다음 단계까지 완료되었다.
- Phase 1: 인증·권한 기반
- Phase 2: 교사·일정 관리
- Phase 3: 스케줄러 엔진, 편성·확정·달력 조회 API
- Phase 4: 달력 UI, F6 관리 변경, F1-2 넘기기·맞교환, F1-3 내 감독 화면, 알림
- Phase 5: 기간 통계, 월 마감·해제, 인쇄, 변경 이력, 부분 재편성
- Phase 6: Docker 배포, 백업/복원(F11), 로그인 세션 DB 저장 — 개발 PC에 Docker가 없어 실제
  `docker compose up`은 배포 서버에서 확인한다 (아래 "배포·백업" 참고)

git 저장소: https://github.com/nerhwida/DSMDutyCal (공개). 커밋 작성자는 저장소 로컬 설정
`DSM DutyCal <280956040+nerhwida@users.noreply.github.com>`을 쓴다 (학교 이메일 노출 방지).
git은 PATH에 없을 수 있으니 `C:\Program Files\Git\cmd\git.exe`로 실행한다. 커밋은 기능 단위로 나누고
`feat:`/`fix:`/`test:`/`docs:` 접두어를 쓴다.

**프로젝트 오너가 결정한 범위 변경** (REQUIREMENTS.md "개정 이력"에 반영됨. 다시 추가하지 말 것):
- Excel 출력 없음 (F9 Excel과 `exceljs` 의존성 제외).
- 인쇄물에 결재란 없음.
- 외부 알림 없음 (카카오톡·이메일·웹 푸시). 앱 내 알림만 사용.
- 부분 재편성은 알림을 보내지 않는다.
- 특별 일정은 날짜 × 학년 단위다 (아래 "특별 일정은 학년 단위" 참고).

## 명령어

저장소 루트에서 실행한다 (npm workspaces: `client`, `server`).

```powershell
npm install              # 두 워크스페이스 모두 설치
npm run dev               # concurrently로 서버(:4000) + 클라이언트(:5173) 동시 실행
npm run dev:server        # 서버만 (tsx watch)
npm run dev:client        # 클라이언트만 (vite)
npm run build              # 서버 tsc 빌드 후 클라이언트 vite 빌드
npm run test               # 서버 테스트(vitest) 실행 — 클라이언트 테스트는 아직 없음
```

서버 전용 명령 (`server/` 안에서 실행하거나 `npm run <script> -w server`로 실행):

```powershell
npm run test -w server              # 전체 테스트
npx vitest run src/routes/auth.routes.test.ts   # 파일 하나만
npx vitest run -t "이름"             # 테스트 이름으로 필터
npm run prisma:migrate -- --name <name>   # 마이그레이션 생성 + 적용 (루트가 아니라 server/에서 실행)
npm run prisma:seed                 # dev.db에 prisma/seed.ts 다시 실행
```

### Windows/네트워크 주의: Prisma CLI + TLS 가로채기

이 PC의 네트워크는 TLS를 가로챈다. 그래서 OS 신뢰 저장소는 인증서를 받아들이는데도, Node에 내장된
CA 저장소는 Prisma 엔진 바이너리 다운로드를 거부한다(`self-signed certificate in certificate chain`).
**Prisma CLI**를 호출하는 명령은 모두 Node가 시스템 CA 저장소를 쓰도록 해야 한다. 해당 명령은
`prisma generate`, `prisma migrate dev`, `prisma db push`, 그리고 `prisma generate` postinstall을
새로 일으키는 `npm install`이다.

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
```

프로세스 단위 환경 변수라 PowerShell 도구 호출 사이에 유지되지 않는다. Prisma CLI를 호출할 때마다
먼저 설정한다. `npm run dev`, `npm run test` 등 이미 생성된 `@prisma/client`만 쓰는 작업에는
**필요 없다** (네트워크를 쓰지 않음).

또한 Prisma CLI는 저장소 루트가 아니라 자기 작업 디렉터리의 `.env`를 읽는다. `server/`에서
`prisma migrate`/`db push`를 실행할 때 `DATABASE_URL`을 찾을 수 있도록 `server/.env`(gitignore 대상,
루트 `.env`의 복사본)를 따로 둔다. 환경 변수가 바뀌면 두 파일을 함께 맞춘다.

**Windows 파일 잠금:** 개발 서버(`npm run dev`)가 실행 중이면 Prisma 엔진 DLL이 잠겨 `prisma generate`가
`EPERM`으로 실패한다. 스키마를 바꿀 때는 개발 서버를 멈춘 뒤 `prisma migrate deploy` → `prisma generate`를
실행하고 서버를 다시 띄운다. `migrate dev --create-only`로 SQL을 먼저 만들어 검토해도 된다.

## 아키텍처

### 모노레포 구성
- `client/` — React + Vite + TypeScript + Tailwind.
  - 라우터 라이브러리가 없다. `Home.tsx`에서 `useState` 탭으로 화면을 바꾸며, `AuthContext`에서
    계산한 권한으로 탭 노출을 정한다.
  - 일반 교사는 `MyDutyPage`(F1-3)로, 학년부장·ADMIN은 `CalendarPage`로 진입한다.
  - 달력 그리드는 직접 구현했다 (명세상 FullCalendar 등 사용 금지).
  - 셀 팝오버(`components/Popover.tsx`)는 역할에 따라 나뉜다. 본인의 CONFIRMED 셀은
    `SwapPopover`(F1-2), 담당 학년 셀은 `ManagePopover`(F6), 그 외는 읽기 전용이다.
  - 클라이언트 테스트는 아직 없다.
- `server/` — Express + TypeScript (ESM, `NodeNext` 모듈 해석). 소스가 `.ts`여도 상대 경로 import에는
  모두 `.js` 확장자를 명시해야 한다.
- `server/prisma/schema.prisma` — 데이터 모델의 단일 기준 (REQUIREMENTS.md §4 반영).
  - **SQLite는 Prisma 네이티브 `enum`을 지원하지 않는다.** 그래서 enum 성격의 컬럼(`role`,
    `rotationGroup`, `status`, `type` 등)은 모두 일반 `String` 컬럼이다.
  - 허용 값은 `server/src/lib/enums.ts`에 두고, API 경계에서 `server/src/lib/validation.ts`의 zod
    스키마로 검증한다.
  - enum 성격의 필드를 새로 추가할 때도 Prisma `enum` 대신 이 방식을 따른다.

### 인증·권한 모델
"역할" enum을 저장하지 않는다. 교사의 실제 권한은 요청 시점에 다음에서 계산한다.
- `Teacher.isAdmin` — 시스템 관리자.
- `GradeHead` 테이블 (학년 → teacherId, 학년당 1행) — 학년별 부장.
- REQUIREMENTS.md 가정 13에 따라 **ADMIN은 세 학년 모두의 학년부장 권한을 가진다.**
  - 이 규칙은 `loadAuthenticatedUser()`(`server/src/auth/authService.ts`)에 들어 있다. ADMIN이면
    `gradeHeadOf: [1,2,3]`, 아니면 실제 `GradeHead` 행을 반환한다.
  - 그래서 학년 범위 권한 검사에서 `isAdmin`을 따로 처리하지 않고 `gradeHeadOf.includes(grade)`만
    확인해도 일관되게 동작한다.
- 조합 가능한 권한 검사는 `server/src/permissions/middleware.ts`에 있다.
  - `requireAuth`(`req.user` 로드, 반드시 가장 먼저) → `requireAdmin`, `requireGradeScope(gradeGetter)`,
    `requireSelfOrAdmin(teacherIdGetter)`, `requireOwnAssignment(assignmentIdGetter)`.
  - 라우트에서 이들을 직접 조합한다. 예를 들어 `PUT /api/teachers/:id/grades`는 대상 학년을 URL이
    아니라 요청 *본문*에서 읽으므로, 그곳의 `requireGradeScope`는 본문을 다시 파싱한다
    (`server/src/routes/teachers.routes.ts` 참고).
- 모든 권한 검사는 서버에서만 한다. 클라이언트의 어떤 것도 보안 경계로 취급하지 않는다.
- **가정 8("비로그인 접근 없음")의 의도적 예외 하나**가 있다 (프로젝트 오너 승인).
  - `GET /api/public/duty/:year/:month`(`routes/public.routes.ts`)는 외부 시스템용 월별·날짜별 감독표
    피드다.
  - 일반 로그인 세션, 또는 **API 연동 계정**(`ApiClient` 모델, `requireApiClientOrSession`)의 헤더
    `X-API-Key`로 호출할 수 있다.
  - CONFIRMED/CLOSED 학년만 공개하고 DRAFT는 절대 내보내지 않는다.
  - CORS는 여전히 `CLIENT_ORIGIN`만 허용하므로 서버 간 호출용이다.
  - API 연동 계정은 ADMIN이 관리한다 (`/api/api-clients`, 'API 연동' 탭).
    - 키 형식은 `dcf_<base64url>`이다.
    - SHA-256 해시와 표시용 앞 8글자만 저장하고, 원문은 생성·재발급 시 한 번만 반환한다.
    - 비활성화·재발급·삭제는 즉시 적용된다.
    - 공용 `.env` 키는 더 이상 없다.
  - `restrictApiKeyToPublic`(`app.ts`의 전역 미들웨어)은 `/api/public/*` 밖에서 `X-API-Key`가 붙은
    요청을 유효한 세션이 있어도 403으로 막는다. 연동 계정이 조회 전용인 이유가 이것이다.
    외부용 엔드포인트를 추가하려면 `/api/public/` 아래에 둔다.

### 특별 일정은 학년 단위
처음 명세의 `SpecialDay`는 날짜당 1행(전 학년 공통)이었다. 프로젝트 오너 요청으로 **(날짜, 학년) 단위**로
바꿨고, REQUIREMENTS.md §4에도 반영했다 (마이그레이션 `special_day_per_grade`, `@@unique([date, grade])`). 예: 2학년 수학여행이면 2학년만
그날 편성에서 빠지고, 1학년만 편성하거나 1·3학년만 편성하는 날도 만들 수 있다.
- 전 학년 일정은 학년별 3행이다. 공휴일 시드와 `seed.ts`도 3행을 만든다. 마이그레이션은 기존 행을
  3개 학년으로 복제하도록 SQL을 직접 고쳤다.
- 한 날짜에 학년마다 다른 일정을 둘 수 있다 (2학년 수학여행 + 3학년 모의고사).
- `POST /api/special-days`는 `grades`를 받는다 (생략 시 전 학년). 기존 배정 충돌·마감 검사도 해당 학년만
  본다. 화면의 "일정 1건"은 여러 행이므로 삭제는 `DELETE /api/special-days?ids=`를 쓴다.
- 엔진·서비스에서 운영일은 **학년별**로 판단한다. `operatingDays(year, month, specialDays, grade?)`는
  grade를 주면 그 학년의 운영일, 생략하면 한 학년이라도 운영하는 날을 돌려준다. 엔진 입력
  `specialDays`는 `{ date, grade }[]`이다.
- 월 조회 응답의 `operatingDays[].grades`는 그날 편성하는 학년이다. `specialDays[]`에는 `grade`가 있다.
  달력은 전 학년 일정이면 셀 상단 라벨로, 일부 학년이면 해당 학년 줄에 일정명을 표시한다.
- 배포 피드(`/api/public/duty`)의 형식이 바뀌었다. 날마다 `specialDays: [{grade, type, title}]`(있을 때만)를
  준다. `type`은 전 학년 제외면 `SPECIAL`, 일부만 제외면 `OPERATING`이며 제외 학년의 `duty`는 null이다.
  (이전 `specialDay` 단일 객체는 없어졌다.)
  방과후 운영일이면 `afterSchoolGrades: [..]`(자습 감독 학년)도 주고, 나머지 학년 `duty`는 null이다.

### 일정 관리 권한과 방과후 운영일 (2026-09-30)
- 특별 일정과 방과후 운영일은 **ADMIN + 학년부장(모든 학년)** 이 관리한다 (`requireScheduleManager` =
  `gradeHeadOf.length > 0`). 원래 명세는 ADMIN 전용이었는데 오너 요청으로 바꿨다.
- 특별 일정 수정은 화면의 "일정 1건"(같은 날짜·유형·일정명 묶음) 단위로 한다: `PUT /api/special-days/group`
  (`/:id`보다 먼저 등록해야 한다). 등록과 수정은 `saveSpecialDays()`를 함께 쓴다. 이 함수가 충돌 경고, 마감 월
  차단, 기존 행 교체를 한 트랜잭션으로 처리한다.
- **방과후 운영일**(`AfterSchoolDay`, **날짜 × 학년**, 마이그레이션 `after_school_day_per_grade`에서 기존 행을 3개 학년으로 복제)
  - 학년 = 방과후 시간에 자습하는 학년 (오너 설명). **그날은 지정한 학년만 편성**하고, 지정하지 않은 학년은 특별 일정처럼
    편성 제외다. 지정한 학년 감독은 방과후 수업이 없는 교사가 맡는다.
  - 편성 제외 계산은 `gradeExclusions(specialDays, afterSchoolDays)`(`scheduler/operatingDays.ts`)로 한곳에서 한다. 엔진은 입력의
    두 목록으로 직접 계산하고, 서비스는 `gradeExclusionsBetween()`을 쓴다(`getMonthView`, `assertFillableCell`). 배포 피드는
    `afterSchoolGrades`를 내보내고 나머지 학년 duty를 null로 둔다. 운영일 판단을 새로 추가하는 곳도 이 함수를 써야 한다.
  - 교사의 `AFTER_SCHOOL` 요일 제외는 `ScheduleContext.afterSchoolDay`가 true인 (날짜, 학년)에만 적용된다. `OTHER`는 항상 적용된다.
  - 엔진 입력 `afterSchoolDays`는 `{ date, grade }[]`, API·월 조회 응답은 날짜별 `{ date, grades }`이다.
  - 등록(`POST`)·날짜별 지정(`PUT /:date`)은 `applyCells()`를 거친다. 바뀌는 날짜의 저장 후 지정 학년 기준으로 맞지 않는 배정
    (지정 안 한 학년 배정, 지정 학년의 방과후 요일 교사 배정)이 있으면 409 `{ warning, conflictingAssignments }` → `confirmRemoveAssignments`면 `removeAssignmentsTx()`로
    배정을 취소한다. 마감 월이면 확인해도 409. 삭제(`DELETE`)는 배정을 건드리지 않는다.
  - 따라서 **운영일이 하나도 없으면 방과후 교사도 모든 날 배정된다.** 운영 전에 운영일을 등록해야 한다.
  - `ScheduleContext`를 만드는 곳은 모두 운영일 여부를 넣어야 한다: 엔진, `assignmentService.evaluateTeachers`,
    `getMonthView`의 미배정 사유. 필수 필드라 tsc가 알려 준다.
- **의무귀가**는 일정 관리의 별도 영역(`MandatoryHomeSection`)에서 등록한다. 저장은 특별 일정 `MANDATORY_HOME` 그대로이고,
  `POST /api/special-days`에 `weekdaysOnly: true`를 보내 기간 안의 평일만 만든다. 특별 일정 목록·유형 선택에서는 빠진다.

### 순번 모델 (중요하고 드러나지 않는 설계 결정)
REQUIREMENTS.md의 데이터 모델(§4)에는 `Teacher.sortOrder` 하나만 있다. 그런데 §5(F2)는
**학년 × 순환 그룹**(월~목 / 금요일)별로 독립적인 드래그 앤 드롭 순번을 요구하고, §3 가정 5는
독립 순환 큐 6개(3개 학년 × 2개 그룹)를 말한다.

실제로 모호한 부분이었고, 프로젝트 오너와 함께 이렇게 해결했다.
- `weekdayOrder`/`fridayOrder`를 `Teacher`가 아니라 `TeacherGrade`에 직접 추가했다. 그래서
  (교사, 학년) 행마다 월~목 큐와 금요일 큐의 위치를 각각 가진다.
- `PUT /api/grades/:grade/order`는 두 필드 중 하나를 한 번에 재정렬한다.
- 스케줄러 엔진은 §6.3에 따라 이 순서를 **가장 먼저** 본다 (순번 우선, 아래 참고).

### 스케줄러 엔진 (Phase 3)
- `server/src/scheduler/`는 **순수** 모듈이다 (Prisma import 없음).
  - `generateSchedule(input)` → `{ assignments, warnings, fairness }`.
  - Hard Rule은 `rules.ts`에 `HardRule` 객체로 있다. 새 제약은 엔진을 고치지 말고
    `DEFAULT_HARD_RULES`에 규칙을 추가한다.
  - 규칙의 `reason` 문자열은 사용자에게 그대로 보이므로(F6 팝오버에서 재사용) 한국어로 유지한다.
- `server/src/services/schedulerService.ts`가 DB와 연결되는 유일한 곳이다.
  - 엔진 입력을 만들고 결과를 저장한다.
  - MonthPlan 상태 전환을 처리한다. `generate`는 EMPTY/DRAFT → DRAFT(DRAFT는 덮어씀),
    `confirm`은 DRAFT → CONFIRMED.
  - 라우트는 `routes/months.routes.ts`에 있다.
- 명세에 없어 프로젝트 오너와 정한 사항:
  - **순환 포인터는 월을 넘어 이어진다.** 해당 학년 × 그룹의 마지막 CONFIRMED/CLOSED 배정 다음에서
    시작하고, 없으면 순번 맨 앞에서 시작한다. 포인터는 새로 편성해 선택할 때만 움직인다.
  - **누계** = InitialCount + 이전 CONFIRMED/CLOSED 배정 수(실제 `teacherId` 기준) + 이번 달 편성 중
    누적분(유지 셀 포함).
  - **선택 기준은 순번 우선이다** (오너 결정, 2026-09-30. 원래 명세는 누계 우선). `selection.ts`:
    직전 운영일 옵션 → 포인터 다음 순번 거리 → 누계 → id. 순번이 전순서라 누계는 사실상 쓰이지 않는다.
    자동 편성은 드래그로 정한 순서를 채우는 편의 기능이고, 누계·공정성 지표는 참고용 표시다.
  - **"직전 운영일 감독자 후순위"**는 `options.avoidPreviousDay`이고 기본은 **꺼짐**이다.
    순번 기준보다 앞에 적용한다. 순번 다음에 두면 아무 효과가 없기 때문이다.
  - **미배정 셀은 행으로 저장하지 않는다** (`Assignment.teacherId`는 non-null). "EMPTY가 아닌 월에서
    배정이 없는 운영일"로 계산하며, generate는 사유를 `warnings`로 돌려준다.
  - 엔진은 부분 재편성(`input.dates`)을 지원한다. `regenerate` API는 Phase 5에서 구현했다
    (아래 참고).
- Phase 3 범위는 "A안"이었다. 교체·맞교환·알림에 관한 §6.5 권한 테스트는 해당 API와 함께 Phase 4로
  미뤘고, Phase 4에서 구현했다.
- 라우트 테스트는 연도를 겹치지 않게 나눠 쓴다 (2030~2034년 등). 다른 테스트 파일의 2026년 픽스처와
  충돌하지 않게 하기 위해서다. 예를 들어 `specialDays.routes.test.ts`는 2026-10-20~23에 배정이 없다고
  가정한다.

### 배정 변경 (Phase 4)
- `services/assignmentService.ts`가 편성 이후의 모든 변경을 담당한다.
  - 대상 교사 평가에는 스케줄러의 `HardRule`을 재사용한다.
  - `BLOCKING_RULE_IDS`(OnePerDay, ActiveOnly)는 항상 차단하고, 나머지 위반은 모두 **경고**다.
  - **본인 넘기기·맞교환(F1-2):** CONFIRMED 월만 가능하다.
    - 경고가 있으면 `confirmWarnings: true`가 필요하다. 없으면 409 `{ requiresConfirmation, warnings }`.
    - ADMIN·학년부장이 본인 셀을 교체해도 이력의 역할은 `TEACHER`로 기록한다.
  - **관리 변경(F6, `PUT /api/assignments/:id`):** CLOSED를 제외한 모든 상태에서 가능하다.
    - 경고가 있으면 `force: true`가 필요하다 (없으면 409 `{ requiresForce }`).
    - **OnePerDay는 강제로도 풀 수 없다** (한 교사의 같은 날 이중 배정은 물리적으로 불가하다는 결정).
    - `isModified` = `teacherId !== originalTeacherId`이므로, 되돌리면 표시가 풀리고 이력은 남는다.
    - **ADMIN의 관리 변경은 초기 배정**이다 (오너 결정): `originalTeacherId`도 새 교사로 바꿔 `isModified=false`,
      이력 메모 `[관리자 지정]`. 학년부장 변경은 기존대로 교체 표시.
  - **알림:**
    - 넘기기·맞교환은 상대 교사와 실제 `GradeHead` 행의 부장에게 보낸다. 암묵적 부장인 ADMIN에게는
      보내지 않는다.
    - 관리 변경은 CONFIRMED 월에서만 알린다.
- async 라우트는 `lib/http.ts`의 `handle()`을 쓴다. Express 4는 async 예외를 잡지 못한다.
  `ServiceError(status, msg, details)`는 `{ error, ...details }` 응답이 된다.
- `services/statsService.ts`:
  - 월 집계는 DRAFT를 볼 수 있는 사용자에게만 DRAFT를 포함한다.
  - 누계 = InitialCount + 요청 월 말일까지의 CONFIRMED/CLOSED이다. *실제* 현재 교사·학년·그룹
    기준으로 센다.
- **미배정 칸 직접 지정**(`fillAssignment`, `POST /api/assignments`)은 F6 관리 변경과 같은 규칙을 따른다.
  - 후보 목록은 `GET /api/assignments/candidates?date=&grade=`로 받는다.
  - 조건: 담당 학년 권한, CLOSED가 아닌 월(**EMPTY도 가능** — 첫 지정 시 MonthPlan을 DRAFT로 만들고 메모 `[수동 편성]`),
    운영일이어야 하고 셀이 비어 있어야 한다. 달력은 미편성 월의 `—` 칸도 담당자에게 클릭 가능하게 보여 준다.
  - 차단 규칙은 강제로 풀 수 없고, 경고는 `force`가 필요하다.
  - `originalTeacherId` = 지정한 교사이므로 변경 셀로 표시되지 않는다.
  - **고정(🔒) 기능은 없다** (오너 결정으로 제거, 마이그레이션 `remove_assignment_lock`). 대신 `loadSchedulerInput`이
    **변경 이력(AssignmentHistory)이 있는 셀을 `isModified: true`로 엔진에 넘겨** 자동 편성·부분 재편성에서 유지한다
    (직접 지정·ADMIN 변경 셀은 ↻ 표시가 없어도 보호). 부분 재편성의 `includeModified`는 이 셀들도 다시 편성한다.
  - 후보 목록 응답의 각 교사에는 담당 학년 `grades`가 있다. 클라이언트 `CandidateList`가 감독 칸의 학년 → 다른 학년 →
    미지정 순으로 묶고 이름(ko) 순으로 정렬한다 (관리 변경·빈 칸 지정 팝오버 공통).
  - 이력은 `fromTeacherId = null`로 남긴다.
    - `AssignmentHistory.fromTeacherId`는 마이그레이션 `history_nullable_from`부터 nullable이다.
    - UI는 null을 "미배정"으로 표시하고, '내 감독' 이력에서는 종류 `ASSIGNED`로 보여 준다.
  - CONFIRMED 월이면 지정된 교사에게 알림을 보낸다 (F6 동작과 동일).
- **감독 취소**(`cancelAssignment`, `DELETE /api/assignments/:id`): 학년 범위 권한, CLOSED 불가. 배정 삭제는
  `removeAssignmentsTx()` 공통 함수로 한다: 이력 삭제(AssignmentHistory는 배정 FK가 필수라 남길 수 없음) → 알림의
  assignmentId 해제 → 배정 삭제 → CONFIRMED 월이면 교사별로 모아 `REMOVED_BY_CHANGE` 알림. 대신 감사 로그
  `CANCEL_ASSIGNMENT`에 셀·교사를 남긴다. 방과후 운영일 지정 시 배정 취소도 같은 함수를 쓴다.
- `components/Popover.tsx`는 `ResizeObserver`로 크기가 바뀔 때마다 위치를 다시 잡는다. 팝오버 내용이
  비동기로 로드되기 때문에, 처음 한 번만 배치하면 아래쪽 주의 셀에서 동작 버튼이 화면 밖으로 밀렸다.

### Phase 5 세부 사항
- **부분 재편성** (`regenerateMonthPlan`, `POST …/regenerate {from, to, includeModified}`)
  - 수동 변경 셀은 `includeModified`가 아니면 유지한다.
  - **DRAFT 월:** 결과로 셀을 그대로 교체한다 (`originalTeacherId` = 새 교사, 이력 없음).
  - **CONFIRMED 월 (오너 결정 "B안"):**
    - `originalTeacherId`를 확정 시점 교사로 유지하므로, 바뀐 셀은 노란색(`isModified`)이 된다.
    - 변경마다 메모 `부분 재편성`으로 이력을 남기고, 알림은 보내지 않는다.
    - 후보가 없으면 기존 배정을 유지하고 경고를 반환한다.
    - 미배정이던 셀을 채우면 original = 새 교사로 두고 `fromTeacherId = null` 이력을 남긴다.
  - **부작용:** 재편성된 확정 셀은 `isModified`가 되므로, *다음* 재편성에서는 `includeModified`가
    아니면 보호된다. 범례가 "수동 변경" 대신 "↻ 변경됨"인 이유다.
- **감독 초기화** (`resetMonthPlan`, `POST …/reset`): 해당 월·학년 배정과 그 이력을 모두 지우고 MonthPlan을
  EMPTY로 되돌린다. DRAFT·CONFIRMED만(마감 월 409), 권한은 학년 범위. 확정 월이면 배정되어 있던 교사(실행자
  제외)에게 `MONTH_RESET` 알림. 순환 포인터는 확정 배정 기준이라 자연히 이전 상태로 돌아간다.
- **마감·해제 (F8)**
  - 마감은 CONFIRMED여야 하고 학년 범위 권한이 필요하다.
  - 해제는 ADMIN 전용이다. 본문 `{pin}`을 ADMIN 본인 PIN으로 다시 확인하고, 월을 CONFIRMED로
    되돌린다.
  - 모든 변경 경로가 CLOSED를 검사한다. `POST /api/special-days`도 마찬가지다. 그대로 두면 마감 월의
    배정을 삭제하게 되므로, `confirmDeleteAssignments`가 있어도 409를 반환한다.
- **변경 이력 (F10)** `GET /api/history`
  - ADMIN은 전체를 본다.
  - 학년부장은 담당 학년 전체와 본인 관련 이력을 본다.
  - 일반 교사는 본인이 from/to/changedBy인 행만 본다.
- **기간 통계 (F7)** `GET /api/stats/range?from=YYYY-MM&to=YYYY-MM` (최대 24개월)
  - CONFIRMED/CLOSED만 세고 DRAFT는 절대 세지 않는다. 월 패널용 `/api/stats`가 볼 수 있는 사용자에게
    DRAFT를 보여 주는 것과 다르다.
  - 학기 프리셋은 클라이언트에 있다: 1학기 3–8월, 2학기 9–2월. 학년도는 3월에 시작한다.
- **통계 제외 월** (`TeacherStatsExclusion`, 교사 × 월, 마이그레이션 `teacher_stats_exclusion`)
  - 관리자·학년부장(`requireScheduleManager`)이 교사 관리 화면에서 등록한다 (`/api/teachers/:id/stats-exclusions`).
  - `statsService.aggregate`가 기간 안의 제외 월을 `excludedMonths`로 돌려준다.
    - 월 현황(`/api/stats`): 그 달 제외 교사는 행·공정성 풀에서 뺀다.
    - 기간 통계: 모든 달이 제외면 행을 숨기고, 하나라도 제외면 공정성 풀에서 뺀다 (행에는 `excludedMonths`).
  - **통계 표시 전용**이다. 감독 횟수·누계 계산과 스케줄러는 이 표를 보지 않는다. 교사 삭제 시 함께 지운다.
- **인쇄 (F9)**
  - `@page { size: A4 landscape }`는 `index.css`에 있다.
  - 그리드 외 모든 요소는 `print:hidden`이고, 셀은 `print:min-h-[64px]`로 줄어든다.
  - 헤드리스 Chrome PDF로 5주짜리 달과 6주짜리 달 모두 1페이지임을 확인했다. 행이나 셀 내용을
    추가하면 다시 확인한다.
- **모든 DB는 WAL 모드**다. 서버는 시작 시(`index.ts`), 테스트는 `globalSetup.ts`에서 설정한다. 기본 롤백
  저널에서는 이 Windows PC에서 쓰기 한 건이 수 초까지 튀어 15초 테스트 타임아웃이 무작위로 났다. WAL이라
  DB 파일만 복사하면 최신 내용이 빠질 수 있으므로, 백업은 반드시 앱 기능(`VACUUM INTO`)을 쓴다.

### 배포·백업 (Phase 6)
- **단일 컨테이너**(`Dockerfile`, `docker-compose.yml`)
  - 서버가 `CLIENT_DIST`의 빌드된 화면도 제공하고, API가 아닌 경로는 index.html로 보낸다(SPA).
  - DB는 볼륨 `/data/dutycal.db`에 있다.
  - `docker/entrypoint.sh` 순서: `prestart.js`(대기 중인 복원 적용) → `prisma migrate deploy` → 서버.
    그래서 `prisma`는 server의 **dependencies**에 있다 (devDependencies로 옮기지 말 것).
  - 학교망 TLS 가로채기에 대비해 이미지는 `docker/certs/*.crt`를 신뢰하고 `NODE_OPTIONS=--use-system-ca`를 쓴다.
  - Windows에서 만든 스크립트가 컨테이너에서 깨지지 않도록 `.gitattributes`로 LF를 강제한다.
- **로그인 세션은 DB(`Session` 테이블)에 저장**한다 (`auth/prismaSessionStore.ts`).
  - 재시작해도 로그인이 유지된다.
  - rolling 세션의 touch는 만료가 5분 이상 늘어날 때만 쓴다.
  - HTTPS면 `COOKIE_SECURE=true`, 프록시 뒤면 `TRUST_PROXY=1`로 설정한다.
- **백업/복원** (`services/backupService.ts`, `lib/dbFile.ts`, `routes/backup.routes.ts`)
  - **백업**은 `VACUUM INTO`로 서비스 중에도 일관된 스냅샷을 만든다(`writeSnapshot`). 수동·월초 자동 백업 모두
    스냅샷에서 `Session`을 지운 뒤 **VACUUM**까지 한다. DELETE만 하면 빈 페이지에 세션 ID 바이트가 남는다.
    테스트가 파일 바이트에 sid가 없는지 확인한다.
  - **복원**은 사용 중인 DB 파일을 실행 중에 바꾸지 않는다. 절차는 다음과 같다.
    - 업로드한 파일을 검증한다: 헤더, 필수 테이블, 모르는 마이그레이션이면 거부.
    - 백업 안의 `Session` 행을 삭제한다.
    - `restore-pending.db`(DB와 같은 디렉터리)로 둔다.
  - **다음 시작 때** `applyPendingRestore()`가 현재 DB(+`-wal`/`-shm`)를 `backups/before-restore-<시각>.db`로
    보관하고 교체한다. 이어서 migrate deploy가 오래된 백업을 최신 구조로 올린다.
  - `RESTART_ON_RESTORE=true`(Docker)면 응답 후 `process.exit(0)` → `restart: unless-stopped`로 자동
    재시작한다. 개발 환경에서는 수동으로 재시작하고 `migrate deploy`를 실행해야 한다.
  - **월초 자동 백업**(`ensureMonthlyBackup`/`startMonthlyBackupScheduler`)
    - 서버 시작 시와 매시간 확인한다. 이번 달 몫(`monthly-<전월>.db`, Asia/Seoul 기준)이 없으면
      `backups/monthly`에 만들고, `AUTO_BACKUP_KEEP`(기본 24)개만 남긴다.
    - `.tmp`로 만든 뒤 rename해서, 목록에는 완성된 파일만 보이게 한다.
    - 스케줄러는 `index.ts`에서만 시작하므로 테스트에서는 돌지 않는다.
    - **test.db와 dev.db가 같은 `server/prisma` 폴더라 `backups/monthly`를 공유한다.** 테스트는 먼 미래·과거
      월만 쓰고 자기가 만든 파일만 지운다 (디렉터리 통째로 지우지 말 것).
  - 상대 경로 `DATABASE_URL`은 schema.prisma 디렉터리(`server/prisma`) 기준으로 해석된다. `dbFile.ts`의
    `PRISMA_DIR`은 src와 dist 양쪽에서 같은 위치가 되도록 `../../prisma`로 계산한다.
- **검증 방법(Docker 없이):** `npm run build` 후 entrypoint와 같은 3단계를 같은 환경변수로 실행해 확인했다.
  확인 항목은 빈 볼륨 설치, 강제 종료 후 데이터·세션 유지, 백업 → 복원 → 자동 종료 → 재시작 시 적용이다.
  PowerShell 5.1로 한글 환경변수를 `.ps1`에서 설정하면 UTF-8 BOM이 없을 때 깨지므로 주의한다
  (실제 배포는 compose의 `.env`가 UTF-8로 읽혀 문제없다).

### 테스트 전략 (서버)
- `vitest.config.ts`는 `fileParallelism: false`로 설정되어 있다.
  - 모든 테스트 파일이 **디스크의 SQLite 파일 하나**(`server/prisma/test.db`)를 공유한다.
  - SQLite는 여러 프로세스의 동시 쓰기를 처리하지 못해서, 파일을 병렬로 돌리면 `P1008`
    "database is locked" 타임아웃이 난다.
  - 파일별 DB로 바꾸기 전에는 병렬 실행을 다시 켜지 않는다.
- `src/test/globalSetup.ts`는 테스트 실행마다 한 번 돈다.
  - `test.db`를 지우고 **`prisma migrate deploy`**(실제 마이그레이션, `_prisma_migrations` 포함 — 백업/복원
    검증에 필요)를 실행한 뒤, WAL로 바꾸고 고정 픽스처를 하드코딩된 PIN으로 시드한다.
    픽스처: 관리자, `1학년부장`/`2학년부장`/`3학년부장`, `평교사`, `비활성교사`.
  - 이 이름들은 여러 테스트 파일이 쓰는 **공유 가변 픽스처**다.
  - 테스트가 전역 상태를 바꿔야 하면(학년부장 지정, 교사 삭제 등) 공유 픽스처를 바꾸지 말고 그
    테스트 전용 교사를 새로 만든다.
  - 그렇지 않으면 뒤 테스트 파일이 예상치 못한 잔여 상태를 보게 된다. 위 이유로 테스트 파일은 같은
    DB에서 파일 순서대로 순차 실행된다.
- `globalSetup.ts`의 환경 상수(`ADMIN_NAME`, `ADMIN_INITIAL_PIN`, `DATABASE_URL`)는 하드코딩된
  리터럴이며, `vitest.config.ts`의 `test.env` 블록과 일치해야 한다. `globalSetup`이 실행되는 시점에는
  `test.env`가 확실히 보이지 않는다. 그래서 이 가정이 여전히 맞는지 확인하기 전에는
  `process.env`를 읽도록 리팩터링하지 않는다.
- 라우트 수준 권한 테스트는 보통 미들웨어를 따로 단위 테스트하지 않는다. 대신 `supertest` +
  `request.agent()`(쿠키 세션용)로 `createApp()`에 실제 HTTP 요청을 보낸다.
  예외는 `permissions/middleware.test.ts`로, 모킹한 `req`/`res`로 미들웨어 함수를 직접 테스트한다.

### 날짜
REQUIREMENTS.md §8(Asia/Seoul, 타임존 버그 방지)에 따라 모든 날짜는 처음부터 끝까지 `'YYYY-MM-DD'`
문자열로 다룬다 (DB 컬럼, API 페이로드, 클라이언트 상태). 네이티브 `Date` 객체는 쓰지 않는다.
`server/src/lib/dateUtils.ts`는 요일·날짜 범위 계산을 UTC 자정(`` `${date}T00:00:00Z` ``)으로 파싱해서
하므로, 결과가 실행 PC의 타임존에 영향받지 않는다.

### 시드 데이터
- `server/prisma/seed.ts`는 가상의 샘플 교사 15명(실명 아님)과 학년부장 3명을 만든다.
- 해당 연도의 공휴일은 `server/src/data/holidaysKr.ts`에서 불러와 시드한다.
  - 현재는 2026년만 들어 있다. 음력 공휴일은 계산 로직이 없으므로 새 연도마다 직접 찾아 추가해야 한다.
  - 같은 `holidaysKr.ts` 모듈이 `POST /api/special-days/seed-holidays` 엔드포인트에서도 쓰이므로, 공휴일
    목록을 중복하지 말고 새 연도는 이 파일에 추가한다.
