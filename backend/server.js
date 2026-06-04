require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const { Authflow } = require('prismarine-auth');
const { startBot, stopBot, getBotLogs, getBotStats, getBotInventory, sendCommand, deleteBot, botProcesses } = require('./bot-starter');

const app = express();
const PORT = process.env.PORT || 3000;

// ⭐ 1. الثقة بالوسيط (proxy) – ضروري لـ Render
app.set('trust proxy', 1);

// ⭐ 2. CORS مع تحديد النطاق الحقيقي وإرسال credentials
app.use(cors({
    origin: 'https://yzn3mk.onrender.com',   // النطاق الخاص بموقعك
    credentials: true
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// ⭐ 3. إعدادات الجلسة المناسبة للإنتاج
app.use(session({
    store: new SQLiteStore({ db: 'sessions.db', table: 'sessions' }),
    secret: process.env.SESSION_SECRET || 'super_secret_key_change_this',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: true,      // لأن Render يستخدم HTTPS
        httpOnly: true,
        sameSite: 'none',  // ضروري للـ cross‑origin
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
}));

// قاعدة البيانات
const db = new sqlite3.Database(path.join(__dirname, 'bots.db'));
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        email TEXT UNIQUE,
        password TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS bots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        bot_name TEXT,
        bot_type TEXT,
        server_ip TEXT,
        team_names TEXT DEFAULT '',
        version TEXT DEFAULT '1.21.10',
        status TEXT DEFAULT 'stopped',
        mc_token TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )`);
});

// ---------- تسجيل حساب جديد ----------
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
        return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
    }
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (username, email, password) VALUES (?, ?, ?)`, [username, email, hashedPassword], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) {
                    return res.status(400).json({ error: 'اسم المستخدم أو البريد موجود مسبقاً' });
                }
                return res.status(500).json({ error: err.message });
            }
            req.session.userId = this.lastID;
            req.session.username = username;
            req.session.email = email;
            res.json({ success: true, username, email });
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ---------- تسجيل الدخول ----------
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'البريد وكلمة المرور مطلوبة' });
    }
    db.get(`SELECT * FROM users WHERE email = ?`, [email], async (err, user) => {
        if (err || !user) return res.status(401).json({ error: 'بيانات غير صحيحة' });
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ error: 'بيانات غير صحيحة' });
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.email = user.email;
        res.json({ success: true, username: user.username, email: user.email });
    });
});

// ---------- التحقق من حالة المستخدم ----------
app.get('/api/user', (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: 'Not logged in' });
    }
    res.json({
        username: req.session.username,
        email: req.session.email || ''
    });
});

// ---------- تسجيل الخروج ----------
app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

// ---------- إدارة البوتات ----------
app.get('/api/bots', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    db.all('SELECT * FROM bots WHERE user_id = ? ORDER BY created_at DESC', [req.session.userId], (err, bots) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ bots: bots || [] });
    });
});

app.post('/api/create-bot-cloud', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { botName, botType, serverIp, teamNames, version } = req.body;
    db.run(`INSERT INTO bots (user_id, bot_name, bot_type, server_ip, team_names, version, status) VALUES (?, ?, ?, ?, ?, ?, 'stopped')`,
        [req.session.userId, botName, botType, serverIp, teamNames || '', version || '1.21.10'],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, botId: this.lastID });
        });
});

// ---------- التحقق من حساب البوت (رابط مايكروسوفت) ----------
const botFlows = new Map();
app.get('/api/bot-verify/:botId', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const botId = parseInt(req.params.botId);
    db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [botId, req.session.userId], async (err, bot) => {
        if (err || !bot) return res.status(404).json({ error: 'Bot not found' });
        const flow = new Authflow(`bot_${botId}_${Date.now()}`, './ms-cache', {
            authTitle: 'Minecraft',
            deviceType: 'Win32',
            flow: 'msal',
            redirectUri: `${process.env.REDIRECT_URI || 'https://yzn3mk.onrender.com'}/auth/bot-callback`
        });
        const url = await flow.getAuthCodeUrl();
        botFlows.set(botId, flow);
        res.json({ url });
    });
});

app.get('/auth/bot-callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('No code');
    let botId = null;
    let flow = null;
    for (let [id, f] of botFlows.entries()) {
        flow = f;
        botId = id;
        botFlows.delete(id);
        break;
    }
    if (!flow) return res.status(400).send('No pending verification');
    try {
        await flow.authFlow(code);
        const token = await flow.getMinecraftJavaToken();
        db.run(`UPDATE bots SET mc_token = ? WHERE id = ?`, [token.token, botId]);
        res.send(`
            <html><body style="background:#0a0a1a;color:white;text-align:center;padding:50px;">
            <h2>✅ تم التحقق من البوت!</h2>
            <p>يمكنك إغلاق هذه النافذة وتشغيل البوت.</p>
            <script>setTimeout(()=>window.close(),3000)</script>
            </body></html>
        `);
    } catch (error) {
        console.error('Bot callback error:', error);
        res.status(500).send('فشل التحقق: ' + error.message);
    }
});

// ---------- تشغيل البوت ----------
app.post('/api/start-cloud-bot', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { botId } = req.body;
    db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [botId, req.session.userId], (err, bot) => {
        if (err || !bot) return res.status(404).json({ error: 'Bot not found' });
        if (!bot.mc_token) {
            return res.status(400).json({ error: 'need_minecraft_auth', message: 'اضغط زر تحقق أولاً' });
        }
        if (botProcesses.has(botId)) return res.json({ success: true });
        startBot(botId, bot.bot_name, bot.mc_token, bot.server_ip, bot.bot_type, bot.team_names, bot.version);
        db.run('UPDATE bots SET status = ? WHERE id = ?', ['online', botId]);
        res.json({ success: true });
    });
});

// ---------- باقي المسارات (إيقاف، حذف، تحديث، سجلات، إلخ) ----------
app.post('/api/stop-bot', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { botId } = req.body;
    if (stopBot(botId)) db.run('UPDATE bots SET status = ? WHERE id = ?', ['stopped', botId]);
    res.json({ success: true });
});

app.delete('/api/delete-bot', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { botId } = req.body;
    stopBot(botId);
    deleteBot(botId);
    db.run('DELETE FROM bots WHERE id = ? AND user_id = ?', [botId, req.session.userId]);
    res.json({ success: true });
});

app.put('/api/update-bot', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { botId, botName, botType, serverIp, teamNames, version } = req.body;
    stopBot(botId);
    db.run(`UPDATE bots SET bot_name = ?, bot_type = ?, server_ip = ?, team_names = ?, version = ?, status = 'stopped' WHERE id = ? AND user_id = ?`,
        [botName, botType, serverIp, teamNames || '', version || '1.21.10', botId, req.session.userId]);
    res.json({ success: true });
});

app.get('/api/bot-logs/:botId', (req, res) => {
    res.json({ logs: getBotLogs(parseInt(req.params.botId)) });
});

app.get('/api/bot-stats/:botId', (req, res) => {
    res.json(getBotStats(parseInt(req.params.botId)));
});

app.get('/api/bot-inventory/:botId', (req, res) => {
    res.json(getBotInventory(parseInt(req.params.botId)));
});

app.post('/api/bot-command', (req, res) => {
    const { botId, command, extra } = req.body;
    sendCommand(botId, command, extra);
    res.json({ success: true });
});

app.post('/api/restart-bot', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { botId } = req.body;
    db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [botId, req.session.userId], (err, bot) => {
        if (err || !bot) return res.status(404).json({ error: 'Bot not found' });
        stopBot(botId);
        setTimeout(() => {
            startBot(botId, bot.bot_name, bot.mc_token, bot.server_ip, bot.bot_type, bot.team_names, bot.version);
            db.run('UPDATE bots SET status = ? WHERE id = ?', ['online', botId]);
        }, 1000);
        res.json({ success: true });
    });
});

app.post('/api/clear-logs/:botId', (req, res) => {
    const fs = require('fs');
    const p = path.join(__dirname, 'logs', `bot-${req.params.botId}.log`);
    if (fs.existsSync(p)) fs.writeFileSync(p, '');
    res.json({ success: true });
});

app.get('/api/tasks/:botId', (req, res) => {
    db.all('SELECT * FROM tasks WHERE bot_id = ?', [req.params.botId], (err, tasks) => {
        res.json({ tasks: tasks || [] });
    });
});

app.get('/camera/:botId', (req, res) => {
    const botId = parseInt(req.params.botId);
    const viewerPort = 8080 + botId;
    res.redirect(`http://localhost:${viewerPort}`);
});

app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));