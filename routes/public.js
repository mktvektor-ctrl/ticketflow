const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { emailTicketCreado } = require('../utils/email');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

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

router.get('/', (req, res) => {
    res.render('public/inicio');
});

router.get('/nueva-reclamacion', (req, res) => {
    res.render('public/nueva-reclamacion', { error: null, success: null });
});

router.post('/nueva-reclamacion', upload.array('archivos', 5), async (req, res) => {
    const { nombre, email, telefono, titulo, descripcion, categoria, prioridad } = req.body;

    if (!titulo || !descripcion || !nombre || !email || !telefono) {
        return res.render('public/nueva-reclamacion', {
            error: 'Todos los campos marcados con * son obligatorios',
            success: null
        });
    }

    const codigo = 'REC-' + Date.now().toString().slice(-8);

    try {
        const [result] = await db.execute(
            `INSERT INTO tickets (codigo, titulo, descripcion, categoria, prioridad, estado, nombre_cliente, email_cliente, telefono_cliente, creado_por)
             VALUES (?, ?, ?, ?, ?, 'Nueva', ?, ?, ?, 'publico')`,
            [codigo, titulo, descripcion, categoria || 'General', prioridad || 'Media', nombre, email, telefono, 'publico']
        );
        const ticketId = result.insertId;

        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                await db.execute(
                    `INSERT INTO adjuntos (ticket_id, nombre_original, nombre_archivo, tipo, tamanio) VALUES (?, ?, ?, ?, ?)`,
                    [ticketId, file.originalname, file.filename, file.mimetype, file.size]
                );
            }
        }

        await db.execute(
            `INSERT INTO ticket_historial (ticket_id, estado_anterior, estado_nuevo, usuario, comentario)
             VALUES (?, NULL, 'Nueva', 'sistema', 'Ticket creado por cliente')`,
            [ticketId]
        );

        emailTicketCreado(codigo, nombre, email);

        res.render('public/nueva-reclamacion', {
            error: null,
            success: codigo
        });

    } catch (err) {
        console.error(err);
        res.render('public/nueva-reclamacion', {
            error: 'Error al crear la reclamación',
            success: null
        });
    }
});

router.get('/consultar', async (req, res) => {
    const { codigo } = req.query;
    if (!codigo) {
        return res.render('public/consultar', { ticket: null, historial: null, adjuntos: null, comentarios: null, error: null });
    }

    try {
        const [tickets] = await db.execute(
            `SELECT t.*, a.nombre as area_nombre
             FROM tickets t
             LEFT JOIN areas a ON t.area_actual_id = a.id
             WHERE t.codigo = ?`, [codigo]
        );

        if (tickets.length === 0) {
            return res.render('public/consultar', {
                ticket: null, historial: null, adjuntos: null, comentarios: null,
                error: 'No se encontró ninguna reclamación con ese código'
            });
        }

        const [historial] = await db.execute(
            'SELECT * FROM ticket_historial WHERE ticket_id = ? ORDER BY fecha ASC',
            [tickets[0].id]
        );

        const [adjuntos] = await db.execute(
            'SELECT * FROM adjuntos WHERE ticket_id = ?',
            [tickets[0].id]
        );

        const [comentarios] = await db.execute(
            'SELECT * FROM comentarios WHERE ticket_id = ? AND es_interno = 0 ORDER BY fecha ASC',
            [tickets[0].id]
        );

        res.render('public/consultar', {
            ticket: tickets[0], historial, adjuntos, comentarios, error: null
        });

    } catch (err) {
        console.error(err);
        res.render('public/consultar', {
            ticket: null, historial: null, adjuntos: null, comentarios: null,
            error: 'Error del servidor'
        });
    }
});

router.post('/consultar', async (req, res) => {
    const { codigo } = req.body;

    try {
        const [tickets] = await db.execute(
            `SELECT t.*, a.nombre as area_nombre
             FROM tickets t
             LEFT JOIN areas a ON t.area_actual_id = a.id
             WHERE t.codigo = ?`,
            [codigo]
        );

        if (tickets.length === 0) {
            return res.render('public/consultar', {
                ticket: null, historial: null, adjuntos: null,
                error: 'No se encontró ninguna reclamación con ese código'
            });
        }

        const [historial] = await db.execute(
            `SELECT * FROM ticket_historial WHERE ticket_id = ? ORDER BY fecha ASC`,
            [tickets[0].id]
        );

        const [adjuntos] = await db.execute(
            `SELECT * FROM adjuntos WHERE ticket_id = ?`,
            [tickets[0].id]
        );

        const [comentarios] = await db.execute(
            'SELECT * FROM comentarios WHERE ticket_id = ? AND es_interno = 0 ORDER BY fecha ASC',
            [tickets[0].id]
        );

        res.render('public/consultar', {
            ticket: tickets[0], historial, adjuntos, comentarios, error: null
        });

    } catch (err) {
        console.error(err);
        res.render('public/consultar', {
            ticket: null, historial: null, adjuntos: null,
            error: 'Error del servidor'
        });
    }
});

router.post('/ticket/responder', async (req, res) => {
    const { codigo, mensaje, no_resuelto } = req.body;

    try {
        const [tickets] = await db.execute(
            'SELECT * FROM tickets WHERE codigo = ?', [codigo]
        );

        if (tickets.length === 0) {
            return res.redirect('/consultar');
        }

        const ticket = tickets[0];

        if (mensaje && mensaje.trim() !== '') {
            await db.execute(
                'INSERT INTO comentarios (ticket_id, usuario, mensaje, es_interno, es_cliente) VALUES (?, ?, ?, 0, 1)',
                [ticket.id, ticket.nombre_cliente, mensaje.trim()]
            );
        }

        if (no_resuelto === 'si' && (ticket.estado === 'Resuelta' || ticket.estado === 'Cerrada')) {
            await db.execute(
                `UPDATE tickets SET estado = 'Nueva', area_actual_id = NULL, asignado_a = NULL, fecha_cierre = NULL WHERE id = ?`,
                [ticket.id]
            );

            await db.execute(
                `INSERT INTO ticket_historial (ticket_id, estado_anterior, estado_nuevo, usuario, comentario)
                 VALUES (?, ?, 'Nueva', 'cliente', ?)`,
                [ticket.id, ticket.estado, mensaje || 'Cliente indica que no está resuelto']
            );

            const { emailTicketReabierto } = require('../utils/email');
            if (ticket.email_cliente) {
                emailTicketReabierto(ticket.codigo, ticket.nombre_cliente, ticket.email_cliente, 'El cliente ha indicado que el problema no está resuelto');
            }
        }

        res.redirect('/consultar?codigo=' + codigo);

    } catch (err) {
        console.error(err);
        res.status(500).send('Error procesando respuesta');
    }
});

router.post('/ticket/adjuntar', upload.array('archivos', 5), async (req, res) => {
    const { codigo } = req.body;

    try {
        const [tickets] = await db.execute(
            'SELECT * FROM tickets WHERE codigo = ?', [codigo]
        );

        if (tickets.length === 0) return res.redirect('/consultar');

        const ticket = tickets[0];

        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                await db.execute(
                    'INSERT INTO adjuntos (ticket_id, nombre_original, nombre_archivo, tipo, tamanio, subido_por) VALUES (?, ?, ?, ?, ?, ?)',
                    [ticket.id, file.originalname, file.filename, file.mimetype, file.size, ticket.nombre_cliente]
                );
            }
        }

        res.redirect('/consultar?codigo=' + codigo);

    } catch (err) {
        console.error(err);
        res.status(500).send('Error subiendo archivos');
    }
});

module.exports = router;