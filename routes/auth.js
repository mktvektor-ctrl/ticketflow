const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcrypt');
const db      = require('../config/db');

router.get('/login', (req, res) => {
    if (req.session.user) {
        if (req.session.rol === 'admin') return res.redirect('/admin/dashboard');
        return res.redirect('/tecnico/dashboard');
    }
    res.render('auth/login', { error: null });
});

router.post('/login', async (req, res) => {
    const { user, pass } = req.body;

    if (!user || !pass) {
        return res.render('auth/login', { error: 'Rellena todos los campos' });
    }

    try {
        const [rows] = await db.execute(
            `SELECT u.*, a.nombre as area_nombre 
             FROM usuarios u 
             LEFT JOIN areas a ON u.area_id = a.id
             WHERE u.username = ? AND u.activo = 1`, [user]
        );

        if (rows.length === 0) {
            return res.render('auth/login', { error: 'Usuario o contraseña incorrectos' });
        }

        const match = await bcrypt.compare(pass, rows[0].password);
        if (!match) {
            return res.render('auth/login', { error: 'Usuario o contraseña incorrectos' });
        }

        req.session.user     = rows[0].username;
        req.session.rol      = rows[0].rol;
        req.session.area     = rows[0].area_id;
        req.session.areaNombre = rows[0].area_nombre;
        req.session.nombre   = rows[0].nombre;
        req.session.userId   = rows[0].id;

        if (rows[0].rol === 'admin') return res.redirect('/admin/dashboard');
        res.redirect('/tecnico/dashboard');

    } catch (err) {
        console.error(err);
        res.render('auth/login', { error: 'Error del servidor' });
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

module.exports = router;