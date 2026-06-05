require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { startBot, stopBot, getBotLogs, getBotStats, getBotInventory, sendCommand, deleteBot, botProcesses } = require('./bot-starter');
const { getAuthUrl, getTokenFromCode, getMinecraftProfile } = require('./auth');
const { Authflow, Titles } = require('prismarine-auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(cors({
    origin: 'https://yzn3mk.onrender.com',
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
    db.run(`CREATE TABLE IF NOT EXISTS bots (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, bot_name TEXT, bot_type TEXT, server_ip TEXT, team_names TEXT DEFAULT '', version TEXT DEFAULT '1.21.10', status TEXT DEFAULT 'stopped', mc_token TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))`);
});

// --- مسار مصادقة المستخدم (يبقى كما هو) ---
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

// --- مسارات إدارة البوتات (تبقى كما هي) ---
app.get('/api/bots', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    db.all('SELECT * FROM bots WHERE user_id = ? ORDER BY created_at DESC', [req.session.userId], (err, bots) => {
        res.json({ bots: bots || [] });
    });
});

app.post('/api/create-bot-cloud', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { botName, botType, serverIp, teamNames, version } = req.body;
    db.run(`INSERT INTO bots (user_id, bot_name, bot_type, server_ip, team_names, version, status) VALUES (?, ?, ?, ?, ?, ?, 'stopped')`,
        [req.session.userId, botName, botType, serverIp, teamNames || '', version || '1.21.10'], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, botId: this.lastID });
        });
});

// ==== مسار التحقق من البوت (المعدّل) ====
const pendingFlows = new Map();

app.get('/api/bot-verify/:botId', async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const botId = parseInt(req.params.botId);
    try {
        const bot = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [botId, req.session.userId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        if (!bot) return res.status(404).json({ error: 'Bot not found' });

        // إنشاء تدفق جديد باستخدام إعدادات Microsoft الصحيحة
        const flow = new Authflow(`bot_${botId}_${Date.now()}`, './ms-cache', {
            authTitle: Titles.MinecraftJava,
            deviceType: 'Win32',
            flow: 'live',
            onMsaCode: (data) => {
                console.log(`🔐 مصادقة البوت ${botId}:`);
                console.log(`🔗 الرابط: ${data.verification_uri}`);
                console.log(`🔢 الرمز: ${data.user_code}`);
                console.log(`⏱️ ينتهي خلال ${data.expires_in} ثانية\n`);
                // حفظ بيانات الرابط والرمز لاستخدامها لاحقاً
                pendingFlows.set(botId, { flow, data });
                // إرسال بيانات المصادقة إلى الواجهة الأمامية لتعرضها
                if (!res.headersSent) {
                    res.json({
                        need_verification: true,
                        verification_uri: data.verification_uri,
                        user_code: data.user_code,
                        expires_in: data.expires_in,
                        message: 'يجب إتمام المصادقة أولاً'
                    });
                }
            }
        });

        // محاولة الحصول على التوكن بعد استدعاء onMsaCode
        flow.getMinecraftJavaToken()
            .then(tokenResult => {
                if (tokenResult && tokenResult.token) {
                    db.run(`UPDATE bots SET mc_token = ? WHERE id = ?`, [tokenResult.token, botId], (err) => {
                        if (err) console.error('DB update error:', err);
                        else console.log(`✅ Bot ${botId} verified successfully.`);
                        pendingFlows.delete(botId);
                        if (!res.headersSent) {
                            res.json({ success: true, message: '✅ تم التحقق من البوت بنجاح!' });
                        }
                    });
                }
            })
            .catch(async (err) => {
                console.error(`❌ Bot ${botId} verification failed:`, err);
                // في حالة فشل المصادقة، نحاول الحصول على رابط ورمز جديدين
                if (!res.headersSent) {
                    // التحقق مما إذا كانت البيانات موجودة، وإذا لم تكن نعيد محاولة الإنشاء
                    const pending = pendingFlows.get(botId);
                    if (pending && pending.data) {
                        res.json({
                            need_verification: true,
                            verification_uri: pending.data.verification_uri,
                            user_code: pending.data.user_code,
                            expires_in: pending.data.expires_in,
                            message: 'يرجى إتمام المصادقة'
                        });
                    } else {
                        res.status(500).json({ error: 'فشل التحقق: ' + err.message });
                    }
                }
            });
    } catch (error) {
        console.error('Error in /api/bot-verify:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء محاولة التحقق: ' + error.message });
    }
});

// مسار لإتمام المصادقة بعد إدخال الرمز (اختياري)
app.post('/api/complete-auth', async (req, res) => {
    const { botId } = req.body;
    const pending = pendingFlows.get(parseInt(botId));
    if (!pending) {
        return res.status(400).json({ error: 'لا توجد عملية مصادقة معلقة لهذا البوت' });
    }
    try {
        const tokenResult = await pending.flow.getMinecraftJavaToken();
        if (tokenResult && tokenResult.token) {
            db.run(`UPDATE bots SET mc_token = ? WHERE id = ?`, [tokenResult.token, botId], (err) => {
                if (err) {
                    console.error('DB update error:', err);
                    return res.status(500).json({ error: 'فشل حفظ التوكن' });
                }
                console.log(`✅ Bot ${botId} verified successfully.`);
                pendingFlows.delete(parseInt(botId));
                res.json({ success: true, message: '✅ تم التحقق من البوت بنجاح!' });
            });
        } else {
            res.status(500).json({ error: 'فشل الحصول على التوكن' });
        }
    } catch (err) {
        console.error(`❌ Bot ${botId} completion failed:`, err);
        res.status(500).json({ error: 'فشل إتمام المصادقة: ' + err.message });
    }
});

// مسار تشغيل البوت المعدّل لإعادة توجيه طلب المصادقة
app.post('/api/start-cloud-bot', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { botId } = req.body;
    db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [botId, req.session.userId], (err, bot) => {
        if (err || !bot) return res.status(404).json({ error: 'Bot not found' });
        if (!bot.mc_token) {
            // البوت بحاجة إلى مصادقة
            return res.status(400).json({
                need_minecraft_auth: true,
                error: 'need_minecraft_auth',
                message: 'يجب ربط حساب ماينكرافت أولاً'
            });
        }
        if (botProcesses.has(botId)) return res.json({ success: true });
        startBot(botId, bot.bot_name, bot.mc_token, bot.server_ip, bot.bot_type, bot.team_names, bot.version);
        db.run('UPDATE bots SET status = ? WHERE id = ?', ['online', botId]);
        res.json({ success: true });
    });
});

// ... باقي المسارات (stop, delete, update, logs, stats, inventory, command, restart, clear-logs, tasks, camera) تبقى كما هي ...

const server = app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));