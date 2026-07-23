import { logger } from './logger.js';

const FROM = process.env.EMAIL_FROM || 'noreply@geoflux.app';

type SendEmailParams = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

export async function sendEmail({ to, subject, text, html }: SendEmailParams): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    logger.info({ to, subject }, 'Email suppressed in test mode');
    return;
  }

  const smtpUrl = process.env.SMTP_URL;
  if (!smtpUrl) {
    logger.warn({ to, subject }, 'SMTP_URL not configured — logging email instead of sending');
    logger.info({ to, subject, text }, 'Email preview');
    return;
  }

  try {
    const { createTransport } = await import('nodemailer');
    const transporter = createTransport(smtpUrl);
    await transporter.sendMail({
      from: FROM,
      to,
      subject,
      text,
      html: html || text,
    });
    logger.info({ to, subject }, 'Email sent');
  } catch (err) {
    logger.error({ err, to, subject }, 'Failed to send email');
    throw err;
  }
}
