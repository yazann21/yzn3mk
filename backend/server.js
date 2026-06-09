require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const { startBot, stopBot, getBotLogs, getBotStats, getBotInventory, sendCommand, deleteBot, botProcesses } = require('./bot-starter');
const { getAuthUrl, getTokenFromCode, getMinecraftProfile } = require('./auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(cors({
    origin: process.env.API_URL || 'http://localhost:3000',
    credentials: true
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

app.use(session({
    store: new SQLiteStore({ db: 'sessions.db', table: 'sessions' }),
    secret: process.env.SESSION_SECRET || 'super_secret_key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: true,
        httpOnly: true,
        sameSite: 'none',
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
}));

const db = new sqlite3.Database(path.join(__dirname, 'bots.db'));
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS bots (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, bot_name TEXT, bot_type TEXT, server_ip TEXT, team_names TEXT DEFAULT '', version TEXT DEFAULT '1.21.10', status TEXT DEFAULT 'stopped', mc_token TEXT, mc_username TEXT, mc_profile_id TEXT, auth_type TEXT DEFAULT 'offline', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))`);
});

// ========== تخزين روابط الكاميرا لكل بوت ==========
const botCameraUrls = new Map();

app.post('/api/register-camera-url', (req, res) => {
    const { botId, url } = req.body;
    if (botId && url) {
        botCameraUrls.set(botId, url);
        console.log(`✅ تم تسجيل رابط الكاميرا للبوت ${botId}: ${url}`);
        res.json({ success: true });
    } else {
        res.status(400).json({ error: 'بيانات ناقصة' });
    }
});

// مسار فتح الكاميرا – إعادة توجيه إلى رابط ngrok (بدون إضافة /view إضافية)
app.get('/camera/:botId', (req, res) => {
    const botId = parseInt(req.params.botId);
    const cameraUrl = botCameraUrls.get(botId);
    if (cameraUrl) {
        // نستخدم الرابط كما هو (ngrok يعطيه مع /view بالفعل)
        res.redirect(cameraUrl);
    } else {
        res.status(404).send(`
            <!DOCTYPE html>
            <html>
            <head><title>كاميرا البوت</title><style>body{font-family:sans-serif;text-align:center;padding:50px;background:#0a0a1a;color:white;}</style></head>
            <body>
                <h1>📷 كاميرا البوت</h1>
                <p>لم يتم الحصول على رابط الكاميرا العام بعد.</p>
                <p>تأكد من أن البوت قيد التشغيل وأن متغير <code>NGROK_AUTHTOKEN</code> مضبوط في البيئة.</p>
            </body>
            </html>
        `);
    }
});

// ========== مصادقة المستخدم ==========
app.get('/auth/login', async (req, res) => {
    try {
        const url = await getAuthUrl();
        res.json({ url });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('No code');
    try {
        const { accessToken } = await getTokenFromCode(code);
        const { username } = await getMinecraftProfile(accessToken);
        db.run(`INSERT OR IGNORE INTO users (username) VALUES (?)`, [username]);
        db.get(`SELECT id FROM users WHERE username = ?`, [username], (err, row) => {
            if (err) return res.status(500).send('Database error');
            req.session.userId = row.id;
            req.session.username = username;
            req.session.save(() => res.redirect('/'));
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('Auth failed: ' + error.message);
    }
});

app.get('/api/user', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    res.json({ username: req.session.username });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

// ========== إدارة البوتات ==========
app.get('/api/bots', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    db.all('SELECT * FROM bots WHERE user_id = ? ORDER BY created_at DESC', [req.session.userId], (err, bots) => {
        res.json({ bots: bots || [] });
    });
});

app.post('/api/create-bot-cloud', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { botName, botType, serverIp, teamNames, version, authType } = req.body;
    db.run(`INSERT INTO bots (user_id, bot_name, bot_type, server_ip, team_names, version, status, auth_type) VALUES (?, ?, ?, ?, ?, ?, 'stopped', ?)`,
        [req.session.userId, botName, botType, serverIp, teamNames || '', version || '1.21.10', authType || 'offline'], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, botId: this.lastID, need_verification: (authType === 'microsoft') });
        });
});

app.post('/api/save-bot-token', (req, res) => {
    const { botId, mcToken, mcUsername, mcProfileId } = req.body;
    if (!botId || !mcToken || !mcUsername || !mcProfileId) return res.status(400).json({ error: 'بيانات ناقصة' });
    db.run(`UPDATE bots SET mc_token = ?, mc_username = ?, mc_profile_id = ? WHERE id = ?`,
        [mcToken, mcUsername, mcProfileId, botId], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            console.log(`✅ تم حفظ توكن البوت ${botId} (${mcUsername})`);
            res.json({ success: true });
        });
});

app.post('/api/start-cloud-bot', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { botId } = req.body;
    db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [botId, req.session.userId], (err, bot) => {
        if (err || !bot) return res.status(404).json({ error: 'Bot not found' });
        if (botProcesses.has(botId)) return res.json({ success: true, alreadyRunning: true });
        
        startBot(botId, bot.bot_name, bot.mc_token, bot.mc_username, bot.mc_profile_id, bot.server_ip, bot.bot_type, bot.team_names, bot.version, bot.auth_type);
        db.run('UPDATE bots SET status = ? WHERE id = ?', ['online', botId]);
        res.json({ success: true });
    });
});

app.post('/api/stop-bot', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { botId } = req.body;
    if (stopBot(parseInt(botId))) {
        db.run('UPDATE bots SET status = ? WHERE id = ?', ['stopped', botId]);
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

app.delete('/api/delete-bot', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { botId } = req.body;
    deleteBot(parseInt(botId));
    db.run('DELETE FROM bots WHERE id = ? AND user_id = ?', [botId, req.session.userId]);
    res.json({ success: true });
});

app.put('/api/update-bot', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { botId, botName, botType, serverIp, teamNames, version } = req.body;
    db.run(`UPDATE bots SET bot_name = ?, bot_type = ?, server_ip = ?, team_names = ?, version = ? WHERE id = ? AND user_id = ?`,
        [botName, botType, serverIp, teamNames || '', version || '1.21.10', botId, req.session.userId]);
    res.json({ success: true });
});

app.get('/api/bot-logs/:botId', (req, res) => {
    const logs = getBotLogs(parseInt(req.params.botId));
    res.json({ logs });
});

app.get('/api/bot-stats/:botId', (req, res) => {
    const stats = getBotStats(parseInt(req.params.botId));
    res.json(stats);
});

app.get('/api/bot-inventory/:botId', (req, res) => {
    const inventory = getBotInventory(parseInt(req.params.botId));
    res.json(inventory);
});

app.post('/api/bot-command', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { botId, command, extra } = req.body;
    sendCommand(parseInt(botId), command, extra);
    res.json({ success: true });
});

app.post('/api/restart-bot', (req, res) => {
    const { botId } = req.body;
    stopBot(parseInt(botId));
    setTimeout(() => {
        db.get('SELECT * FROM bots WHERE id = ?', [botId], (err, bot) => {
            if (bot) {
                startBot(botId, bot.bot_name, bot.mc_token, bot.mc_username, bot.mc_profile_id, bot.server_ip, bot.bot_type, bot.team_names, bot.version, bot.auth_type);
                db.run('UPDATE bots SET status = ? WHERE id = ?', ['online', botId]);
            }
        });
    }, 1000);
    res.json({ success: true });
});

app.post('/api/clear-logs/:botId', (req, res) => {
    const logs = getBotLogs(parseInt(req.params.botId));
    if (logs) logs.length = 0;
    res.json({ success: true });
});

const server = app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));