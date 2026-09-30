import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { findTeacherId, loginBody } from '../test/helpers.js';
import { hashPin } from '../auth/pin.js';
import { prisma } from '../lib/prisma.js';
import { todayInSeoul, weekdayOf } from '../lib/dateUtils.js';
import { rotationGroupForWeekday } from '../lib/enums.js';

const app = createApp();

// 다른 테스트 파일과 겹치지 않도록 2031년을 사용하고, 테스트마다 월(또는 날짜)을 나눠 쓴다.

let seq = 0;
let pinHashCache: string | null = null;

/** 테스트 전용 교사 + 로그인된 agent. 공유 픽스처를 오염시키지 않는다. */
async function newTeacher(prefix: string, grades: number[] = []) {
  pinHashCache ??= await hashPin('1234');
  const t = await prisma.teacher.create({
    data: { name: `${prefix}_${++seq}_${Date.now()}`, pinHash: pinHashCache },
  });
  for (const grade of grades) {
    await prisma.teacherGrade.create({ data: { teacherId: t.id, grade, weekdayOrder: 500 + seq, fridayOrder: 500 + seq } });
  }
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send(await loginBody(t.id, '1234'));
  return { id: t.id, name: t.name, agent };
}

async function loginFixture(name: string, pin: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send(await loginBody(await findTeacherId(name), pin));
  return agent;
}

async function setPlan(date: string, grade: number, status: 'DRAFT' | 'CONFIRMED' | 'CLOSED') {
  const [year, month] = date.split('-').map(Number);
  await prisma.monthPlan.upsert({
    where: { year_month_grade: { year, month, grade } },
    update: { status },
    create: { year, month, grade, status },
  });
}

/** 확정(또는 지정 상태) 월의 배정 1건 생성. */
async function cell(date: string, grade: number, teacherId: number, status: 'DRAFT' | 'CONFIRMED' | 'CLOSED' = 'CONFIRMED') {
  await setPlan(date, grade, status);
  return prisma.assignment.create({
    data: {
      date,
      grade,
      teacherId,
      originalTeacherId: teacherId,
      rotationGroup: rotationGroupForWeekday(weekdayOf(date)),
    },
  });
}

const reload = (id: number) => prisma.assignment.findUniqueOrThrow({ where: { id } });

describe('본인 감독 교체 권한 (6.5)', () => {
  it('일반 교사가 타인 감독 셀 변경 시 403, 본인 셀 교체는 성공', async () => {
    const a = await newTeacher('소유자', [1]);
    const c = await newTeacher('타인', [1]);
    const x = await cell('2031-01-06', 1, a.id);

    expect((await c.agent.put(`/api/assignments/${x.id}`).send({ teacherId: c.id })).status).toBe(403);
    expect((await c.agent.post(`/api/assignments/${x.id}/transfer`).send({ toTeacherId: c.id })).status).toBe(403);
    expect((await reload(x.id)).teacherId).toBe(a.id);

    const res = await a.agent.post(`/api/assignments/${x.id}/transfer`).send({ toTeacherId: c.id });
    expect(res.status).toBe(200);
    const after = await reload(x.id);
    expect(after.teacherId).toBe(c.id);
    expect(after.originalTeacherId).toBe(a.id); // 최초 교사 유지 → 변경 표시
    expect(after.isModified).toBe(true);
  });

  it('2학년 부장이 1학년 셀 변경 시 403', async () => {
    const a = await newTeacher('1학년셀', [1]);
    const b = await newTeacher('대상', [1]);
    const x = await cell('2031-01-07', 1, a.id);
    const head2 = await loginFixture('2학년부장', '2222');

    expect((await head2.put(`/api/assignments/${x.id}`).send({ teacherId: b.id })).status).toBe(403);
    expect((await head2.get(`/api/assignments/${x.id}/candidates`)).status).toBe(403);
  });

  it('1학년 감독을 1학년 미지정 교사에게 넘기기 성공 (학년 무관, 경고 확인 후)', async () => {
    const a = await newTeacher('넘김', [1]);
    const b = await newTeacher('미지정'); // 어떤 학년에도 등록되지 않음
    const x = await cell('2031-02-03', 1, a.id);

    const first = await a.agent.post(`/api/assignments/${x.id}/transfer`).send({ toTeacherId: b.id });
    expect(first.status).toBe(409);
    expect(first.body.requiresConfirmation).toBe(true);
    expect(first.body.warnings.join()).toContain('해당 학년 미지정');

    const res = await a.agent
      .post(`/api/assignments/${x.id}/transfer`)
      .send({ toTeacherId: b.id, confirmWarnings: true });
    expect(res.status).toBe(200);
    expect((await reload(x.id)).teacherId).toBe(b.id);
  });

  it('방과후 요일 교사에게 넘기기 시 경고 반환 후 확인 요청으로 성공', async () => {
    const date = '2031-02-06';
    const a = await newTeacher('방과후넘김', [1]);
    const b = await newTeacher('방과후', [1]);
    await prisma.teacherWeekdayExclusion.create({
      data: { teacherId: b.id, weekday: weekdayOf(date), reason: 'AFTER_SCHOOL' },
    });
    await prisma.afterSchoolDay.create({ data: { date, grade: 1 } }); // 2/6은 1학년 방과후 운영일, 2/13은 미운영
    const x = await cell(date, 1, a.id);

    const preview = await a.agent.get(`/api/assignments/${x.id}/transfer-preview?toTeacherId=${b.id}`);
    expect(preview.status).toBe(200);
    expect(preview.body.blocking).toBeNull();
    expect(preview.body.warnings).toEqual([`${b.name} 선생님: 2/6(목) 방과후 수업`]);

    // 같은 목요일이라도 방과후 운영일이 아니면 경고 없음
    const y = await cell('2031-02-13', 1, a.id);
    const noWarn = await a.agent.get(`/api/assignments/${y.id}/transfer-preview?toTeacherId=${b.id}`);
    expect(noWarn.body.warnings).toEqual([]);

    const warn = await a.agent.post(`/api/assignments/${x.id}/transfer`).send({ toTeacherId: b.id });
    expect(warn.status).toBe(409);
    expect(warn.body.requiresConfirmation).toBe(true);
    expect((await reload(x.id)).teacherId).toBe(a.id);

    const ok = await a.agent
      .post(`/api/assignments/${x.id}/transfer`)
      .send({ toTeacherId: b.id, confirmWarnings: true, note: '병원 진료' });
    expect(ok.status).toBe(200);
    expect((await reload(x.id)).teacherId).toBe(b.id);
  });

  it('같은 날 다른 학년 감독 중인 교사에게 넘기기 시 거부', async () => {
    const date = '2031-02-04';
    const a = await newTeacher('중복넘김', [1]);
    const b = await newTeacher('2학년감독중', [1, 2]);
    const x = await cell(date, 1, a.id);
    await cell(date, 2, b.id);

    const res = await a.agent
      .post(`/api/assignments/${x.id}/transfer`)
      .send({ toTeacherId: b.id, confirmWarnings: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('같은 날 2학년 감독 중');
    expect((await reload(x.id)).teacherId).toBe(a.id);
  });

  it('맞교환 시 두 배정이 모두 바뀌고 이력이 하나로 묶인다', async () => {
    const a = await newTeacher('맞교환A', [1, 3]);
    const b = await newTeacher('맞교환B', [1, 3]);
    const x = await cell('2031-03-03', 1, a.id);
    const y = await cell('2031-03-05', 3, b.id);

    // 상대 교사의 교체 가능한 감독 목록 (확정 월만)
    const list = await a.agent.get(`/api/teachers/${b.id}/assignments?from=2031-03-01&to=2031-04-30`);
    expect(list.body.map((r: { id: number }) => r.id)).toContain(y.id);

    const res = await a.agent.post('/api/assignments/swap').send({ myAssignmentId: x.id, targetAssignmentId: y.id });
    expect(res.status).toBe(200);
    expect((await reload(x.id)).teacherId).toBe(b.id);
    expect((await reload(y.id)).teacherId).toBe(a.id);

    const history = await prisma.assignmentHistory.findMany({ where: { assignmentId: { in: [x.id, y.id] } } });
    expect(history).toHaveLength(2);
    expect(history[0].swapGroupId).toBeTruthy();
    expect(history[0].swapGroupId).toBe(history[1].swapGroupId);
  });

  it('맞교환 중 한쪽이 실패하면 둘 다 롤백된다', async () => {
    const a = await newTeacher('롤백A', [1, 2, 3]);
    const b = await newTeacher('롤백B', [1, 3]);
    const x = await cell('2031-03-04', 1, a.id);
    const y = await cell('2031-03-06', 3, b.id);
    await cell('2031-03-06', 2, a.id); // A는 3/6에 이미 2학년 감독 → 상대 셀을 받을 수 없음

    const res = await a.agent
      .post('/api/assignments/swap')
      .send({ myAssignmentId: x.id, targetAssignmentId: y.id, confirmWarnings: true });
    expect(res.status).toBe(409);
    expect((await reload(x.id)).teacherId).toBe(a.id);
    expect((await reload(y.id)).teacherId).toBe(b.id);
    expect(await prisma.assignmentHistory.count({ where: { assignmentId: { in: [x.id, y.id] } } })).toBe(0);
  });

  it('마감(CLOSED) 또는 미확정(DRAFT) 월 감독 교체 시 거부', async () => {
    const a = await newTeacher('상태', [1, 2]);
    const b = await newTeacher('상태대상', [1, 2]);
    const closed = await cell('2031-04-01', 1, a.id, 'CLOSED');
    const draft = await cell('2031-04-02', 2, a.id, 'DRAFT');

    const r1 = await a.agent.post(`/api/assignments/${closed.id}/transfer`).send({ toTeacherId: b.id });
    expect(r1.status).toBe(409);
    expect(r1.body.error).toContain('마감');
    const r2 = await a.agent.post(`/api/assignments/${draft.id}/transfer`).send({ toTeacherId: b.id });
    expect(r2.status).toBe(409);
    expect(r2.body.error).toContain('확정되지 않은');

    // 맞교환 대상이 DRAFT여도 거부
    const mine = await cell('2031-04-03', 1, a.id, 'CLOSED');
    const theirs = await cell('2031-04-04', 2, b.id, 'DRAFT');
    const r3 = await a.agent.post('/api/assignments/swap').send({ myAssignmentId: mine.id, targetAssignmentId: theirs.id });
    expect(r3.status).toBe(409);
  });

  describe('당일 감독', () => {
    const today = todayInSeoul();
    const [year, month] = today.split('-').map(Number);
    let createdPlan = false;
    const created: number[] = [];

    afterAll(async () => {
      // 오늘 날짜는 실행 시점마다 달라 다른 테스트 데이터와 겹칠 수 있으므로 반드시 정리한다.
      await prisma.assignmentHistory.deleteMany({ where: { assignmentId: { in: created } } });
      await prisma.notification.deleteMany({ where: { assignmentId: { in: created } } });
      await prisma.assignment.deleteMany({ where: { id: { in: created } } });
      if (createdPlan) {
        await prisma.monthPlan.delete({ where: { year_month_grade: { year, month, grade: 3 } } });
      }
    });

    it('당일 감독도 교체 가능 (시간 제한 없음)', async () => {
      const a = await newTeacher('당일', [3]);
      const b = await newTeacher('당일대상', [3]);
      createdPlan = !(await prisma.monthPlan.findUnique({ where: { year_month_grade: { year, month, grade: 3 } } }));
      await setPlan(today, 3, 'CONFIRMED');
      const x = await prisma.assignment.create({
        data: { date: today, grade: 3, teacherId: a.id, originalTeacherId: a.id, rotationGroup: rotationGroupForWeekday(weekdayOf(today)) },
      });
      created.push(x.id);

      const res = await a.agent
        .post(`/api/assignments/${x.id}/transfer`)
        .send({ toTeacherId: b.id, confirmWarnings: true });
      expect(res.status).toBe(200);
      expect((await reload(x.id)).teacherId).toBe(b.id);
    });
  });

  it('교체 성공 시 상대 교사와 해당 학년부장에게 알림이 생성된다', async () => {
    const a = await newTeacher('알림A', [1]);
    const b = await newTeacher('알림B', [1]);
    const x = await cell('2031-05-05', 1, a.id);
    const headId = await findTeacherId('1학년부장');

    const res = await a.agent.post(`/api/assignments/${x.id}/transfer`).send({ toTeacherId: b.id });
    expect(res.status).toBe(200);

    const toB = await prisma.notification.findMany({ where: { teacherId: b.id, assignmentId: x.id } });
    expect(toB).toHaveLength(1);
    expect(toB[0].type).toBe('ASSIGNED_BY_CHANGE');
    expect(toB[0].message).toContain(a.name);

    const toHead = await prisma.notification.findMany({ where: { teacherId: headId, assignmentId: x.id } });
    expect(toHead).toHaveLength(1);

    // 상대 교사는 알림 API로 확인·읽음 처리할 수 있다.
    const list = await b.agent.get('/api/me/notifications');
    expect(list.body.unreadCount).toBe(1);
    await b.agent.put('/api/me/notifications').send({});
    expect((await b.agent.get('/api/me/notifications')).body.unreadCount).toBe(0);

    // 맞교환 알림
    const y = await cell('2031-05-06', 1, b.id);
    const z = await cell('2031-05-07', 1, a.id);
    const swap = await a.agent.post('/api/assignments/swap').send({ myAssignmentId: z.id, targetAssignmentId: y.id });
    expect(swap.status).toBe(200);
    const swapped = await prisma.notification.findMany({ where: { teacherId: b.id, type: 'SWAPPED' } });
    expect(swapped).toHaveLength(1);
    expect(await prisma.notification.count({ where: { teacherId: headId, type: 'SWAPPED', message: { contains: a.name } } })).toBe(1);
  });

  it('교체 후 통계는 실제 배정 학년·그룹 기준으로 집계된다', async () => {
    const date = '2031-06-06'; // 금요일
    const a = await newTeacher('통계A', [1]);
    const b = await newTeacher('통계B'); // 1학년 미지정 교사
    const x = await cell(date, 1, a.id);

    await a.agent.post(`/api/assignments/${x.id}/transfer`).send({ toTeacherId: b.id, confirmWarnings: true });

    const stats = await a.agent.get('/api/stats?year=2031&month=6');
    expect(stats.status).toBe(200);
    const rowOf = (id: number) => stats.body.rows.find((r: { teacherId: number }) => r.teacherId === id);
    expect(rowOf(b.id).month[1]).toBe(1);
    expect(rowOf(b.id).byGradeGroup['1:FRIDAY']).toBe(1);
    expect(rowOf(b.id).fridayTotal).toBe(1);
    expect(rowOf(a.id).month[1]).toBe(0);
    expect(rowOf(a.id).total).toBe(0);
  });
});

describe('관리 목적 감독 변경 (F6)', () => {
  it('학년부장이 변경하면 수정 표시, 최초 교사로 되돌리면 해제 (이력 유지)', async () => {
    const a = await newTeacher('관리A', [1]);
    const b = await newTeacher('관리B', [1]);
    const x = await cell('2031-07-01', 1, a.id);
    const head1 = await loginFixture('1학년부장', '1111');

    const candidates = await head1.get(`/api/assignments/${x.id}/candidates`);
    expect(candidates.status).toBe(200);
    const cb = candidates.body.candidates.find((c: { teacherId: number }) => c.teacherId === b.id);
    expect(cb).toMatchObject({ blocking: null, warnings: [] });

    const r1 = await head1.put(`/api/assignments/${x.id}`).send({ teacherId: b.id, note: '행사 준비' });
    expect(r1.status).toBe(200);
    expect(r1.body.isModified).toBe(true);

    const r2 = await head1.put(`/api/assignments/${x.id}`).send({ teacherId: a.id });
    expect(r2.status).toBe(200);
    expect(r2.body.isModified).toBe(false);
    expect(await prisma.assignmentHistory.count({ where: { assignmentId: x.id } })).toBe(2);

    // 확정 월 관리 변경은 새 교사·기존 교사에게 알림
    expect(await prisma.notification.count({ where: { teacherId: b.id, type: 'ASSIGNED_BY_CHANGE' } })).toBe(1);
    expect(await prisma.notification.count({ where: { teacherId: a.id, type: 'REMOVED_BY_CHANGE' } })).toBe(1);
  });

  it('관리자가 지정하면 교체가 아니라 초기 배정이 된다 (변경 표시 없음, 이력 유지)', async () => {
    const a = await newTeacher('관리자지정A', [1]);
    const b = await newTeacher('관리자지정B', [1]);
    const x = await cell('2031-07-21', 1, a.id);
    const admin = await loginFixture(process.env.ADMIN_NAME!, process.env.ADMIN_INITIAL_PIN!);

    const res = await admin.put(`/api/assignments/${x.id}`).send({ teacherId: b.id });
    expect(res.status).toBe(200);
    const after = await reload(x.id);
    expect(after).toMatchObject({ teacherId: b.id, originalTeacherId: b.id, isModified: false });

    const history = await prisma.assignmentHistory.findMany({ where: { assignmentId: x.id } });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ fromTeacherId: a.id, toTeacherId: b.id, changedByRole: 'ADMIN', note: '[관리자 지정]' });
  });

  it('불가 교사는 강제 배정 체크 시에만 저장, 같은 날 다른 학년 감독 중이면 강제로도 불가', async () => {
    const date = '2031-07-02';
    const a = await newTeacher('강제A', [1]);
    const b = await newTeacher('강제B', [1]);
    const c = await newTeacher('강제C', [1, 2]);
    await prisma.teacherUnavailableDate.create({ data: { teacherId: b.id, date, reason: '출장' } });
    const x = await cell(date, 1, a.id);
    await cell(date, 2, c.id);
    const admin = await loginFixture(process.env.ADMIN_NAME!, process.env.ADMIN_INITIAL_PIN!);

    const noForce = await admin.put(`/api/assignments/${x.id}`).send({ teacherId: b.id });
    expect(noForce.status).toBe(409);
    expect(noForce.body.requiresForce).toBe(true);

    const forced = await admin.put(`/api/assignments/${x.id}`).send({ teacherId: b.id, force: true });
    expect(forced.status).toBe(200);
    const history = await prisma.assignmentHistory.findFirstOrThrow({ where: { assignmentId: x.id } });
    expect(history.note).toContain('강제 배정');
    expect(history.changedByRole).toBe('ADMIN');

    const doubled = await admin.put(`/api/assignments/${x.id}`).send({ teacherId: c.id, force: true });
    expect(doubled.status).toBe(409);
  });

  it('감독 취소: 셀이 미배정이 되고 이력은 지워지며, 확정 월이면 교사에게 알린다', async () => {
    const a = await newTeacher('취소A', [1]);
    const b = await newTeacher('취소B', [1]);
    const x = await cell('2031-07-22', 1, a.id);
    const head1 = await loginFixture('1학년부장', '1111');
    await head1.put(`/api/assignments/${x.id}`).send({ teacherId: b.id }); // 이력 1건

    // 담당 학년이 아니거나 일반 교사면 403
    expect((await (await loginFixture('2학년부장', '2222')).delete(`/api/assignments/${x.id}`)).status).toBe(403);
    expect((await a.agent.delete(`/api/assignments/${x.id}`)).status).toBe(403);

    const res = await head1.delete(`/api/assignments/${x.id}`);
    expect(res.status).toBe(200);
    expect(await prisma.assignment.findUnique({ where: { id: x.id } })).toBeNull();
    expect(await prisma.assignmentHistory.count({ where: { assignmentId: x.id } })).toBe(0);
    const removed = await prisma.notification.findFirstOrThrow({ where: { teacherId: b.id, type: 'REMOVED_BY_CHANGE', assignmentId: null } });
    expect(removed.message).toContain('감독 배정을 취소했습니다');

    const view = await head1.get('/api/months/2031/7');
    expect(view.body.unassigned.some((u: { date: string; grade: number }) => u.date === '2031-07-22' && u.grade === 1)).toBe(true);
    expect((await head1.delete(`/api/assignments/${x.id}`)).status).toBe(404);
  });

  it('마감 월은 관리 변경 불가', async () => {
    const a = await newTeacher('마감변경A', [1]);
    const b = await newTeacher('마감변경B', [1]);
    const head1 = await loginFixture('1학년부장', '1111');
    const closed = await cell('2031-08-01', 1, a.id, 'CLOSED');
    expect((await head1.put(`/api/assignments/${closed.id}`).send({ teacherId: b.id })).status).toBe(409);
    expect((await head1.delete(`/api/assignments/${closed.id}`)).status).toBe(409);
  });
});

describe('내 감독 화면 (F1-3)', () => {
  it('내 감독 목록과 교체 이력을 조회할 수 있고, DRAFT 배정은 보이지 않는다', async () => {
    const a = await newTeacher('내감독', [1, 2]);
    const b = await newTeacher('내감독B', [1]);
    const confirmed = await cell('2031-09-01', 1, a.id);
    await cell('2031-09-02', 2, a.id, 'DRAFT');
    const given = await cell('2031-09-03', 1, a.id);
    await a.agent.post(`/api/assignments/${given.id}/transfer`).send({ toTeacherId: b.id });

    const mine = await a.agent.get('/api/me/assignments?from=2031-09-01&to=2031-10-31');
    expect(mine.status).toBe(200);
    expect(mine.body.map((r: { id: number }) => r.id)).toEqual([confirmed.id]);

    const history = await a.agent.get('/api/me/history');
    expect(history.body).toHaveLength(1);
    expect(history.body[0]).toMatchObject({ kind: 'GAVE', toTeacherName: b.name });
    const bHistory = await b.agent.get('/api/me/history');
    expect(bHistory.body[0]).toMatchObject({ kind: 'RECEIVED', fromTeacherName: a.name });
  });
});
