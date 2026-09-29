import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../lib/prisma.js';
import { recordAudit } from '../lib/audit.js';
import { ServiceError } from './schedulerService.js';

/** 키 형식: 'dcf_' + 32바이트 base64url. 엔트로피가 충분하므로 빠른 SHA-256 해시로 조회한다. */
const KEY_PREFIX = 'dcf_';
const DISPLAY_PREFIX_LENGTH = 8;

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function newKey() {
  const key = `${KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { key, keyHash: hashApiKey(key), keyPrefix: key.slice(0, DISPLAY_PREFIX_LENGTH) };
}

const publicFields = {
  id: true,
  name: true,
  keyPrefix: true,
  active: true,
  createdAt: true,
  lastUsedAt: true,
  createdBy: { select: { name: true } },
} as const;

/** 헤더로 받은 키를 활성 연동 계정으로 확인한다. 성공하면 마지막 사용 시각을 갱신한다. */
export async function authenticateApiKey(key: string) {
  const client = await prisma.apiClient.findUnique({ where: { keyHash: hashApiKey(key) } });
  if (!client || !client.active) return null;
  await prisma.apiClient.update({ where: { id: client.id }, data: { lastUsedAt: new Date() } });
  return { id: client.id, name: client.name };
}

export function listApiClients() {
  return prisma.apiClient.findMany({ select: publicFields, orderBy: { createdAt: 'asc' } });
}

/** 연동 계정 생성. 반환되는 key 원문은 이 응답에서만 볼 수 있다. */
export async function createApiClient(name: string, actorId: number) {
  const { key, keyHash, keyPrefix } = newKey();
  const client = await prisma.apiClient.create({
    data: { name, keyHash, keyPrefix, createdById: actorId },
    select: publicFields,
  });
  await recordAudit(actorId, 'CREATE_API_CLIENT', { apiClientId: client.id, name });
  return { client, key };
}

async function findOrThrow(id: number) {
  const client = await prisma.apiClient.findUnique({ where: { id } });
  if (!client) throw new ServiceError(404, '해당 연동 계정을 찾을 수 없습니다.');
  return client;
}

/** 키 재발급. 기존 키는 즉시 사용할 수 없게 된다. */
export async function regenerateApiKey(id: number, actorId: number) {
  await findOrThrow(id);
  const { key, keyHash, keyPrefix } = newKey();
  const client = await prisma.apiClient.update({ where: { id }, data: { keyHash, keyPrefix }, select: publicFields });
  await recordAudit(actorId, 'REGENERATE_API_KEY', { apiClientId: id });
  return { client, key };
}

export async function updateApiClient(id: number, data: { name?: string; active?: boolean }, actorId: number) {
  await findOrThrow(id);
  const client = await prisma.apiClient.update({ where: { id }, data, select: publicFields });
  await recordAudit(actorId, 'UPDATE_API_CLIENT', { apiClientId: id, ...data });
  return client;
}

export async function deleteApiClient(id: number, actorId: number) {
  const client = await findOrThrow(id);
  await prisma.apiClient.delete({ where: { id } });
  await recordAudit(actorId, 'DELETE_API_CLIENT', { apiClientId: id, name: client.name });
}
