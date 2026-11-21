// Envio de e-mails pelo Brevo (gratuito: 300 e-mails por dia).
// Configure no Render:  BREVO_API_KEY  (a chave da API do Brevo)
//                      EMAIL_REMETENTE (o e-mail que você confirmou no Brevo, ex.: seuemail@gmail.com)
// Sem essas variáveis, o site funciona normalmente, só não manda e-mails.

const CHAVE = process.env.BREVO_API_KEY || '';
const REMETENTE = process.env.EMAIL_REMETENTE || '';

export const emailAtivo = () => !!(CHAVE && REMETENTE);

export async function enviarEmail(para, assunto, html) {
  if (!emailAtivo()) return false;
  try {
    const r = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': CHAVE, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: REMETENTE, name: 'Xadrez' },
        to: [{ email: para }],
        subject: assunto,
        htmlContent: html,
      }),
    });
    if (!r.ok) console.error('Brevo recusou o e-mail:', r.status, (await r.text()).slice(0, 200));
    return r.ok;
  } catch (e) {
    console.error('Erro ao enviar e-mail:', e.message);
    return false;
  }
}

// Modelo simples de e-mail com um botão
export function modeloEmail(titulo, texto, botao, link) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;padding:24px;background:#1b1d2a;color:#eceef7;border-radius:12px">
    <h2 style="margin-top:0">♞ ${esc(titulo)}</h2>
    <p style="line-height:1.5">${esc(texto)}</p>
    <p style="text-align:center;margin:28px 0"><a href="${esc(link)}" style="background:#4a9a46;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">${esc(botao)}</a></p>
    <p style="font-size:12px;color:#9aa0bd">Se você não pediu isso, pode ignorar este e-mail. O link vale por 1 hora.</p>
  </div>`;
}
