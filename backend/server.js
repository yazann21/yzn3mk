require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// إعدادات أساسية
app.set('trust proxy', 1);
app.use(cors({ origin: 'https://yzn3mk.onrender.com', credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// جلسة بسيطة (بدون قاعدة بيانات)
app.use(session({
    secret: 'test_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: true, httpOnly: true, sameSite: 'none', maxAge: 60000 }
}));

// مسارات مؤقتة للاختبار
app.get('/api/user', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    res.json({ username: req.session.username });
});

app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    if (email === 'test@example.com' && password === '123') {
        req.session.userId = 1;
        req.session.username = 'TestUser';
        res.json({ success: true, username: 'TestUser' });
    } else {
        res.status(401).json({ error: 'بيانات غير صحيحة' });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

app.get('/api/bots', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    res.json({ bots: [] });
});

app.post('/api/create-bot-cloud', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    res.json({ success: true, botId: 1 });
});

app.listen(PORT, () => console.log(`✅ Test server running on port ${PORT}`));