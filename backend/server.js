require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { Authflow, Titles } = require('prismarine-auth');
const { startBot, stopBot, getBotLogs, getBotStats, getBotInventory, sendCommand, deleteBot, botProcesses, getBotTunnelUrl } = require('./bot-starter');
const { getAuthUrl, getTokenFromCode, getMinecraftProfile } = require('./auth');

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

// ========== مصادقة المستخدم (تسجيل الدخول إلى الموقع) ==========
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
    if (!code) return res.status(400).send('No code provided');
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
    const { botName, botType, serverIp, teamNames, version } = req.body;
    db.run(`INSERT INTO bots (user_id, bot_name, bot_type, server_ip, team_names, version, status) VALUES (?, ?, ?, ?, ?, ?, 'stopped')`,
        [req.session.userId, botName, botType, serverIp, teamNames || '', version || '1.21.10'], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, botId: this.lastID });
        });
});

// ========== مصادقة البوت (تعمل في الخلفية وتطبع الرابط في السجلات) ==========
async function startBotDeviceAuth(botId) {
    const flow = new Authflow(`bot_${botId}_${Date.now()}`, './ms-cache', {
        authTitle: Titles.MinecraftJava,
        deviceType: 'Win32',
        flow: 'msal',
        onMsaCode: (data) => {
            console.log(`\n🔐 مصادقة البوت ${botId}:`);
            console.log(`🔗 الرابط: ${data.verification_uri}`);
            console.log(`🔢 الرمز: ${data.user_code}`);
            console.log(`⏱️ ينتهي خلال ${data.expires_in} ثانية\n`);
        }
    });
    try {
        const tokenResult = await flow.getMinecraftJavaToken();
        if (tokenResult && tokenResult.token) {
            await new Promise((resolve, reject) => {
                db.run(`UPDATE bots SET mc_token = ? WHERE id = ?`, [tokenResult.token, botId], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            console.log(`✅ Bot ${botId} verified successfully.`);
        }
    } catch (err) {
        console.error(`❌ Bot ${botId} verification failed:`, err);
    }
}

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

        // بدء المصادقة (الرابط والرمز سيظهران في سجل Render)
        const { token } = await startBotDeviceAuth(botId);
        if (token) {
            await new Promise((resolve, reject) => {
                db.run(`UPDATE bots SET mc_token = ? WHERE id = ?`, [token, botId], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            res.json({ message: '✅ تم التحقق من البوت بنجاح!' });
        } else {
            res.json({ message: '🔗 تم إرسال رابط المصادقة. افتح سجل Render وانسخ الرابط والرمز.' });
        }
    } catch (error) {
        console.error('Error in /api/bot-verify:', error);
        res.status(500).json({ error: 'حدث خطأ أثناء محاولة التحقق: ' + error.message });
    }
});

// تشغيل البوت باستخدام التوكن المخزن
app.post('/api/start-cloud-bot', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { botId } = req.body;
    db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [botId, req.session.userId], (err, bot) => {
        if (err || !bot) return res.status(404).json({ error: 'Bot not found' });
        if (!bot.mc_token) {
            return res.status(400).json({ error: 'need_minecraft_auth', message: 'اضغط زر تحقق أولاً ثم انتظر دقيقة وأعد المحاولة' });
        }
        if (botProcesses.has(botId)) return res.json({ success: true });
        startBot(botId, bot.bot_name, bot.mc_token, bot.server_ip, bot.bot_type, bot.team_names, bot.version);
        db.run('UPDATE bots SET status = ? WHERE id = ?', ['online', botId]);
        res.json({ success: true });
    });
});

// ========== باقي مسارات API ==========
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
    const tunnelUrl = getBotTunnelUrl ? getBotTunnelUrl(botId) : null;
    if (tunnelUrl) {
        res.redirect(tunnelUrl);
    } else {
        res.send(`
            <html><body style="background:#0a0a1a;color:white;text-align:center;padding:50px;">
            <h2>⏳ جاري إعداد الكاميرا...</h2>
            <p>قد يستغرق ngrok بضع ثوانٍ. حاول مرة أخرى بعد لحظات.</p>
            <button onclick="location.reload()">تحديث</button>
            </body></html>
        `);
    }
});

const server = app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));