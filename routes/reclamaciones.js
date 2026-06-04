const express   = require('express');
const router    = express.Router();
const db        = require('../config/db');
const multer    = require('multer');
const sendEmail = require('../utils/email');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

const storage = multer.diskStorage({
    destination: 'public/uploads/',
    filename: (req, file, cb) => {
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}-${safeName}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
        cb(null, allowed.includes(file.mimetype));
    }
});

router.get('/kanban', async (req, res) => {
    try {
        const [data] = await db.execute('SELECT * FROM reclamaciones ORDER BY fecha DESC');
        res.render('kanban', { data });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error cargando reclamaciones');
    }
});

router.post('/crear', upload.single('archivo'), async (req, res) => {
    const { titulo, descripcion, prioridad } = req.body;

    if (!titulo || titulo.trim() === '') {
        return res.status(400).send('El título es obligatorio');
    }

    const codigo  = 'REC-' + Date.now().toString().slice(-6);
    const archivo = req.file ? req.file.filename : null;

    try {
        await db.execute(
            `INSERT INTO reclamaciones (codigo, titulo, descripcion, estado, prioridad, cliente, asignado_a, archivo)
             VALUES (?, ?, ?, 'Nueva', ?, ?, 'Sin asignar', ?)`,
            [codigo, titulo.trim(), descripcion, prioridad || 'Media', req.session.user, archivo]
        );
        sendEmail(process.env.MAIL_USER, `Nueva reclamación: ${codigo}`, `Creada: ${titulo}`);
        res.redirect('/reclamaciones/kanban');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error creando reclamación');
    }
});

router.post('/estado', async (req, res) => {
    const { id, estado } = req.body;
    const estadosValidos = ['Nueva', 'En proceso', 'Resuelta', 'Cerrada'];

    if (!estadosValidos.includes(estado)) {
        return res.status(400).json({ error: 'Estado inválido' });
    }

    try {
        await db.execute('UPDATE reclamaciones SET estado = ? WHERE id = ?', [estado, id]);
        sendEmail(process.env.MAIL_USER, `Reclamación #${id} actualizada`, `Nuevo estado: ${estado}`);
        res.json({ ok: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error actualizando estado' });
    }
});

router.get('/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).send('ID inválido');

    try {
        const [[rec]]       = await db.execute('SELECT * FROM reclamaciones WHERE id = ?', [id]);
        const [comentarios] = await db.execute(
            'SELECT * FROM comentarios WHERE reclamacion_id = ? ORDER BY fecha ASC', [id]
        );

        if (!rec) return res.status(404).send('Reclamación no encontrada');

        res.render('detalle', { rec, comentarios });
    } catch (err) {
        console.error(err);
        res.status(500).send('Error cargando detalle');
    }
});

router.post('/comentario', async (req, res) => {
    const { id, mensaje } = req.body;

    if (!mensaje || mensaje.trim() === '') {
        return res.redirect('/reclamaciones/' + id);
    }

    try {
        await db.execute(
            'INSERT INTO comentarios (reclamacion_id, usuario, mensaje) VALUES (?, ?, ?)',
            [id, req.session.user, mensaje.trim()]
        );
        res.redirect('/reclamaciones/' + id);
    } catch (err) {
        console.error(err);
        res.status(500).send('Error añadiendo comentario');
    }
});

module.exports = router;