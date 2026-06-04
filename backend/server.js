require('dotenv').config({ path: '../.env' });
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { getAuthUrl, getTokenFromCode, getMinecraftProfile, isRealMinecraftAccount } = require('./auth');
const { startBot, stopBot, getBotLogs, getBotStats, getBotInventory, sendCommand, deleteBot, botProcesses } = require('./bot-starter');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// إعدادات الجلسة - حفظ في ملفات
app.use(session({
  store: new FileStore({ path: './sessions' }),
  secret: process.env.SESSION_SECRET || 'my_secret_key_12345',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,   // لأن Render يستخدم HTTPS لكن localhost لا، نجعلها false للتجربة ثم نغيرها حسب البيئة
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7 // أسبوع
  }
}));

const db = new sqlite3.Database(path.join(__dirname, 'bots.db'));
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, microsoft_id TEXT UNIQUE, username TEXT, uuid TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, minecraft_token TEXT, is_real INTEGER DEFAULT 0)`);
  db.run(`CREATE TABLE IF NOT EXISTS bots (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, bot_name TEXT, bot_type TEXT, server_ip TEXT, team_names TEXT DEFAULT '', version TEXT DEFAULT '1.21.10', status TEXT DEFAULT 'stopped', is_cloud_bot INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))`);
  db.run(`CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id INTEGER, command TEXT, interval_seconds INTEGER, enabled INTEGER DEFAULT 1, FOREIGN KEY(bot_id) REFERENCES bots(id))`);
});

// مسار بدء تسجيل الدخول إلى مايكروسوفت
app.get('/auth/login', async (req, res) => {
  try { res.json({ url: await getAuthUrl() }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

// مسار العودة بعد تسجيل الدخول
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code');
  try {
    const { accessToken } = await getTokenFromCode(code);
    const { uuid, username, minecraftToken, isRealMinecraft } = await getMinecraftProfile(accessToken);
    
    db.run(`INSERT INTO users (microsoft_id, username, uuid, minecraft_token, is_real) VALUES (?, ?, ?, ?, ?) 
            ON CONFLICT(microsoft_id) DO UPDATE SET username = excluded.username, uuid = excluded.uuid, minecraft_token = excluded.minecraft_token, is_real = excluded.is_real`,
      [uuid, username, uuid, minecraftToken, isRealMinecraft ? 1 : 0], function(err) {
        if (err) {
          console.error(err);
          return res.status(500).send('Database error');
        }
        // تخزين بيانات المستخدم في الجلسة
        req.session.userId = uuid;
        req.session.username = username;
        req.session.minecraftToken = minecraftToken;
        req.session.isRealMinecraft = isRealMinecraft;
        req.session.save((err) => {
          if (err) console.error('Session save error:', err);
          res.redirect(`/`);
        });
      });
  } catch (error) {
    console.error(error);
    res.status(500).send('Auth failed: ' + error.message);
  }
});

// API للتحقق من حالة المستخدم
app.get('/api/user', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  res.json({
    username: req.session.username,
    uuid: req.session.userId,
    isRealMinecraft: req.session.isRealMinecraft || false
  });
});

// تسجيل الخروج
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error(err);
    res.json({ success: true });
  });
});

// باقي مسارات API (مختصرة ولكنها كاملة)
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
  db.get('SELECT COUNT(*) as count FROM bots WHERE user_id = ? AND is_cloud_bot = 1', [req.session.userId], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    if (row.count >= 1) return res.status(400).json({ error: 'You already have a free cloud bot' });
    db.run(`INSERT INTO bots (user_id, bot_name, bot_type, server_ip, team_names, version, status, is_cloud_bot) VALUES (?, ?, ?, ?, ?, ?, 'stopped', 1)`,
      [req.session.userId, botName, botType, serverIp, teamNames || '', version || '1.21.10'], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, botId: this.lastID });
      });
  });
});

app.post('/api/start-cloud-bot', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const { botId } = req.body;
  if (!req.session.isRealMinecraft) {
    return res.status(400).json({ error: 'need_minecraft_auth', message: 'حساب مايكروسوفت غير مرتبط بحساب ماينكرافت حقيقي.' });
  }
  db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [botId, req.session.userId], (err, bot) => {
    if (err || !bot) return res.status(404).json({ error: 'Bot not found' });
    if (botProcesses.has(botId)) return res.json({ success: true });
    startBot(botId, bot.bot_name, req.session.userId, bot.server_ip, bot.bot_type, bot.team_names, bot.version, req.session.minecraftToken);
    db.run('UPDATE bots SET status = ? WHERE id = ?', ['online', botId]);
    res.json({ success: true });
  });
});

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
      startBot(botId, bot.bot_name, req.session.userId, bot.server_ip, bot.bot_type, bot.team_names, bot.version, req.session.minecraftToken);
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
  const viewerPort = 3001 + botId;
  res.redirect(`http://localhost:${viewerPort}`);
});

app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));