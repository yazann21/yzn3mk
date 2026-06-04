require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const { Authflow } = require('prismarine-auth');
const { startBot, stopBot, getBotLogs, getBotStats, getBotInventory, sendCommand, deleteBot, botProcesses } = require('./bot-starter');

const app = express();
const PORT = process.env.PORT || 3000;

// ████████ إعدادات أساسية للإنتاج ████████
// يخبر Express أنه يعمل خلف وكيل (proxy) مثل Render، وهو أمر بالغ الأهمية لاستمرارية الجلسات
app.set('trust proxy', 1);

// إعدادات CORS الصحيحة للسماح بتبادل الجلسات والكوكيز
app.use(cors({
    origin: 'https://yzn3mk.onrender.com', // يجب أن يكون رابط موقعك بالكامل
    credentials: true                      // ضروري لإرسال واستقبال الكوكيز
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// إعدادات الجلسة (Session) المُحسّنة
app.use(session({
    // استخدام SQLiteStore بدلاً من MemoryStore لمنع تسرب الذاكرة وأخطاء 503
    store: new SQLiteStore({ db: 'sessions.db', table: 'sessions' }),
    secret: process.env.SESSION_SECRET || 'super_secret_key_change_this',
    resave: false,
    saveUninitialized: false,
    // ضبط الكوكيز بشكل صحيح لبيئة الإنتاج
    cookie: {
        secure: true,      // لأن الموقع يعمل على HTTPS
        httpOnly: true,
        sameSite: 'none',  // ضروري للطلبات عبر المواقع (cross-site)
        maxAge: 1000 * 60 * 60 * 24 * 7  // صلاحية الكوكيز (أسبوع)
    }
}));

// ... (باقي الكود، مسارات API وجداول قاعدة البيانات، يبقى كما هو)
// سأضيفه هنا كاملاً لضمان عدم وجود أخطاء

// قاعدة البيانات
const db = new sqlite3.Database(path.join(__dirname, 'bots.db'));
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE, email TEXT UNIQUE, password TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    db.run(`CREATE TABLE IF NOT EXISTS bots (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, bot_name TEXT, bot_type TEXT, server_ip TEXT, team_names TEXT DEFAULT '', version TEXT DEFAULT '1.21.10', status TEXT DEFAULT 'stopped', mc_token TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))`);
});

// ---------- مسارات API ----------
app.post('/api/register', async (req, res) => {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (username, email, password) VALUES (?, ?, ?)`, [username, email, hashedPassword], function(err) {
            if (err) {
                if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'اسم المستخدم أو البريد موجود مسبقاً' });
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

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'البريد وكلمة المرور مطلوبة' });
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

app.get('/api/user', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    res.json({ username: req.session.username, email: req.session.email || '' });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
});

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

// ---------- التحقق من حساب البوت ----------
const botFlows = new Map();

app.get('/api/bot-verify/:botId', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const botId = parseInt(req.params.botId);
    try {
        // التحقق من وجود البوت في قاعدة البيانات
        const bot = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [botId, req.session.userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        if (!bot) return res.status(404).json({ error: 'Bot not found' });
        
        // إنشاء رابط مصادقة جديد
        const flow = new Authflow(`bot_${botId}_${Date.now()}`, './ms-cache', {
            authTitle: 'Minecraft',
            deviceType: 'Win32',
            flow: 'msal',
            redirectUri: `${process.env.REDIRECT_URI || 'https://yzn3mk.onrender.com'}/auth/bot-callback`
        });
        const url = await flow.getAuthCodeUrl();
        botFlows.set(botId, flow);
        res.json({ url });
    } catch (error) {
        console.error('Error in /api/bot-verify:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء محاولة التحقق' });
    }
});

app.get('/auth/bot-callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.status(400).send('No code provided');
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
        await new Promise((resolve, reject) => {
            db.run(`UPDATE bots SET mc_token = ? WHERE id = ?`, [token.token, botId], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
        res.send(`
            <html>
            <body style="background:#0a0a1a;color:white;text-align:center;padding:50px;font-family:sans-serif;">
                <h2>✅ تم التحقق من البوت بنجاح!</h2>
                <p>يمكنك إغلاق هذه النافذة وتشغيل البوت الآن.</p>
                <script>setTimeout(() => window.close(), 3000);</script>
            </body>
            </html>
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

// ---------- مسارات أخرى ----------
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

// ████████ بدء تشغيل الخادم بشكل آمن ████████
const server = app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

// معالجة الأخطاء غير المتوقعة لمنع انهيار الخادم (وهذا مهم جدًا!)
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    // لا ننهي الخادم، فقط نسجل الخطأ
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // لا ننهي الخادم، فقط نسجل الخطأ
});

// إغلاق الخادم بشكل آمن عند استقبال إشارة الإنهاء
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
    });
});