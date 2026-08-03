/**
 * Email actuation — sends emails via SMTP. Configure SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS.
 */
const nodemailer = require('nodemailer');

async function sendEmail({ to, subject, body }) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    return 'Failed to send email: SMTP_USER and SMTP_PASS must be set in environment.';
  }
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: false,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });

    const info = await transporter.sendMail({
      from: `"Piko (AusMaker AI)" <${process.env.SMTP_USER}>`,
      to: to,
      subject: subject,
      text: body,
    });

    if (process.env.PIKO_LOG_PLANNER === '1') console.log(`[EMAIL] Sent to ${to}: ${info.messageId}`);
    return `Email successfully sent to ${to}. Message ID: ${info.messageId}`;
  } catch (error) {
    console.error('[EMAIL ERROR]', error.message);
    return `Failed to send email: ${error.message}`;
  }
}

module.exports = { sendEmail };
