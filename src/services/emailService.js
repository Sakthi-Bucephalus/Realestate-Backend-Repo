const nodemailer = require('nodemailer');

const createTransporter = (smtpConfig) => {
  if (smtpConfig && smtpConfig.host && smtpConfig.user && smtpConfig.pass) {
    return nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port || 587,
      secure: smtpConfig.secure || false,
      auth: {
        user: smtpConfig.user,
        pass: smtpConfig.pass,
      },
    });
  }

  // Fallback to process.env credentials
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  }

  // Development / Test transporter
  return null;
};

const getBaseEmailTemplate = ({ title, preheader, contentHtml }) => {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #F8F8F6; margin: 0; padding: 20px; color: #262626; }
    .container { max-width: 580px; margin: 0 auto; background: #FFFFFF; border-radius: 8px; border: 1px solid #E8E2D5; overflow: hidden; box-shadow: 0 4px 12px rgba(184, 138, 46, 0.08); }
    .header { background: #FCF8EF; border-bottom: 2px solid #B88A2E; padding: 24px 32px; text-align: center; }
    .logo-text { font-size: 24px; font-weight: 800; color: #8C671D; letter-spacing: -0.5px; margin: 0; }
    .logo-sub { font-size: 11px; text-transform: uppercase; color: #B88A2E; letter-spacing: 2px; margin-top: 4px; }
    .body-content { padding: 32px; }
    .otp-badge { background: #FCF8EF; border: 2px dashed #B88A2E; border-radius: 8px; font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #8C671D; text-align: center; padding: 18px 0; margin: 24px 0; }
    .footer { background: #F8F8F6; border-top: 1px solid #E8E2D5; padding: 20px 32px; text-align: center; font-size: 12px; color: #737373; line-height: 1.6; }
    .button { display: inline-block; background-color: #B88A2E; color: #FFFFFF !important; text-decoration: none; font-weight: 600; padding: 12px 28px; border-radius: 6px; margin: 16px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo-text">ESTATEFLOW</div>
      <div class="logo-sub">Enterprise Real Estate Management</div>
    </div>
    <div class="body-content">
      ${contentHtml}
    </div>
    <div class="footer">
      This is an automated operational notification from EstateFlow.<br />
      If you did not initiate this request, please contact your organization administrator immediately.<br />
      &copy; ${new Date().getFullYear()} EstateFlow Real Estate Software.
    </div>
  </div>
</body>
</html>
  `;
};

const sendEmail = async ({ to, subject, html, text, smtpConfig = null }) => {
  const from = (smtpConfig && smtpConfig.fromEmail) || process.env.EMAIL_FROM || '"EstateFlow System" <noreply@estateflow.com>';
  const transporter = createTransporter(smtpConfig);

  if (!transporter) {
    console.log('\n=================== EMAIL SIMULATION (SMTP Not Configured) ===================');
    console.log(`To: ${to}`);
    console.log(`From: ${from}`);
    console.log(`Subject: ${subject}`);
    console.log('Text Content:', text);
    console.log('============================================================================\n');
    return {
      messageId: `simulated-${Date.now()}`,
      simulated: true,
      delivered: true,
    };
  }

  const info = await transporter.sendMail({
    from,
    to,
    subject,
    text: text || '',
    html,
  });

  return info;
};

// Specialized email dispatchers
const sendOtpEmail = async ({ to, otp, userName = 'Valued User', smtpConfig = null }) => {
  const subject = `EstateFlow Verification Code: ${otp}`;
  const contentHtml = `
    <h2 style="color: #262626; margin-top: 0;">Verification Code</h2>
    <p style="color: #737373; font-size: 14px; line-height: 1.5;">
      Hello <strong>${userName}</strong>,<br />
      Please use the following single-use verification code to complete your EstateFlow authentication.
    </p>
    <div class="otp-badge">${otp}</div>
    <p style="color: #737373; font-size: 13px;">
      This code expires in <strong>5 minutes</strong>. Never share this code with anyone.
    </p>
  `;

  const html = getBaseEmailTemplate({
    title: 'Your Verification Code',
    contentHtml,
  });

  return sendEmail({
    to,
    subject,
    html,
    text: `Your EstateFlow verification code is ${otp}. Valid for 5 minutes.`,
    smtpConfig,
  });
};

const sendFollowUpReminderEmail = async ({ to, leadName, followUpDate, remarks, executiveName, smtpConfig = null }) => {
  const subject = `Follow-up Due: Lead ${leadName}`;
  const contentHtml = `
    <h2 style="color: #262626; margin-top: 0;">Lead Follow-up Reminder</h2>
    <p style="color: #737373; font-size: 14px;">
      Hello <strong>${executiveName}</strong>,<br />
      You have a scheduled lead follow-up due on <strong>${new Date(followUpDate).toLocaleString()}</strong>.
    </p>
    <div style="background: #FCF8EF; border-left: 4px solid #B88A2E; padding: 12px 16px; margin: 16px 0;">
      <p style="margin: 0; font-weight: 600; color: #8C671D;">Lead: ${leadName}</p>
      <p style="margin: 4px 0 0; font-size: 13px; color: #737373;">Remarks: ${remarks || 'General follow-up call'}</p>
    </div>
  `;

  const html = getBaseEmailTemplate({
    title: subject,
    contentHtml,
  });

  return sendEmail({
    to,
    subject,
    html,
    text: `Follow-up due for ${leadName} at ${new Date(followUpDate).toLocaleString()}`,
    smtpConfig,
  });
};

module.exports = {
  sendEmail,
  sendOtpEmail,
  sendFollowUpReminderEmail,
  getBaseEmailTemplate,
};
