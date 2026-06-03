require('dotenv').config({ path: '../.env' });
const express = require('express');
const path = require('path');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { getAuthUrl, getTokenFromCode, getMinecraftProfile } = require('./auth');
const { startBot, stopBot, getBotLogs, getBotStats, getBotInventory, sendCommand, deleteBot, botProcesses } = require('./bot-starter');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const db = new sqlite3.Database(path.join(__dirname, 'bots.db'));
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, microsoft_id TEXT UNIQUE, username TEXT, uuid TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  db.run(`CREATE TABLE IF NOT EXISTS bots (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, bot_name TEXT, bot_type TEXT, server_ip TEXT, team_names TEXT DEFAULT '', version TEXT DEFAULT '1.21.10', status TEXT DEFAULT 'stopped', is_cloud_bot INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id))`);
});

const sessions = new Map();

app.get('/auth/login', async (req, res) => { try { res.json({ url: await getAuthUrl() }); } catch (error) { res.status(500).json({ error: error.message }); } });
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('No code');
  try {
    const { accessToken } = await getTokenFromCode(code);
    const { uuid, username } = await getMinecraftProfile(accessToken);
    db.run(`INSERT INTO users (microsoft_id, username, uuid) VALUES (?, ?, ?) ON CONFLICT(microsoft_id) DO UPDATE SET username = excluded.username, uuid = excluded.uuid`, [uuid, username, uuid], function(err) {
      if (err) return res.status(500).send('Database error');
      const sessionId = Math.random().toString(36).substring(2, 15);
      sessions.set(sessionId, { userId: uuid, username });
      res.redirect(`/?session=${sessionId}&username=${encodeURIComponent(username)}&uuid=${uuid}`);
    });
  } catch (error) { res.status(500).send('Auth failed: ' + error.message); }
});

app.get('/api/user/:sessionId', (req, res) => { const s = sessions.get(req.params.sessionId); if (!s) return res.status(401).json({ error: 'Not logged in' }); res.json({ username: s.username, uuid: s.userId }); });
app.get('/api/bots/:sessionId', (req, res) => { const s = sessions.get(req.params.sessionId); if (!s) return res.status(401).json({ error: 'Not logged in' }); db.all('SELECT * FROM bots WHERE user_id = ? ORDER BY created_at DESC', [s.userId], (err, bots) => { res.json({ bots: bots || [] }); }); });
app.post('/api/create-bot-cloud', (req, res) => { const { sessionId, botName, botType, serverIp, teamNames, version } = req.body; const s = sessions.get(sessionId); if (!s) return res.status(401).json({ error: 'Not logged in' }); db.get('SELECT COUNT(*) as count FROM bots WHERE user_id = ? AND is_cloud_bot = 1', [s.userId], (err, row) => { if (row.count >= 1) return res.status(400).json({ error: 'You already have a free cloud bot' }); db.run(`INSERT INTO bots (user_id, bot_name, bot_type, server_ip, team_names, version, status, is_cloud_bot) VALUES (?, ?, ?, ?, ?, ?, 'stopped', 1)`, [s.userId, botName, botType, serverIp, teamNames || '', version || '1.21.10'], function(err) { if (err) return res.status(500).json({ error: err.message }); res.json({ success: true, botId: this.lastID }); }); }); });
app.post('/api/start-cloud-bot', (req, res) => { const { sessionId, botId } = req.body; const s = sessions.get(sessionId); if (!s) return res.status(401).json({ error: 'Not logged in' }); db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [botId, s.userId], (err, bot) => { if (err || !bot) return res.status(404).json({ error: 'Bot not found' }); if (botProcesses.has(botId)) return res.json({ success: true }); startBot(botId, s.username, s.userId, bot.server_ip, bot.bot_type, bot.team_names, bot.version); db.run('UPDATE bots SET status = ? WHERE id = ?', ['online', botId]); res.json({ success: true }); }); });
app.post('/api/stop-bot', (req, res) => { const { sessionId, botId } = req.body; const s = sessions.get(sessionId); if (!s) return res.status(401).json({ error: 'Not logged in' }); if (stopBot(botId)) db.run('UPDATE bots SET status = ? WHERE id = ?', ['stopped', botId]); res.json({ success: true }); });
app.delete('/api/delete-bot', (req, res) => { const { sessionId, botId } = req.body; const s = sessions.get(sessionId); if (!s) return res.status(401).json({ error: 'Not logged in' }); stopBot(botId); deleteBot(botId); db.run('DELETE FROM bots WHERE id = ? AND user_id = ?', [botId, s.userId], (err) => { res.json({ success: true }); }); });
app.put('/api/update-bot', (req, res) => { const { sessionId, botId, botName, botType, serverIp, teamNames, version } = req.body; const s = sessions.get(sessionId); if (!s) return res.status(401).json({ error: 'Not logged in' }); stopBot(botId); db.run(`UPDATE bots SET bot_name = ?, bot_type = ?, server_ip = ?, team_names = ?, version = ?, status = 'stopped' WHERE id = ? AND user_id = ?`, [botName, botType, serverIp, teamNames || '', version || '1.21.10', botId, s.userId], (err) => { res.json({ success: true }); }); });
app.get('/api/bot-logs/:botId', (req, res) => { res.json({ logs: getBotLogs(parseInt(req.params.botId)) }); });
app.get('/api/bot-stats/:botId', (req, res) => { res.json(getBotStats(parseInt(req.params.botId))); });
app.get('/api/bot-inventory/:botId', (req, res) => { res.json(getBotInventory(parseInt(req.params.botId))); });
app.post('/api/bot-command', (req, res) => { const { botId, command, extra } = req.body; sendCommand(botId, command, extra); res.json({ success: true }); });
app.post('/api/restart-bot', (req, res) => { const { sessionId, botId } = req.body; const s = sessions.get(sessionId); if (!s) return res.status(401).json({ error: 'Not logged in' }); db.get('SELECT * FROM bots WHERE id = ? AND user_id = ?', [botId, s.userId], (err, bot) => { stopBot(botId); setTimeout(() => { startBot(botId, s.username, s.userId, bot.server_ip, bot.bot_type, bot.team_names, bot.version); db.run('UPDATE bots SET status = ? WHERE id = ?', ['online', botId]); }, 1000); res.json({ success: true }); }); });
app.post('/api/clear-logs/:botId', (req, res) => { const fs = require('fs'); const p = path.join(__dirname, 'logs', `bot-${req.params.botId}.log`); if (fs.existsSync(p)) fs.writeFileSync(p, ''); res.json({ success: true }); });

// ========== صفحة الكاميرا المدمجة ==========
app.get('/camera/:botId', (req, res) => {
  const botId = req.params.botId;
  const viewerPort = 3001 + parseInt(botId);
  
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>كاميرا البوت ${botId}</title>
        <style>
            body { margin: 0; padding: 0; background: #0a0a1a; font-family: Arial, sans-serif; }
            .camera-container { width: 100%; height: 100vh; display: flex; flex-direction: column; }
            .camera-header { background: #1a1a3a; padding: 10px 20px; color: white; text-align: center; }
            .camera-frame { flex: 1; border: none; width: 100%; }
            .error-message { color: white; text-align: center; padding: 50px; background: #0a0a1a; height: 100vh; }
            .loading { color: #a0a0c0; text-align: center; padding: 50px; }
            button { background: #7c3aed; border: none; padding: 8px 16px; border-radius: 8px; color: white; cursor: pointer; margin-top: 10px; }
        </style>
    </head>
    <body>
        <div class="camera-container" id="cameraContainer">
            <div class="camera-header">
                🎥 كاميرا البوت - انتظار الاتصال...
                <button onclick="location.reload()">🔄 إعادة تحميل</button>
            </div>
            <div class="loading" id="loadingMsg">⏳ جاري تحميل الكاميرا...<br>قد يستغرق هذا دقيقة</div>
            <iframe id="cameraFrame" class="camera-frame" style="display:none"></iframe>
        </div>
        <script>
            const botId = ${botId};
            const viewerPort = ${viewerPort};
            
            function checkCamera() {
                fetch('/api/bot-status/' + botId)
                    .then(res => res.json())
                    .then(data => {
                        if (!data.online) {
                            document.getElementById('cameraContainer').innerHTML = 
                                '<div class="error-message">⚠️ البوت غير متصل.<br><br>الرجاء تشغيل البوت أولاً من لوحة التحكم.<br><br><button onclick="window.close()">إغلاق النافذة</button></div>';
                        } else {
                            // الكاميرا على السحابة ما تشتغل للأسف
                            document.getElementById('cameraContainer').innerHTML = 
                                '<div class="error-message">' +
                                '📷 الكاميرا لا تعمل على السحابة المجانية.<br><br>' +
                                'لرؤية الكاميرا، جرب:<br>' +
                                '1. شغل البوت من جهازك الشخصي<br>' +
                                '2. أو ارفع خطة مدفوعة على Render (من 7 دولار)<br><br>' +
                                'لكن البوت نفسه شغال 100%! ✅<br><br>' +
                                '<button onclick="window.close()">إغلاق النافذة</button>' +
                                '</div>';
                        }
                    })
                    .catch(() => {
                        document.getElementById('cameraContainer').innerHTML = 
                            '<div class="error-message">❌ خطأ في الاتصال بالبوت<br><br><button onclick="location.reload()">إعادة المحاولة</button></div>';
                    });
            }
            
            setTimeout(checkCamera, 1000);
        </script>
    </body>
    </html>
  `);
});

app.get('/api/bot-status/:botId', (req, res) => {
  const isOnline = botProcesses.has(parseInt(req.params.botId));
  res.json({ online: isOnline });
});

app.listen(PORT, () => console.log(`✅ Server running on http://localhost:${PORT}`));