import nodemailer, { type Transporter } from 'nodemailer';
import { ServiceError } from '../services/schedulerService.js';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

/** SMTP를 설정하지 않은 개발·테스트 환경에서 보낸 메일을 쌓아 둔다 (테스트가 인증 코드를 읽는다). */
export const devOutbox: OutgoingMail[] = [];

let transporter: Transporter | null = null;

const smtpConfigured = () => Boolean(process.env.SMTP_HOST);

/** 운영 환경에서 SMTP 설정이 없으면 메일을 보낼 수 없으므로 503. */
export function assertMailAvailable() {
  if (!smtpConfigured() && process.env.NODE_ENV === 'production') {
    throw new ServiceError(503, '메일 발송 설정(SMTP)이 없어 인증 코드를 보낼 수 없습니다. 관리자에게 문의하세요.');
  }
}

/**
 * 메일 발송. .env의 SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS / MAIL_FROM을 쓴다.
 * SMTP_HOST가 없으면 개발 환경에서는 서버 콘솔에 내용을 출력하고 devOutbox에 쌓는다.
 */
export async function sendMail(mail: OutgoingMail): Promise<void> {
  assertMailAvailable();
  if (!smtpConfigured()) {
    devOutbox.push(mail);
    if (process.env.NODE_ENV !== 'test') {
      // eslint-disable-next-line no-console
      console.log(`[mail:dev] To: ${mail.to} / ${mail.subject}\n${mail.text}`);
    }
    return;
  }
  transporter ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? '587'),
    secure: process.env.SMTP_SECURE === 'true', // 465 포트면 true, 587(STARTTLS)이면 false
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
  });
  try {
    await transporter.sendMail({ from: process.env.MAIL_FROM ?? process.env.SMTP_USER, ...mail });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[mail] 발송 실패', err);
    throw new ServiceError(502, '인증 메일을 보내지 못했습니다. 잠시 후 다시 시도해주세요.');
  }
}
