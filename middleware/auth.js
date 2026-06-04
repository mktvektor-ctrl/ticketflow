function requireAuth(req, res, next) {
    if (!req.session.user) {
        return res.redirect('/auth/login');
    }
    next();
}

function requireAdmin(req, res, next) {
    if (req.session.rol !== 'admin') {
        return res.status(403).send('Acceso denegado');
    }
    next();
}

module.exports = { requireAuth, requireAdmin };