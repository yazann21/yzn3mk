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
    db.run(`CREATE TABLE IF NOT EXISTS bots (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, bot_name TEXT, bot_type TEXT, server_ip TEXT, team_names TEXT DEFAULT '', version TEXT DEFAULT '1.21.10', status TEXT DEFAULT 'stopped', mc_token TEXT, mc_username TEXT, mc_profile_id TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))`);
});

// ========== مصادقة المستخدم (مايكروسوفت لتسجيل الدخول) ==========
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
    const { botName, botType, serverIp, teamNames, version } = req.body;
    db.run(`INSERT INTO bots (user_id, bot_name, bot_type, server_ip, team_names, version, status) VALUES (?, ?, ?, ?, ?, ?, 'stopped')`,
        [req.session.userId, botName, botType, serverIp, teamNames || '', version || '1.21.10'], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, botId: this.lastID });
        });
});

// ========== مسار التحقق من البوت (يظهر الرابط والرمز ويعيد الحالة) ==========
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

        const userIdentifier = `bot_${botId}_${Date.now()}`;
        const flow = new Authflow(userIdentifier, './ms-cache', {
            authTitle: Titles.MinecraftJava,
            deviceType: 'Win32',
            flow: 'sisu',
            onMsaCode: (data) => {
                console.log(`\n🔐 مصادقة البوت ${botId}:`);
                console.log(`🔗 الرابط: ${data.verification_uri}`);
                console.log(`🔢 الرمز: ${data.user_code}`);
                pendingFlows.set(botId, flow);
                if (!res.headersSent) {
                    res.json({
                        need_verification: true,
                        verification_uri: data.verification_uri,
                        user_code: data.user_code,
                        expires_in: data.expires_in
                    });
                }
            }
        });
        
        const tokenResult = await flow.getMinecraftJavaToken({ fetchProfile: true });
        
        if (tokenResult && tokenResult.token && tokenResult.profile) {
            db.run(`UPDATE bots SET mc_token = ?, mc_username = ?, mc_profile_id = ? WHERE id = ?`,
                [tokenResult.token, tokenResult.profile.name, tokenResult.profile.id, botId], (err) => {
                if (err) console.error('DB error:', err);
                else console.log(`✅ Bot ${botId} verified with username ${tokenResult.profile.name}`);
                pendingFlows.delete(botId);
                if (!res.headersSent) res.json({ success: true, username: tokenResult.profile.name });
            });
        } else {
            throw new Error('لم يتم استلام التوكن');
        }
    } catch (error) {
        console.error(`❌ Bot ${botId} verification failed:`, error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'فشل التحقق: ' + error.message });
        }
    }
});

app.post('/api/complete-auth', async (req, res) => {
    const { botId } = req.body;
    const flow = pendingFlows.get(parseInt(botId));
    if (!flow) {
        return res.status(400).json({ error: 'لا توجد عملية مصادقة معلقة' });
    }
    try {
        const tokenResult = await flow.getMinecraftJavaToken({ fetchProfile: true });
        if (tokenResult && tokenResult.token && tokenResult.profile) {
            db.run(`UPDATE bots SET mc_token = ?, mc_username = ?, mc_profile_id = ? WHERE id = ?`,
                [tokenResult.token, tokenResult.profile.name, tokenResult.profile.id, botId], (err) => {
                if (err) console.error('DB error:', err);
                else console.log(`✅ Bot ${botId} verified via complete-auth with username ${tokenResult.profile.name}`);
                pendingFlows.delete(parseInt(botId));
                res.json({ success: true, username: tokenResult.profile.name });
            });
        } else {
            res.status(500).json({ error: 'فشل الحصول على التوكن' });
        }
    } catch (err) {
        console.error(`❌ Bot ${botId} completion failed:`, err);
        res.status(500).json({ error: err.message });
    }
});

// ========== تشغيل البوت (إذا كان mc_token موجود يستخدم الحساب الحقيقي وإلا يستخدم الوضع غير المسجل) ==========
app.post('/api/start-cloud-bot', (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
    const { botId } = req.body;
    db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [botId, req.session.userId], (err, bot) => {
        if (err || !bot) return res.status(404).json({ error: 'Bot not found' });
        
        // إذا كان البوت قيد التشغيل بالفعل
        if (botProcesses.has(botId)) return res.json({ success: true, alreadyRunning: true });
        
        let mcToken = bot.mc_token;
        let mcUsername = bot.mc_username;
        let mcProfileId = bot.mc_profile_id;
        
        // إذا كان هناك توكن (حساب حقيقي) استخدمه
        if (mcToken && mcToken !== '' && mcProfileId) {
            startBot(botId, bot.bot_name, mcToken, mcUsername, mcProfileId, bot.server_ip, bot.bot_type, bot.team_names, bot.version);
            db.run('UPDATE bots SET status = ? WHERE id = ?', ['online', botId]);
            res.json({ success: true, mode: 'microsoft' });
        } else {
            // وضع غير مسجل (offline) – يدخل بالاسم الذي اختاره المستخدم
            startBot(botId, bot.bot_name, null, bot.bot_name, null, bot.server_ip, bot.bot_type, bot.team_names, bot.version);
            db.run('UPDATE bots SET status = ? WHERE id = ?', ['online', botId]);
            res.json({ success: true, mode: 'offline' });
        }
    });
});

// ========== باقي مسارات التحكم ==========
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
                if (bot.mc_token && bot.mc_token !== '') {
                    startBot(botId, bot.bot_name, bot.mc_token, bot.mc_username, bot.mc_profile_id, bot.server_ip, bot.bot_type, bot.team_names, bot.version);
                } else {
                    startBot(botId, bot.bot_name, null, bot.bot_name, null, bot.server_ip, bot.bot_type, bot.team_names, bot.version);
                }
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

// كاميرا المراقبة (تعمل على المنفذ 8080+id)
app.get('/camera/:botId', (req, res) => {
    const port = 8080 + parseInt(req.params.botId);
    res.send(`
        <!DOCTYPE html>
        <html>
        <head><title>Bot Camera</title><style>body{margin:0;background:#0a0a1a;}</style></head>
        <body>
            <iframe src="http://localhost:${port}" style="width:100%;height:100vh;border:none;"></iframe>
        </body>
        </html>
    `);
});

const server = app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (reason) => console.error('Unhandled Rejection:', reason));