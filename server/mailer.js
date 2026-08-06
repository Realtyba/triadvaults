import nodemailer from 'nodemailer';
import fs from 'fs';

const es = JSON.parse(fs.readFileSync(new URL('../src/locales/es.json', import.meta.url)));
const en = JSON.parse(fs.readFileSync(new URL('../src/locales/en.json', import.meta.url)));
const dicts = { es, en };

function t(lang, key, ...args) {
  const dict = dicts[lang] || dicts.es;
  let text = dict[key] || dicts.es[key] || key;
  args.forEach((arg, i) => {
    text = text.replace(`{${i}}`, arg);
  });
  return text;
}

let transporter = null;

/** ¿Hay credenciales SMTP? Sin ellas los PIN solo se escriben en consola. */
export function mailerIsConfigured() {
  return !!(process.env.SMTP_USER && process.env.SMTP_PASS);
}

/**
 * El transporte se crea la primera vez que hace falta, no al importar el módulo:
 * así un SMTP mal configurado no cuesta nada en el arranque del servidor ni en
 * los scripts que importan este fichero de rebote.
 */
function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.MAIL_ENCRYPTION === 'ssl' || process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  return transporter;
}

/**
 * Cuando no hay SMTP, el PIN quedaba solo en la consola del servidor y no había
 * forma de completar el registro desde el navegador. Con `AUTH_DEV_ECHO_PIN` las
 * rutas pueden devolverlo en la respuesta para poder probar sin montar correo.
 * Nunca en producción, pase lo que pase en la configuración.
 */
export function devPinEchoEnabled() {
  return process.env.NODE_ENV !== 'production' && process.env.AUTH_DEV_ECHO_PIN === 'true';
}

export const sendMailTemplate = async (email, templateName, lang, data) => {
  if (!mailerIsConfigured()) {
    console.warn(`[MAILER] Correo no enviado (sin SMTP). Plantilla: ${templateName}, PIN: ${data.code}`);
    return false;
  }

  const { username, code } = data;
  
  let subjectKey = '';
  let greetingKey = '';
  let bodyKey = '';
  let pinLabelKey = '';
  let footerKey = '';

  if (templateName === 'verification') {
    subjectKey = 'email_verification_subject';
    greetingKey = 'email_verification_greeting';
    bodyKey = 'email_verification_body';
    pinLabelKey = 'email_verification_pin_label';
    footerKey = 'email_verification_footer';
  } else if (templateName === 'recovery') {
    subjectKey = 'email_recovery_subject';
    greetingKey = 'email_recovery_greeting';
    bodyKey = 'email_recovery_body';
    pinLabelKey = 'email_recovery_pin_label';
    footerKey = 'email_recovery_footer';
  } else {
    return false;
  }

  const subject = t(lang, subjectKey);
  const greeting = t(lang, greetingKey, username);
  const body = t(lang, bodyKey);
  const pinLabel = t(lang, pinLabelKey);
  const footer = t(lang, footerKey);
  const signature = t(lang, 'email_signature');

  const textContent = `${greeting}\n\n${body}\n\n${pinLabel} ${code}\n\n${footer}\n\n${signature}`;

  const htmlContent = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 30px; border: 1px solid #eaeaea; border-radius: 8px;">
      <h2 style="color: #333333; text-align: center;">${subject}</h2>
      <p style="color: #555555; font-size: 16px;">${greeting}</p>
      <p style="color: #555555; font-size: 16px;">${body}</p>
      
      <div style="text-align: center; margin: 30px 0;">
        <p style="color: #777777; font-size: 14px; text-transform: uppercase; margin-bottom: 10px;">${pinLabel}</p>
        <div style="display: inline-block; background-color: #f8f9fa; border: 1px solid #dee2e6; padding: 15px 40px; font-size: 32px; font-weight: bold; color: ${templateName === 'verification' ? '#28a745' : '#007bff'}; letter-spacing: 4px; border-radius: 6px;">
          ${code}
        </div>
      </div>
      
      <p style="color: #555555; font-size: 14px; text-align: center;">${footer}</p>
      
      <div style="border-top: 1px solid #eaeaea; margin-top: 30px; padding-top: 20px; text-align: center;">
        <p style="color: #999999; font-size: 12px;">${signature}</p>
      </div>
    </div>
  `;

  const mailOptions = {
    from: process.env.SMTP_FROM || `"Triad Vaults" <${process.env.SMTP_USER || 'noreply@triadvaults.com'}>`,
    to: email,
    subject,
    text: textContent,
    html: htmlContent
  };

  try {
    await getTransporter().sendMail(mailOptions);
    console.log(`[MAILER] Correo '${templateName}' enviado a ${email} (${lang || 'es'})`);
    return true;
  } catch (error) {
    console.error(`[MAILER] No se pudo enviar a ${email}: ${error.message}`);
    return false;
  }
};
