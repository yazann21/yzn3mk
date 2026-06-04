require('dotenv').config({ path: '../.env' });
const express = require('express');
const session = require('express-session');
const FileStore = require('session-file-store')(session);
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcrypt');
const sqlite3 = require('sqlite3').verbose();
const { getAuthUrl, getTokenFromCode, getMinecraftProfile } = require('./auth');
const { startBot, stopBot, getBotLogs, getBotStats, getBotInventory, sendCommand, deleteBot, botProcesses } = require('./bot-starter');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

// جلسات دائمة (تحفظ في ملفات)
app.use(session({
  store: new FileStore({ path: './sessions' }),
  secret: process.env.SESSION_SECRET || 'my_secret_key_12345',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'none',
    maxAge: 1000 * 60 * 60 * 24 * 7 // أسبوع
  }
}));

const db = new sqlite3.Database(path.join(__dirname, 'bots.db'));
db.serialize(() => {
  // جدول المستخدمين (دعم تسجيل الدخول المحلي + مايكروسوفت)
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password TEXT,
    microsoft_id TEXT UNIQUE,
    uuid TEXT,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  
  // جدول البوتات
  db.run(`CREATE TABLE IF NOT EXISTS bots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    bot_name TEXT,
    bot_type TEXT,
    server_ip TEXT,
    team_names TEXT DEFAULT '',
    version TEXT DEFAULT '1.21.10',
    status TEXT DEFAULT 'stopped',
    is_cloud_bot INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  
  // جدول المهام المجدولة
  db.run(`CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bot_id INTEGER,
    command TEXT,
    interval_seconds INTEGER,
    enabled INTEGER DEFAULT 1,
    FOREIGN KEY(bot_id) REFERENCES bots(id)
  )`);
});

// ========== مسارات المصادقة المحلية (تسجيل دخول عادي) ==========
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run(`INSERT INTO users (username, email, password) VALUES (?, ?, ?)`, [username, email, hashedPassword], function(err) {
      if (err) {
        if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'اسم المستخدم أو البريد الإلكتروني موجود مسبقاً' });
        return res.status(500).json({ error: err.message });
      }
      req.session.userId = this.lastID;
      req.session.username = username;
      req.session.role = 'user';
      req.session.save();
      res.json({ success: true, username, role: 'user' });
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'اسم المستخدم وكلمة المرور مطلوبة' });
  }
  db.get(`SELECT * FROM users WHERE username = ? OR email = ?`, [username, username], async (err, user) => {
    if (err || !user) return res.status(401).json({ error: 'بيانات غير صحيحة' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'بيانات غير صحيحة' });
    req.session.userId = user.id;
    req.session.username = user.username;
    req.session.role = user.role;
    req.session.save();
    res.json({ success: true, username: user.username, role: user.role });
  });
});

// ========== مسارات مصادقة مايكروسوفت (للبوتات) ==========
app.get('/auth/login', async (req, res) => {
  try { res.json({ url: await getAuthUrl() }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code');
  try {
    const { accessToken } = await getTokenFromCode(code);
    const { uuid, username, minecraftToken } = await getMinecraftProfile(accessToken);
    
    // ربط حساب مايكروسوفت بالمستخدم الحالي (إذا كان مسجلاً دخوله)
    if (req.session.userId) {
      db.run(`UPDATE users SET microsoft_id = ?, uuid = ? WHERE id = ?`, [uuid, uuid, req.session.userId], (err) => {
        if (err) return res.status(500).send('Database error');
        req.session.minecraftToken = minecraftToken;
        req.session.save();
        res.redirect('/');
      });
    } else {
      // إنشاء مستخدم جديد عبر مايكروسوفت
      db.run(`INSERT INTO users (username, microsoft_id, uuid) VALUES (?, ?, ?)`, [username, uuid, uuid], function(err) {
        if (err && err.message.includes('UNIQUE')) {
          // مستخدم موجود مسبقاً – تسجيل دخول
          db.get(`SELECT * FROM users WHERE microsoft_id = ?`, [uuid], (err, user) => {
            req.session.userId = user.id;
            req.session.username = user.username;
            req.session.role = user.role;
            req.session.minecraftToken = minecraftToken;
            req.session.save();
            res.redirect('/');
          });
        } else {
          req.session.userId = this.lastID;
          req.session.username = username;
          req.session.role = 'user';
          req.session.minecraftToken = minecraftToken;
          req.session.save();
          res.redirect('/');
        }
      });
    }
  } catch (error) { res.status(500).send('Auth failed: ' + error.message); }
});

// ========== مسارات API المحمية ==========
app.get('/api/user', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  res.json({ username: req.session.username, uuid: req.session.userId, role: req.session.role });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/bots', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const sql = req.session.role === 'admin' 
    ? 'SELECT * FROM bots ORDER BY created_at DESC'
    : 'SELECT * FROM bots WHERE user_id = ? ORDER BY created_at DESC';
  const params = req.session.role === 'admin' ? [] : [req.session.userId];
  db.all(sql, params, (err, bots) => {
    res.json({ bots: bots || [] });
  });
});

app.post('/api/create-bot-cloud', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const { botName, botType, serverIp, teamNames, version } = req.body;
  db.get('SELECT COUNT(*) as count FROM bots WHERE user_id = ? AND is_cloud_bot = 1', [req.session.userId], (err, row) => {
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
  db.get('SELECT * FROM bots WHERE id = ?', [botId], (err, bot) => {
    if (err || !bot) return res.status(404).json({ error: 'Bot not found' });
    if (req.session.role !== 'admin' && bot.user_id !== req.session.userId) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    if (botProcesses.has(botId)) return res.json({ success: true });
    startBot(botId, bot.bot_name, req.session.userId.toString(), bot.server_ip, bot.bot_type, bot.team_names, bot.version, req.session.minecraftToken);
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
  db.run('DELETE FROM bots WHERE id = ?', [botId]);
  res.json({ success: true });
});

app.put('/api/update-bot', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const { botId, botName, botType, serverIp, teamNames, version } = req.body;
  stopBot(botId);
  db.run(`UPDATE bots SET bot_name = ?, bot_type = ?, server_ip = ?, team_names = ?, version = ?, status = 'stopped' WHERE id = ?`,
    [botName, botType, serverIp, teamNames || '', version || '1.21.10', botId]);
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
  db.get('SELECT * FROM bots WHERE id = ?', [botId], (err, bot) => {
    stopBot(botId);
    setTimeout(() => {
      startBot(botId, bot.bot_name, req.session.userId.toString(), bot.server_ip, bot.bot_type, bot.team_names, bot.version, req.session.minecraftToken);
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

app.post('/api/add-task', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  const { botId, command, intervalSeconds } = req.body;
  db.run('INSERT INTO tasks (bot_id, command, interval_seconds) VALUES (?, ?, ?)', [botId, command, intervalSeconds], (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

app.get('/api/tasks/:botId', (req, res) => {
  db.all('SELECT * FROM tasks WHERE bot_id = ?', [req.params.botId], (err, tasks) => {
    res.json({ tasks: tasks || [] });
  });
});

// ========== دمج الكاميرا (بدون ngrok) ==========
const botViewers = new Map();
global.onBotSpawned = (botId, botProcess) => {
  // سيتم تنفيذ هذه الدالة عند spawn البوت
  console.log(`🎥 جاهزية الكاميرا للبوت ${botId} سيتم تفعيلها عند الطلب عبر /viewer/${botId}`);
};

// مسار الكاميرا المدمجة
app.get('/viewer/:botId', (req, res) => {
  const botId = parseInt(req.params.botId);
  const bot = botProcesses.get(botId);
  if (!bot) {
    return res.send(`
      <!DOCTYPE html>
      <html><head><title>كاميرا البوت</title><style>body{background:#0a0a1a;color:white;text-align:center;padding:50px;font-family:sans-serif;}</style></head>
      <body><h2>📷 البوت غير متصل</h2><p>يرجى تشغيل البوت أولاً.</p></body>
      </html>
    `);
  }
  // إعادة توجيه إلى صفحة viewer مؤقتة (سيتم تطويرها لاحقاً)
  res.send(`
    <!DOCTYPE html>
    <html><head><title>كاميرا البوت ${botId}</title><style>body{background:#0a0a1a;color:white;text-align:center;padding:50px;font-family:sans-serif;}</style></head>
    <body><h2>🎥 كاميرا البوت ${botId}</h2><p>تم دمج الكاميرا في التطبيق الرئيسي. سيتم تفعيل الواجهة الكاملة قريباً.</p><button onclick="window.close()">إغلاق</button></body>
    </html>
  `);
});

// صفحة اختبار بسيطة
app.get('/api/test', (req, res) => {
  res.json({ status: 'ok', session: req.session });
});

app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));