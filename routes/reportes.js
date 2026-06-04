const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.use(requireAuth);
router.use(requireAdmin);

router.get('/', async (req, res) => {
    try {
        // Tiempo promedio de resolución general
        const [[tiempos]] = await db.execute(`
            SELECT
                ROUND(AVG(TIMESTAMPDIFF(MINUTE, fecha_creacion, fecha_cierre)) / 60, 2) AS promedio_min,
                ROUND(MIN(TIMESTAMPDIFF(MINUTE, fecha_creacion, fecha_cierre)) / 60, 2) AS minimo_min,
                ROUND(MAX(TIMESTAMPDIFF(MINUTE, fecha_creacion, fecha_cierre)) / 60, 2) AS maximo_min,
                COUNT(*) AS total_cerrados
            FROM tickets
            WHERE estado IN ('Cerrada','Resuelta') AND fecha_cierre IS NOT NULL AND fecha_creacion IS NOT NULL
        `);

        // Tickets por área con tiempos
        const [porArea] = await db.execute(`
            SELECT 
                a.nombre as area,
                COUNT(t.id) as total,
                SUM(t.estado NOT IN ('Cerrada','Resuelta')) as pendientes,
                SUM(t.estado IN ('Cerrada','Resuelta')) as resueltos,
                ROUND(AVG(TIMESTAMPDIFF(HOUR, t.fecha_creacion, IFNULL(t.fecha_cierre, NOW()))), 1) as promedio_horas
            FROM areas a
            LEFT JOIN tickets t ON t.area_actual_id = a.id
            GROUP BY a.id, a.nombre
        `);

        // Tickets por prioridad
        const [porPrioridad] = await db.execute(`
            SELECT 
                prioridad,
                COUNT(*) as total,
                SUM(estado NOT IN ('Cerrada','Resuelta')) as pendientes,
                ROUND(AVG(TIMESTAMPDIFF(HOUR, fecha_creacion, IFNULL(fecha_cierre, NOW()))), 1) as promedio_horas
            FROM tickets
            GROUP BY prioridad
        `);

        // Tickets por estado
        const [porEstado] = await db.execute(`
            SELECT estado, COUNT(*) as total
            FROM tickets
            GROUP BY estado
        `);

        // Tickets por día últimos 30 días
        const [porDia] = await db.execute(`
            SELECT 
                DATE(fecha_creacion) as dia,
                COUNT(*) as total
            FROM tickets
            WHERE fecha_creacion >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY DATE(fecha_creacion)
            ORDER BY dia ASC
        `);

        // Tickets pendientes más antiguos
        const [masAntiguos] = await db.execute(`
            SELECT t.*, a.nombre as area_nombre,
            TIMESTAMPDIFF(HOUR, t.fecha_creacion, NOW()) as horas_abierto
            FROM tickets t
            LEFT JOIN areas a ON t.area_actual_id = a.id
            WHERE t.estado NOT IN ('Cerrada','Resuelta')
            ORDER BY t.fecha_creacion ASC
            LIMIT 10
        `);

        res.render('reportes/index', { 
            tiempos, 
            porArea, 
            porPrioridad, 
            porEstado,
            porDia,
            masAntiguos 
        });

    } catch (err) {
        console.error(err);
        res.status(500).send('Error cargando reportes');
    }
});

module.exports = router;