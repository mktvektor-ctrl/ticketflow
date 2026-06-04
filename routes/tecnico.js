const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { emailEstadoCambiado, emailTicketAsignado } = require('../utils/email');
const multer = require('multer');
const fs     = require('fs');

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = 'public/uploads/tickets';
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}-${safeName}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 100 * 1024 * 1024 }
});

router.use(requireAuth);

// Dashboard técnico
router.get('/dashboard', async (req, res) => {
    try {
        const [pendientes] = await db.execute(`
            SELECT t.*, 
            TIMESTAMPDIFF(HOUR, t.fecha_creacion, NOW()) as horas_abierto
            FROM tickets t
            WHERE t.area_actual_id = ? 
            AND t.estado NOT IN ('Cerrada', 'Resuelta')
            ORDER BY t.fecha_creacion ASC
        `, [req.session.area]);

        const [gestionados] = await db.execute(`
            SELECT t.*, 
            TIMESTAMPDIFF(HOUR, t.fecha_creacion, IFNULL(t.fecha_cierre, NOW())) as horas_total
            FROM tickets t
            WHERE t.area_actual_id = ?
            AND t.estado IN ('Cerrada', 'Resuelta')
            ORDER BY t.fecha_creacion DESC
            LIMIT 20
        `, [req.session.area]);

        const [areas] = await db.execute(
            'SELECT * FROM areas WHERE activa = 1 AND id != ?', 
            [req.session.area]
        );

        const [[stats]] = await db.execute(`
            SELECT
                SUM(estado NOT IN ('Cerrada','Resuelta')) AS pendientes,
                SUM(estado = 'En proceso')                AS en_proceso,
                SUM(estado IN ('Cerrada','Resuelta'))     AS resueltos
            FROM tickets WHERE area_actual_id = ?
        `, [req.session.area]);

        res.render('tecnico/dashboard', { 
            pendientes, 
            gestionados, 
            areas, 
            stats,
            areaNombre: req.session.areaNombre 
        });

    } catch (err) {
        console.error(err);
        res.status(500).send('Error cargando dashboard');
    }
});

// Ver detalle de ticket
router.get('/ticket/:id', async (req, res) => {
    try {
        const [[ticket]] = await db.execute(`
            SELECT t.*, a.nombre as area_nombre
            FROM tickets t
            LEFT JOIN areas a ON t.area_actual_id = a.id
            WHERE t.id = ?`, [req.params.id]);

        if (!ticket) return res.status(404).send('Ticket no encontrado');

        if (ticket.area_actual_id != req.session.area) {
            return res.status(403).send('No tienes acceso a este ticket');
        }

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

        const [areas] = await db.execute(
            'SELECT * FROM areas WHERE activa = 1 AND id != ?', [req.session.area]);

        res.render('tecnico/ticket', { ticket, historial, comentarios, adjuntos, areas });

    } catch (err) {
        console.error(err);
        res.status(500).send('Error cargando ticket');
    }
});

// Tomar ticket (En proceso)
router.post('/ticket/:id/tomar', async (req, res) => {
    const id = req.params.id;
    try {
        const [[ticket]] = await db.execute('SELECT * FROM tickets WHERE id = ?', [id]);

        await db.execute(
            `UPDATE tickets SET estado = 'En proceso' WHERE id = ?`, [id]
        );

        await db.execute(
            `INSERT INTO ticket_historial (ticket_id, estado_anterior, estado_nuevo, area_anterior_id, area_nueva_id, usuario, comentario)
             VALUES (?, ?, 'En proceso', ?, ?, ?, 'Ticket tomado por técnico')`,
            [id, ticket.estado, req.session.area, req.session.area, req.session.user]
        );

        res.redirect('/tecnico/ticket/' + id);

    } catch (err) {
        console.error(err);
        res.status(500).send('Error tomando ticket');
    }
});

// Reasignar a otra área
router.post('/ticket/:id/reasignar', async (req, res) => {
    const { area_id, comentario } = req.body;
    const id = req.params.id;

    try {
        const [[ticket]] = await db.execute('SELECT * FROM tickets WHERE id = ?', [id]);

        await db.execute(
            `UPDATE tickets SET estado = 'Asignada', area_actual_id = ? WHERE id = ?`,
            [area_id, id]
        );

        await db.execute(
            `INSERT INTO ticket_historial (ticket_id, estado_anterior, estado_nuevo, area_anterior_id, area_nueva_id, usuario, comentario)
             VALUES (?, ?, 'Asignada', ?, ?, ?, ?)`,
            [id, ticket.estado, req.session.area, area_id, req.session.user, comentario || 'Reasignado a otra área']
        );

        const [[area]] = await db.execute('SELECT * FROM areas WHERE id = ?', [area_id]);
        const [tecnicos] = await db.execute(
            'SELECT email FROM usuarios WHERE area_id = ? AND activo = 1 AND email IS NOT NULL', [area_id]
        );
        tecnicos.forEach(t => emailTicketAsignado(ticket.codigo, ticket.titulo, t.email, area.nombre));

        if (ticket.email_cliente) {
            emailEstadoCambiado(ticket.codigo, ticket.nombre_cliente, ticket.email_cliente, 'Asignada', comentario);
        }

        res.redirect('/tecnico/dashboard');

    } catch (err) {
        console.error(err);
        res.status(500).send('Error reasignando ticket');
    }
});

// Resolver ticket
router.post('/ticket/:id/resolver', async (req, res) => {
    const { comentario } = req.body;
    const id = req.params.id;

    try {
        const [[ticket]] = await db.execute('SELECT * FROM tickets WHERE id = ?', [id]);

        await db.execute(
            `UPDATE tickets SET estado = 'Resuelta', fecha_cierre = NOW() WHERE id = ?`, [id]
        );

        await db.execute(
            `INSERT INTO ticket_historial (ticket_id, estado_anterior, estado_nuevo, area_anterior_id, usuario, comentario)
             VALUES (?, ?, 'Resuelta', ?, ?, ?)`,
            [id, ticket.estado, req.session.area, req.session.user, comentario || 'Ticket resuelto']
        );

        if (ticket.email_cliente) {
            emailEstadoCambiado(ticket.codigo, ticket.nombre_cliente, ticket.email_cliente, 'Resuelta', comentario);
        }

        res.redirect('/tecnico/dashboard');

    } catch (err) {
        console.error(err);
        res.status(500).send('Error resolviendo ticket');
    }
});

// Añadir comentario
router.post('/ticket/:id/comentario', upload.array('archivos', 5), async (req, res) => {
    const { mensaje } = req.body;
    try {
        await db.execute(
            'INSERT INTO comentarios (ticket_id, usuario, mensaje, es_interno) VALUES (?, ?, ?, 1)',
            [req.params.id, req.session.user, mensaje]
        );

        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                await db.execute(
                    `INSERT INTO adjuntos (ticket_id, nombre_original, nombre_archivo, tipo, tamanio, subido_por) VALUES (?, ?, ?, ?, ?, ?)`,
                    [req.params.id, file.originalname, file.filename, file.mimetype, file.size, req.session.user]
                );
            }
        }

        res.redirect('/tecnico/ticket/' + req.params.id);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error añadiendo comentario');
    }
});

module.exports = router;