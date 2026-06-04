const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/', async (req, res) => {
    try {
        const [[stats]] = await db.execute(`
            SELECT
                COUNT(*) AS total,
                SUM(estado = 'Nueva')      AS abiertas,
                SUM(estado = 'En proceso') AS proceso,
                SUM(estado = 'Resuelta')   AS resueltas,
                SUM(estado = 'Cerrada')    AS cerradas,
                SUM(prioridad = 'Critica') AS criticas
            FROM reclamaciones
        `);

        const [recientes] = await db.execute(
            'SELECT id, codigo, titulo, estado, fecha FROM reclamaciones ORDER BY fecha DESC LIMIT 5'
        );

        res.render('dashboard', { stats, recientes });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error cargando dashboard');
    }
});

module.exports = router;