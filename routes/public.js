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

router.get('/consultar', (req, res) => {
    res.render('public/consultar', { ticket: null, historial: null, adjuntos: null, error: null });
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

        res.render('public/consultar', {
            ticket: tickets[0], historial, adjuntos, error: null
        });

    } catch (err) {
        console.error(err);
        res.render('public/consultar', {
            ticket: null, historial: null, adjuntos: null,
            error: 'Error del servidor'
        });
    }
});

module.exports = router;