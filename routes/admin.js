const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const bcrypt  = require('bcrypt');
const { emailEstadoCambiado, emailTicketAsignado, emailTicketReabierto } = require('../utils/email');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.use(requireAuth);
router.use(requireAdmin);

// Dashboard
router.get('/dashboard', async (req, res) => {
    try {
        const [[stats]] = await db.execute(`
            SELECT
                COUNT(*) AS total,
                SUM(estado = 'Nueva')                                    AS nuevas,
                SUM(estado = 'Asignada')                                 AS asignadas,
                SUM(estado = 'En proceso')                               AS en_proceso,
                SUM(estado = 'Resuelta')                                 AS resueltas,
                SUM(estado = 'Cerrada')                                  AS cerradas,
                SUM(prioridad = 'Critica' AND estado NOT IN ('Cerrada','Resuelta')) AS criticas_pendientes,
                SUM(DATE(fecha_creacion) = CURDATE())                    AS creados_hoy,
                SUM(fecha_creacion >= DATE_SUB(NOW(), INTERVAL 7 DAY))   AS creados_semana,
                SUM(fecha_creacion >= DATE_SUB(NOW(), INTERVAL 30 DAY))  AS creados_mes,
                ROUND(AVG(TIMESTAMPDIFF(HOUR, fecha_creacion, IFNULL(fecha_cierre, NOW()))), 1) AS promedio_horas,
                ROUND(SUM(estado = 'Cerrada') / COUNT(*) * 100, 1)       AS tasa_resolucion
            FROM tickets
        `);

        const [[vencidos]] = await db.execute(`
            SELECT COUNT(*) AS total FROM tickets
            WHERE estado NOT IN ('Cerrada','Resuelta')
            AND TIMESTAMPDIFF(DAY, fecha_creacion, NOW()) > 3
        `);

        const [porArea] = await db.execute(`
            SELECT a.nombre, COUNT(t.id) as total,
            SUM(t.estado NOT IN ('Cerrada','Resuelta')) as pendientes
            FROM areas a
            LEFT JOIN tickets t ON t.area_actual_id = a.id
            GROUP BY a.id, a.nombre
            ORDER BY pendientes DESC
        `);

        const [porDia] = await db.execute(`
            SELECT DATE(fecha_creacion) as dia, COUNT(*) as total
            FROM tickets
            WHERE fecha_creacion >= DATE_SUB(NOW(), INTERVAL 14 DAY)
            GROUP BY DATE(fecha_creacion)
            ORDER BY dia ASC
        `);

        const [porEstado] = await db.execute(`
            SELECT estado, COUNT(*) as total FROM tickets GROUP BY estado
        `);

        const [porPrioridad] = await db.execute(`
            SELECT prioridad, COUNT(*) as total FROM tickets GROUP BY prioridad
        `);

        const { busqueda, estado, prioridad, area } = req.query;

        let query = `
            SELECT t.*, a.nombre as area_nombre,
            TIMESTAMPDIFF(HOUR, t.fecha_creacion, NOW()) as horas_abierto
            FROM tickets t
            LEFT JOIN areas a ON t.area_actual_id = a.id
            WHERE 1=1
        `;
        const params = [];

        if (busqueda) {
            query += ` AND (t.codigo LIKE ? OR t.titulo LIKE ? OR t.nombre_cliente LIKE ?)`;
            params.push(`%${busqueda}%`, `%${busqueda}%`, `%${busqueda}%`);
        }
        if (estado === 'todos') {
            // no filtrar
        } else if (estado) {
            query += ` AND t.estado = ?`;
            params.push(estado);
        } else {
            query += ` AND t.estado NOT IN ('Cerrada','Resuelta')`;
        }
        if (prioridad) {
            query += ` AND t.prioridad = ?`;
            params.push(prioridad);
        }
        if (area) {
            query += ` AND t.area_actual_id = ?`;
            params.push(area);
        }

        query += ` ORDER BY t.fecha_creacion ASC`;

        const [tickets] = await db.execute(query, params);
        const [areas]   = await db.execute('SELECT * FROM areas WHERE activa = 1');

        res.render('admin/dashboard', {
            stats, tickets, areas, vencidos,
            porArea, porDia, porEstado, porPrioridad,
            filtros: { busqueda, estado, prioridad, area }
        });

    } catch (err) {
        console.error(err);
        res.status(500).send('Error cargando dashboard');
    }
});
//
// Ver detalle de ticket
router.get('/ticket/:id', async (req, res) => {
    try {
        const [[ticket]] = await db.execute(`
            SELECT t.*, a.nombre as area_nombre, u.nombre as asignado_nombre, u.username as asignado_username
            FROM tickets t
            LEFT JOIN areas a ON t.area_actual_id = a.id
            LEFT JOIN usuarios u ON t.asignado_a = u.id
            WHERE t.id = ?`, [req.params.id]);

        if (!ticket) return res.status(404).send('Ticket no encontrado');

        const [historial] = await db.execute(
            `SELECT h.*, a1.nombre as area_anterior_nombre, a2.nombre as area_nueva_nombre
             FROM ticket_historial h
             LEFT JOIN areas a1 ON h.area_anterior_id = a1.id
             LEFT JOIN areas a2 ON h.area_nueva_id = a2.id
             WHERE h.ticket_id = ? ORDER BY h.fecha ASC`, [ticket.id]);

        const [comentarios] = await db.execute(
            'SELECT * FROM comentarios WHERE ticket_id = ? ORDER BY fecha ASC', [ticket.id]);

        const [adjuntos] = await db.execute(
            'SELECT * FROM adjuntos WHERE ticket_id = ? ORDER BY fecha ASC', [ticket.id]);

        const [areas] = await db.execute('SELECT * FROM areas WHERE activa = 1');

        res.render('admin/ticket', { ticket, historial, comentarios, adjuntos, areas });

    } catch (err) {
        console.error(err);
        res.status(500).send('Error cargando ticket');
    }
});

// Asignar ticket a área
router.post('/ticket/:id/asignar', async (req, res) => {
    const { area_id, usuario_id, comentario } = req.body;
    const id = req.params.id;

    try {
        const [[ticket]] = await db.execute('SELECT * FROM tickets WHERE id = ?', [id]);

        await db.execute(
            `UPDATE tickets SET estado = 'Asignada', area_actual_id = ?, asignado_a = ? WHERE id = ?`,
            [area_id, usuario_id || null, id]
        );

        await db.execute(
            `INSERT INTO ticket_historial (ticket_id, estado_anterior, estado_nuevo, area_anterior_id, area_nueva_id, usuario, comentario)
             VALUES (?, ?, 'Asignada', ?, ?, ?, ?)`,
            [id, ticket.estado, ticket.area_actual_id, area_id, req.session.user, comentario || 'Ticket asignado']
        );

        const [[area]] = await db.execute('SELECT * FROM areas WHERE id = ?', [area_id]);
        const [tecnicos] = await db.execute(
            'SELECT email FROM usuarios WHERE area_id = ? AND activo = 1 AND email IS NOT NULL', [area_id]
        );
        tecnicos.forEach(t => emailTicketAsignado(ticket.codigo, ticket.titulo, t.email, area.nombre));

        if (ticket.email_cliente) {
            emailEstadoCambiado(ticket.codigo, ticket.nombre_cliente, ticket.email_cliente, 'Asignada', comentario);
        }

        res.redirect('/admin/ticket/' + id);

    } catch (err) {
        console.error(err);
        res.status(500).send('Error asignando ticket');
    }
});
// Cerrar ticket
router.post('/ticket/:id/cerrar', async (req, res) => {
    const { comentario } = req.body;
    const id = req.params.id;

    try {
        const [[ticket]] = await db.execute('SELECT * FROM tickets WHERE id = ?', [id]);

        await db.execute(
            `UPDATE tickets SET estado = 'Cerrada', fecha_cierre = NOW() WHERE id = ?`, [id]
        );

        await db.execute(
            `INSERT INTO ticket_historial (ticket_id, estado_anterior, estado_nuevo, area_anterior_id, usuario, comentario)
             VALUES (?, ?, 'Cerrada', ?, ?, ?)`,
            [id, ticket.estado, ticket.area_actual_id, req.session.user, comentario || 'Ticket cerrado']
        );

        if (ticket.email_cliente) {
            emailEstadoCambiado(ticket.codigo, ticket.nombre_cliente, ticket.email_cliente, 'Cerrada', comentario);
        }

        res.redirect('/admin/dashboard');

    } catch (err) {
        console.error(err);
        res.status(500).send('Error cerrando ticket');
    }
});

// Añadir comentario
router.post('/ticket/:id/comentario', async (req, res) => {
    const { mensaje, enviar_cliente } = req.body;
    try {
        const es_interno = enviar_cliente === 'si' ? 0 : 1;

        await db.execute(
            'INSERT INTO comentarios (ticket_id, usuario, mensaje, es_interno, es_cliente) VALUES (?, ?, ?, ?, 0)',
            [req.params.id, req.session.user, mensaje, es_interno]
        );

        if (enviar_cliente === 'si') {
            const [[ticket]] = await db.execute('SELECT * FROM tickets WHERE id = ?', [req.params.id]);
            if (ticket.email_cliente) {
                const { sendEmail } = require('../utils/email');
                sendEmail(ticket.email_cliente, `Mensaje sobre tu reclamación ${ticket.codigo}`, `
                    <div style="font-family:system-ui,sans-serif;max-width:600px;margin:0 auto">
                        <div style="background:#0f172a;padding:1.5rem 2rem;border-radius:12px 12px 0 0">
                            <h1 style="color:white;font-size:1.3rem;margin:0">Ticket<span style="color:#3b82f6">Flow</span></h1>
                        </div>
                        <div style="background:white;padding:2rem;border:1px solid #e2e8f0;border-radius:0 0 12px 12px">
                            <h2 style="color:#111;font-size:1rem;margin:0 0 1rem">El equipo técnico te ha enviado un mensaje</h2>
                            <p style="color:#334155;margin:0 0 1rem">Reclamación: <strong>${ticket.codigo}</strong></p>
                            <div style="background:#f1f5f9;border-radius:8px;padding:1rem;margin:1rem 0;font-size:.9rem;color:#334155">
                                ${mensaje}
                            </div>
                            <p style="font-size:.85rem;color:#64748b">Puedes responder en: <a href="https://reclamaciones.vektormkt.es/consultar?codigo=${ticket.codigo}">reclamaciones.vektormkt.es</a></p>
                        </div>
                    </div>
                `);
            }
        }

        res.redirect('/admin/ticket/' + req.params.id);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error añadiendo comentario');
    }
});

// ── GESTIÓN DE ÁREAS ──

router.get('/areas', async (req, res) => {
    const [areas] = await db.execute('SELECT * FROM areas ORDER BY created_at DESC');
    res.render('admin/areas', { areas });
});

router.post('/areas/crear', async (req, res) => {
    const { nombre, descripcion } = req.body;
    await db.execute('INSERT INTO areas (nombre, descripcion) VALUES (?, ?)', [nombre, descripcion]);
    res.redirect('/admin/areas');
});

router.post('/areas/:id/eliminar', async (req, res) => {
    await db.execute('UPDATE areas SET activa = 0 WHERE id = ?', [req.params.id]);
    res.redirect('/admin/areas');
});

// ── GESTIÓN DE USUARIOS ──

router.get('/usuarios', async (req, res) => {
    const [usuarios] = await db.execute(`
        SELECT u.*, a.nombre as area_nombre
        FROM usuarios u
        LEFT JOIN areas a ON u.area_id = a.id
        ORDER BY u.created_at DESC
    `);
    const [areas] = await db.execute('SELECT * FROM areas WHERE activa = 1');
    res.render('admin/usuarios', { usuarios, areas });
});

router.post('/usuarios/crear', async (req, res) => {
    const { username, password, nombre, email, rol, area_id } = req.body;
    const hash = await bcrypt.hash(password, 12);
    await db.execute(
        'INSERT INTO usuarios (username, password, nombre, email, rol, area_id) VALUES (?,?,?,?,?,?)',
        [username, hash, nombre, email, rol, area_id || null]
    );
    res.redirect('/admin/usuarios');
});

router.post('/usuarios/:id/eliminar', async (req, res) => {
    await db.execute('UPDATE usuarios SET activo = 0 WHERE id = ?', [req.params.id]);
    res.redirect('/admin/usuarios');
});
router.post('/ticket/:id/reabrir', async (req, res) => {
    const { comentario } = req.body;
    const id = req.params.id;

    try {
        const [[ticket]] = await db.execute('SELECT * FROM tickets WHERE id = ?', [id]);

        if (!ticket) return res.status(404).send('Ticket no encontrado');
        if (ticket.estado !== 'Cerrada' && ticket.estado !== 'Resuelta') {
            return res.status(400).send('El ticket no está cerrado');
        }

        await db.execute(
            `UPDATE tickets SET estado = 'Nueva', area_actual_id = NULL, fecha_cierre = NULL WHERE id = ?`, [id]
        );

        await db.execute(
            `INSERT INTO ticket_historial (ticket_id, estado_anterior, estado_nuevo, area_anterior_id, usuario, comentario)
             VALUES (?, ?, 'Nueva', ?, ?, ?)`,
            [id, ticket.estado, ticket.area_actual_id, req.session.user, comentario || 'Ticket reabierto']
        );

        if (ticket.email_cliente) {
            emailTicketReabierto(ticket.codigo, ticket.nombre_cliente, ticket.email_cliente, comentario);
        }

        res.redirect('/admin/ticket/' + id);

    } catch (err) {
        console.error(err);
        res.status(500).send('Error reabriendo ticket');
    }
});
router.get('/usuarios/:id/editar', async (req, res) => {
    try {
        const [[usuario]] = await db.execute('SELECT * FROM usuarios WHERE id = ?', [req.params.id]);
        const [areas] = await db.execute('SELECT * FROM areas WHERE activa = 1');
        res.render('admin/editar-usuario', { usuario, areas });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error cargando usuario');
    }
});

router.post('/usuarios/:id/editar', async (req, res) => {
    const { nombre, email, rol, area_id, password } = req.body;
    try {
        if (password && password.trim() !== '') {
            const hash = await bcrypt.hash(password, 12);
            await db.execute(
                'UPDATE usuarios SET nombre=?, email=?, rol=?, area_id=?, password=? WHERE id=?',
                [nombre, email, rol, area_id || null, hash, req.params.id]
            );
        } else {
            await db.execute(
                'UPDATE usuarios SET nombre=?, email=?, rol=?, area_id=? WHERE id=?',
                [nombre, email, rol, area_id || null, req.params.id]
            );
        }
        res.redirect('/admin/usuarios');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error actualizando usuario');
    }
});
router.get('/tecnicos-por-area/:area_id', async (req, res) => {
    try {
        const [tecnicos] = await db.execute(
            'SELECT id, username, nombre FROM usuarios WHERE area_id = ? AND activo = 1 AND rol = ?',
            [req.params.area_id, 'tecnico']
        );
        res.json(tecnicos);
    } catch (err) {
        console.error(err);
        res.json([]);
    }
});
module.exports = router;