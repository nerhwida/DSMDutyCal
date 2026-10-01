import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { hashPin } from '../auth/pin.js';
import { findTeacherId, loginBody } from '../test/helpers.js';

const app = createApp();

async function loginFixture(name: string, pin: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send(await loginBody(await findTeacherId(name), pin));
  return agent;
}

/** 테스트 전용 일반 교사 (공유 픽스처를 쓰지 않는다). */
async function newTeacher(prefix: string) {
  const t = await prisma.teacher.create({ data: { name: `${prefix}_${Date.now()}`, pinHash: await hashPin('1234') } });
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send(await loginBody(t.id, '1234'));
  return { id: t.id, name: t.name, agent };
}

const record = {
  date: '2040-09-16',
  courseName: '공기업 준비반',
  instructorName: '장OO',
  studentCount: 10,
  studyRoom: '창조실',
  note: '10.01.목 보강',
};

describe('방과후 휴강·자습 현황', () => {
  it('일반 교사가 등록하고 본인 것은 수정·삭제할 수 있다. 다른 교사는 못 하고, 학년부장은 할 수 있다', async () => {
    const author = await newTeacher('보강작성');
    const other = await newTeacher('보강타인');
    const head = await loginFixture('1학년부장', '1111');

    const created = await author.agent.post('/api/makeup/records').send(record);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ ...record, createdById: author.id });
    const id = created.body.id;

    const list = await other.agent.get('/api/makeup/records');
    const row = list.body.find((r: { id: number }) => r.id === id);
    expect(row).toMatchObject({ courseName: '공기업 준비반', createdByName: author.name, canEdit: false });
    expect((await author.agent.get('/api/makeup/records')).body.find((r: { id: number }) => r.id === id).canEdit).toBe(true);

    expect((await other.agent.put(`/api/makeup/records/${id}`).send({ ...record, studentCount: 3 })).status).toBe(403);
    expect((await other.agent.delete(`/api/makeup/records/${id}`)).status).toBe(403);

    const updated = await author.agent.put(`/api/makeup/records/${id}`).send({ ...record, studentCount: 12, note: '' });
    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({ studentCount: 12, note: null });

    expect((await head.put(`/api/makeup/records/${id}`).send({ ...record, studyRoom: '도서관' })).body.studyRoom).toBe('도서관');
    expect((await head.delete(`/api/makeup/records/${id}`)).status).toBe(200);
    expect(await prisma.afterSchoolRecord.findUnique({ where: { id } })).toBeNull();
  });

  it('필수 항목이 비거나 형식이 틀리면 400, 로그인하지 않으면 401', async () => {
    const t = await newTeacher('보강검증');
    expect((await t.agent.post('/api/makeup/records').send({ ...record, courseName: ' ' })).status).toBe(400);
    expect((await t.agent.post('/api/makeup/records').send({ ...record, date: '09.16' })).status).toBe(400);
    expect((await t.agent.post('/api/makeup/records').send({ ...record, studentCount: -1 })).status).toBe(400);
    const noCount = await t.agent.post('/api/makeup/records').send({ ...record, studentCount: undefined });
    expect(noCount.status).toBe(400);
    expect(noCount.body.error).toBe('인원을 입력해주세요.');
    expect((await request(app).get('/api/makeup/records')).status).toBe(401);
  });
});

describe('보강 계획 시 참고 사항', () => {
  it('한 줄 글을 등록·수정·삭제하고, 작성자·관리자만 고칠 수 있다', async () => {
    const author = await newTeacher('참고작성');
    const other = await newTeacher('참고타인');
    const admin = await loginFixture(process.env.ADMIN_NAME!, process.env.ADMIN_INITIAL_PIN!);

    const created = await author.agent
      .post('/api/makeup/notes')
      .send({ content: '10.22.(목) 8교시 2학년 취업역량강화캠프 사전교육(새롬홀) 예정' });
    expect(created.status).toBe(201);
    const id = created.body.id;

    expect((await other.agent.put(`/api/makeup/notes/${id}`).send({ content: '바꿈' })).status).toBe(403);
    expect((await author.agent.put(`/api/makeup/notes/${id}`).send({ content: '' })).status).toBe(400);
    const updated = await author.agent
      .put(`/api/makeup/notes/${id}`)
      .send({ content: '10.22.(목) 9~10교시 창조실, 도서관 사용 예정' });
    expect(updated.body.content).toBe('10.22.(목) 9~10교시 창조실, 도서관 사용 예정');

    const list = await other.agent.get('/api/makeup/notes');
    expect(list.body.find((n: { id: number }) => n.id === id)).toMatchObject({ createdByName: author.name, canEdit: false });

    expect((await admin.delete(`/api/makeup/notes/${id}`)).status).toBe(200);
    expect(await prisma.makeupNote.findUnique({ where: { id } })).toBeNull();
  });
});
