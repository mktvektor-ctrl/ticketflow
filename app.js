if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}
const express    = require('express');
const session    = require('express-session');
const bodyParser = require('body-parser');
const path       = require('path');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 8 }
}));

app.use((req, res, next) => {
    res.locals.currentUser = req.session.user || null;
    res.locals.currentRol  = req.session.rol  || null;
    res.locals.currentArea = req.session.area || null;
    next();
});

app.use('/',          require('./routes/public'));
app.use('/auth',      require('./routes/auth'));
app.use('/admin',     require('./routes/admin'));
app.use('/tecnico',   require('./routes/tecnico'));
app.use('/reportes',      require('./routes/reportes'));
app.use('/exportar',      require('./routes/exportar'));
app.use('/mantenimiento', require('./routes/mantenimiento'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 http://localhost:${PORT}`);
});