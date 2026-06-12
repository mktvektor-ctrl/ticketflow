const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.use(requireAuth);
router.use(requireAdmin);

// Dashboard de mantenimiento
router.get('/', async (req, res) => {
    try {
        // Estadísticas por tabla
        const [tablas] = await db.execute(`
            SELECT table_name, table_rows,
            ROUND((data_length + index_length) / 1024 / 1024, 2) AS size_mb
            FROM information_schema.tables
            WHERE table_schema = ?
            ORDER BY (data_length + index_length) DESC
        `, [process.env.DB_NAME]);

        // Totales reales
        const [[tTickets]]     = await db.execute('SELECT COUNT(*) as total FROM tickets');
        const [[tUsuarios]]    = await db.execute('SELECT COUNT(*) as total FROM usuarios');
        const [[tComentarios]] = await db.execute('SELECT COUNT(*) as total FROM comentarios');
        const [[tAdjuntos]]    = await db.execute('SELECT COUNT(*) as total FROM adjuntos');
        const [[tHistorial]]   = await db.execute('SELECT COUNT(*) as total FROM ticket_historial');

        // Tickets cerrados por antigüedad
        const [[cerrados30]]  = await db.execute(`SELECT COUNT(*) as total FROM tickets WHERE estado IN ('Cerrada','Resuelta') AND fecha_cierre < DATE_SUB(NOW(), INTERVAL 30 DAY)`);
        const [[cerrados90]]  = await db.execute(`SELECT COUNT(*) as total FROM tickets WHERE estado IN ('Cerrada','Resuelta') AND fecha_cierre < DATE_SUB(NOW(), INTERVAL 90 DAY)`);
        const [[cerrados180]] = await db.execute(`SELECT COUNT(*) as total FROM tickets WHERE estado IN ('Cerrada','Resuelta') AND fecha_cierre < DATE_SUB(NOW(), INTERVAL 180 DAY)`);

        res.render('admin/mantenimiento', {
            tablas,
            stats: {
                tickets:     tTickets.total,
                usuarios:    tUsuarios.total,
                comentarios: tComentarios.total,
                adjuntos:    tAdjuntos.total,
                historial:   tHistorial.total
            },
            cerrados: {
                dias30:  cerrados30.total,
                dias90:  cerrados90.total,
                dias180: cerrados180.total
            }
        });

    } catch (err) {
        console.error(err);
        res.status(500).send('Error cargando mantenimiento');
    }
});

// Descargar backup SQL completo
router.get('/backup/completo', async (req, res) => {
    try {
        const tablas = ['areas', 'usuarios', 'tickets', 'ticket_historial', 'comentarios', 'adjuntos'];
        let sql = `-- TicketFlow Backup\n-- Fecha: ${new Date().toISOString()}\n-- Base de datos: ${process.env.DB_NAME}\n\nSET FOREIGN_KEY_CHECKS=0;\n\n`;

        for (const tabla of tablas) {
            const [rows] = await db.execute(`SELECT * FROM ${tabla}`);
            const [cols] = await db.execute(`SHOW COLUMNS FROM ${tabla}`);

            sql += `-- Tabla: ${tabla}\n`;
            sql += `TRUNCATE TABLE ${tabla};\n`;

            if (rows.length > 0) {
                const columnas = cols.map(c => `\`${c.Field}\``).join(', ');
                for (const row of rows) {
                    const valores = cols.map(c => {
                        const val = row[c.Field];
                        if (val === null) return 'NULL';
                        if (typeof val === 'number') return val;
                        return `'${String(val).replace(/'/g, "\\'")}'`;
                    }).join(', ');
                    sql += `INSERT INTO \`${tabla}\` (${columnas}) VALUES (${valores});\n`;
                }
            }
            sql += '\n';
        }

        sql += 'SET FOREIGN_KEY_CHECKS=1;\n';

        const fecha = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'application/sql');
        res.setHeader('Content-Disposition', `attachment; filename=ticketflow_backup_${fecha}.sql`);
        res.send(sql);

    } catch (err) {
        console.error(err);
        res.status(500).send('Error generando backup');
    }
});

// Descargar backup solo tickets
router.get('/backup/tickets', async (req, res) => {
    try {
        const [tickets]   = await db.execute('SELECT * FROM tickets');
        const [historial] = await db.execute('SELECT * FROM ticket_historial');
        const [comentarios] = await db.execute('SELECT * FROM comentarios');

        const fecha = new Date().toISOString().slice(0, 10);
        const datos = { fecha, tickets, historial, comentarios };

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=ticketflow_tickets_${fecha}.json`);
        res.send(JSON.stringify(datos, null, 2));

    } catch (err) {
        console.error(err);
        res.status(500).send('Error generando backup de tickets');
    }
});

// Limpiar tickets cerrados
router.post('/limpiar/tickets', async (req, res) => {
    const { dias } = req.body;
    try {
        const [tickets] = await db.execute(
            `SELECT id FROM tickets WHERE estado IN ('Cerrada','Resuelta') AND fecha_cierre < DATE_SUB(NOW(), INTERVAL ? DAY)`,
            [parseInt(dias)]
        );

        if (tickets.length === 0) {
            return res.json({ ok: true, eliminados: 0 });
        }

        const ids = tickets.map(t => t.id);
        await db.execute(`DELETE FROM tickets WHERE id IN (${ids.join(',')})`);

        res.json({ ok: true, eliminados: ids.length });

    } catch (err) {
        console.error(err);
        res.json({ ok: false, error: err.message });
    }
});

// Enviar backup por email
router.post('/backup/email', async (req, res) => {
    try {
        const tablas = ['areas', 'usuarios', 'tickets', 'ticket_historial', 'comentarios', 'adjuntos'];
        let sql = `-- TicketFlow Backup\n-- Fecha: ${new Date().toISOString()}\n\nSET FOREIGN_KEY_CHECKS=0;\n\n`;

        for (const tabla of tablas) {
            const [rows] = await db.execute(`SELECT * FROM ${tabla}`);
            const [cols] = await db.execute(`SHOW COLUMNS FROM ${tabla}`);

            sql += `-- Tabla: ${tabla}\n`;
            sql += `TRUNCATE TABLE ${tabla};\n`;

            if (rows.length > 0) {
                const columnas = cols.map(c => `\`${c.Field}\``).join(', ');
                for (const row of rows) {
                    const valores = cols.map(c => {
                        const val = row[c.Field];
                        if (val === null) return 'NULL';
                        if (typeof val === 'number') return val;
                        return `'${String(val).replace(/'/g, "\\'")}'`;
                    }).join(', ');
                    sql += `INSERT INTO \`${tabla}\` (${columnas}) VALUES (${valores});\n`;
                }
            }
            sql += '\n';
        }

        sql += 'SET FOREIGN_KEY_CHECKS=1;\n';

        const { sendEmail } = require('../utils/email');
        const fecha = new Date().toISOString().slice(0, 10);

        await sendEmail(
            process.env.MAIL_USER || req.body.email,
            `TicketFlow Backup — ${fecha}`,
            `<p>Adjunto encontrarás el backup de la base de datos generado el ${fecha}.</p>
             <p>Tamaño del backup: ${(sql.length / 1024).toFixed(1)} KB</p>
             <pre style="background:#f1f5f9;padding:1rem;border-radius:8px;font-size:.8rem;max-height:200px;overflow:auto">${sql.slice(0, 500)}...</pre>
             <p style="color:#64748b;font-size:.85rem">TicketFlow — Sistema de gestión de reclamaciones</p>`
        );

        res.json({ ok: true });

    } catch (err) {
        console.error(err);
        res.json({ ok: false, error: err.message });
    }
});

module.exports = router;