const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendEmail(to, subject, html) {
    if (!to) return;
    try {
        await resend.emails.send({
            from: 'TicketFlow <no-reply@vektormkt.es>',
            to,
            subject,
            html
        });
        console.log(`✅ Email enviado a ${to}`);
    } catch (err) {
        console.error('⚠️  Error enviando email:', err.message);
    }
}

function header() {
    return `
        <div style="background:#0f172a;padding:1.5rem 2rem;border-radius:12px 12px 0 0">
            <h1 style="color:white;font-size:1.3rem;margin:0;font-weight:700">Ticket<span style="color:#3b82f6">Flow</span></h1>
            <p style="color:#64748b;font-size:.8rem;margin:.25rem 0 0">Sistema de gestión de reclamaciones</p>
        </div>
    `;
}

function footer() {
    return `
        <p style="color:#94a3b8;font-size:.78rem;margin:1.5rem 0 0;border-top:1px solid #e2e8f0;padding-top:1rem">
            Este mensaje ha sido enviado automáticamente. Por favor no respondas a este email.<br>
            🌐 <a href="https://reclamaciones.vektormkt.es" style="color:#94a3b8">reclamaciones.vektormkt.es</a> · 
            📞 <a href="tel:+34123456789" style="color:#94a3b8;text-decoration:none">+34 123 456 789</a><br>
            Desarrollado por <a href="https://www.vektormkt.es" style="color:#94a3b8">VektorMKT</a>
        </p>
    `;
}

function wrapper(contenido) {
    return `
        <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto;padding:0">
            ${header()}
            <div style="background:#ffffff;padding:2rem;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
                ${contenido}
                ${footer()}
            </div>
        </div>
    `;
}

function codigoBox(codigo) {
    return `
        <div style="background:#f1f5f9;border-radius:10px;padding:1.25rem;margin:1.5rem 0;text-align:center">
            <p style="margin:0;font-size:.8rem;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Código de seguimiento</p>
            <p style="margin:.5rem 0 0;font-size:1.8rem;font-weight:700;color:#1a56db;letter-spacing:.05em">${codigo}</p>
        </div>
    `;
}

function contactBox() {
    return `
        <div style="background:#f8fafc;border-radius:8px;padding:1rem;margin:1.5rem 0">
            <p style="margin:0 0 .5rem;font-size:.85rem;color:#334155"><strong>Consultar estado de tu reclamación:</strong></p>
            <p style="margin:0;font-size:.85rem;color:#1a56db">🌐 <a href="https://reclamaciones.vektormkt.es" style="color:#1a56db">reclamaciones.vektormkt.es</a></p>
            <p style="margin:.4rem 0 0;font-size:.85rem;color:#334155">📞 <a href="tel:+34123456789" style="color:#334155;text-decoration:none">+34 123 456 789</a></p>
        </div>
    `;
}

function emailTicketCreado(codigo, nombre, email) {
    sendEmail(email, `Tu reclamación ${codigo} ha sido registrada`, wrapper(`
        <h2 style="color:#111;font-size:1.1rem;margin:0 0 1rem">Reclamación registrada correctamente</h2>
        <p style="color:#334155;margin:0 0 1rem">Hola <strong>${nombre}</strong>,</p>
        <p style="color:#334155;margin:0 0 1.5rem">Tu reclamación ha sido registrada en nuestro sistema. Guarda tu código para consultar el estado en cualquier momento.</p>
        ${codigoBox(codigo)}
        ${contactBox()}
    `));
}

function emailEstadoCambiado(codigo, nombre, email, estadoNuevo, comentario) {
    const colores = {
        'Asignada':   '#f59e0b',
        'En proceso': '#fb923c',
        'Resuelta':   '#10b981',
        'Cerrada':    '#64748b'
    };
    const color = colores[estadoNuevo] || '#3b82f6';

    sendEmail(email, `Tu reclamación ${codigo} ha sido actualizada`, wrapper(`
        <h2 style="color:#111;font-size:1.1rem;margin:0 0 1rem">Actualización de tu reclamación</h2>
        <p style="color:#334155;margin:0 0 1rem">Hola <strong>${nombre}</strong>,</p>
        <p style="color:#334155;margin:0 0 1.5rem">Tu reclamación <strong>${codigo}</strong> ha cambiado de estado.</p>
        <div style="background:#f1f5f9;border-radius:10px;padding:1.25rem;margin:1.5rem 0;text-align:center">
            <p style="margin:0;font-size:.8rem;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Estado actual</p>
            <p style="margin:.5rem 0 0;font-size:1.4rem;font-weight:700;color:${color}">${estadoNuevo}</p>
            ${comentario ? `<p style="margin:.75rem 0 0;font-size:.85rem;color:#64748b;font-style:italic">"${comentario}"</p>` : ''}
        </div>
        ${contactBox()}
    `));
}

function emailTicketAsignado(codigo, titulo, emailTecnico, areaNombre) {
    sendEmail(emailTecnico, `Nuevo ticket asignado: ${codigo}`, wrapper(`
        <h2 style="color:#111;font-size:1.1rem;margin:0 0 1rem">Nuevo ticket asignado a tu área</h2>
        <p style="color:#334155;margin:0 0 1.5rem">Se ha asignado un nuevo ticket al área <strong>${areaNombre}</strong>.</p>
        <div style="background:#f1f5f9;border-radius:10px;padding:1.25rem;margin:1.5rem 0">
            <p style="margin:0;font-size:.8rem;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Código</p>
            <p style="margin:.5rem 0 0;font-size:1.2rem;font-weight:700;color:#1a56db">${codigo}</p>
            <p style="margin:.5rem 0 0;font-size:.9rem;color:#334155">${titulo}</p>
        </div>
        <p style="color:#334155;font-size:.88rem">Accede al panel interno para gestionar este ticket.</p>
    `));
}

function emailTicketReabierto(codigo, nombre, email, comentario) {
    sendEmail(email, `Tu reclamación ${codigo} ha sido reabierta`, wrapper(`
        <h2 style="color:#111;font-size:1.1rem;margin:0 0 1rem">Tu reclamación ha sido reabierta</h2>
        <p style="color:#334155;margin:0 0 1rem">Hola <strong>${nombre}</strong>,</p>
        <p style="color:#334155;margin:0 0 1.5rem">Tu reclamación <strong>${codigo}</strong> ha sido reabierta y está siendo revisada de nuevo.</p>
        <div style="background:#f1f5f9;border-radius:10px;padding:1.25rem;margin:1.5rem 0;text-align:center">
            <p style="margin:0;font-size:.8rem;color:#64748b;text-transform:uppercase;letter-spacing:.05em">Estado actual</p>
            <p style="margin:.5rem 0 0;font-size:1.4rem;font-weight:700;color:#3b82f6">Nueva</p>
            ${comentario ? `<p style="margin:.75rem 0 0;font-size:.85rem;color:#64748b;font-style:italic">"${comentario}"</p>` : ''}
        </div>
        ${contactBox()}
    `));
}

module.exports = { sendEmail, emailTicketCreado, emailEstadoCambiado, emailTicketAsignado, emailTicketReabierto };