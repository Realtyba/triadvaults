import nodemailer from 'nodemailer';

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

export const sendRecoveryPin = async (email, resetCode, username) => {
  if (!mailerIsConfigured()) {
    console.warn(`[MAILER] Correo no enviado (sin credenciales SMTP). PIN recuperación: ${resetCode}`);
    return false;
  }

  const mailOptions = {
    from: process.env.SMTP_FROM || '"Triad Vaults" <noreply@triadvaults.com>',
    to: email,
    subject: 'Recuperación de Acceso de Agente - Triad Vaults',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0b1021; padding: 20px; border: 1px solid #00f3ff; border-radius: 8px;">
        <h2 style="color: #00f3ff; text-align: center; text-transform: uppercase;">Protocolo de Recuperación</h2>
        <p style="color: #a0aec0; font-size: 16px;">Agente <strong>${username}</strong>,</p>
        <p style="color: #a0aec0; font-size: 16px;">Se ha solicitado un restablecimiento de credenciales para tu perfil en la Nube Central.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <p style="color: #ffaa00; font-size: 14px; text-transform: uppercase; margin-bottom: 5px;">Tu PIN de Autorización:</p>
          <div style="display: inline-block; background-color: rgba(0, 243, 255, 0.1); border: 2px solid #00f3ff; padding: 15px 30px; font-size: 32px; font-weight: bold; color: #ffffff; letter-spacing: 5px; border-radius: 4px;">
            ${resetCode}
          </div>
        </div>
        
        <p style="color: #a0aec0; font-size: 14px;">Ingresa este PIN en la terminal del juego junto con tu nueva contraseña. Si no solicitaste este cambio, ignora esta alerta.</p>
        
        <div style="border-top: 1px solid rgba(0, 243, 255, 0.2); margin-top: 30px; padding-top: 15px; text-align: center;">
          <p style="color: #666; font-size: 12px;">Transmisión automatizada desde la Nube de Agentes Triad Vaults.</p>
        </div>
      </div>
    `
  };

  try {
    await getTransporter().sendMail(mailOptions);
    console.log(`[MAILER] Correo de recuperación enviado a ${email}`);
    return true;
  } catch (error) {
    console.error(`[MAILER] No se pudo enviar a ${email}: ${error.message}`);
    return false;
  }
};

export const sendVerificationPin = async (email, code, username) => {
  if (!mailerIsConfigured()) {
    console.warn(`[MAILER] Correo no enviado (sin credenciales SMTP). PIN verificación: ${code}`);
    return false;
  }

  const mailOptions = {
    from: process.env.SMTP_FROM || '"Triad Vaults" <noreply@triadvaults.com>',
    to: email,
    subject: 'Verifica tu Correo de Agente - Triad Vaults',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #0b1021; padding: 20px; border: 1px solid #00ff66; border-radius: 8px;">
        <h2 style="color: #00ff66; text-align: center; text-transform: uppercase;">Confirmación de Enlace</h2>
        <p style="color: #a0aec0; font-size: 16px;">Bienvenido Agente <strong>${username}</strong>,</p>
        <p style="color: #a0aec0; font-size: 16px;">Para activar tu perfil en la Nube Central y poder acceder a las Salas, debes verificar este correo.</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <p style="color: #ffaa00; font-size: 14px; text-transform: uppercase; margin-bottom: 5px;">Tu PIN de Verificación:</p>
          <div style="display: inline-block; background-color: rgba(0, 255, 102, 0.1); border: 2px solid #00ff66; padding: 15px 30px; font-size: 32px; font-weight: bold; color: #ffffff; letter-spacing: 5px; border-radius: 4px;">
            ${code}
          </div>
        </div>
        
        <p style="color: #a0aec0; font-size: 14px;">Ingresa este PIN en tu interfaz de Agente para continuar. Si no creaste esta cuenta, ignora esta alerta.</p>
        
        <div style="border-top: 1px solid rgba(0, 255, 102, 0.2); margin-top: 30px; padding-top: 15px; text-align: center;">
          <p style="color: #666; font-size: 12px;">Transmisión automatizada desde la Nube de Agentes Triad Vaults.</p>
        </div>
      </div>
    `
  };

  try {
    await getTransporter().sendMail(mailOptions);
    console.log(`[MAILER] Correo de verificación enviado a ${email}`);
    return true;
  } catch (error) {
    console.error(`[MAILER] No se pudo enviar la verificación a ${email}: ${error.message}`);
    return false;
  }
};
