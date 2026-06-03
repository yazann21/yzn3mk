const { spawn } = require('child_process');
const path = require('path');
const ngrok = require('ngrok');

const botProcesses = new Map();
const botLogs = new Map();
const botStats = new Map();
const botInventory = new Map();
const botNgrokUrls = new Map();

async function startBot(botId, username, uuid, serverIp, botType, teamNames = '', version = '1.21.10', minecraftToken = null) {
  const viewerPort = 3001 + parseInt(botId);
  const botProcess = spawn('node', [path.join(__dirname, 'bot.js'), username, uuid, serverIp, botType, botId, teamNames, version], {
    env: { ...process.env, MC_USERNAME: username, MC_UUID: uuid, SERVER_IP: serverIp, BOT_TYPE: botType, BOT_ID: botId, TEAM_NAMES: teamNames, MC_VERSION: version, MC_TOKEN: minecraftToken || '' },
    stdio: ['pipe', 'pipe', 'pipe', 'ipc']
  });
  
  const logs = [];
  botLogs.set(botId, logs);
  
  botProcess.stdout.on('data', (d) => { const msg = d.toString(); logs.push(msg); console.log(`[Bot ${botId}] ${msg}`); });
  botProcess.stderr.on('data', (d) => { const msg = d.toString(); logs.push(`ERROR: ${msg}`); console.error(`[Bot ${botId}] ${msg}`); });
  
  botProcess.on('message', (msg) => {
    if (msg.type === 'log') logs.push(msg.message);
    if (msg.type === 'stats') botStats.set(botId, msg.stats);
    if (msg.type === 'inventory') botInventory.set(botId, msg.inventory);
  });
  
  botProcesses.set(botId, botProcess);
  
  // تشغيل ngrok تلقائياً للكاميرا (إذا توفر token)
  if (process.env.NGROK_AUTH_TOKEN) {
    try {
      const url = await ngrok.connect({ addr: viewerPort, authtoken: process.env.NGROK_AUTH_TOKEN });
      botNgrokUrls.set(botId, url);
      console.log(`🌐 كاميرا البوت ${botId} متاحة على: ${url}`);
    } catch (err) {
      console.error(`❌ فشل تشغيل ngrok للبوت ${botId}:`, err.message);
    }
  } else {
    console.log(`⚠️ لم يتم تعيين NGROK_AUTH_TOKEN، لن تعمل الكاميرا على السحابة.`);
  }
  
  return { process: botProcess, logs };
}

async function stopBot(botId) {
  const p = botProcesses.get(botId);
  if (p) { p.kill(); botProcesses.delete(botId); }
  const ngrokUrl = botNgrokUrls.get(botId);
  if (ngrokUrl) await ngrok.disconnect(ngrokUrl).catch(console.error);
  botNgrokUrls.delete(botId);
  botLogs.delete(botId);
  botStats.delete(botId);
  botInventory.delete(botId);
  return !!p;
}

function getBotLogs(botId) { return botLogs.get(botId) || []; }
function getBotStats(botId) { return botStats.get(botId) || { health: 20, food: 20, position: '0,0,0', armor: 'لا يوجد', weapon: 'لا يوجد', level: 0, kills: 0, deaths: 0 }; }
function getBotInventory(botId) { return botInventory.get(botId) || { inventory: [], helmet: 'فارغ', chest: 'فارغ', legs: 'فارغ', boots: 'فارغ', weapon: 'فارغ' }; }
function deleteBot(botId) { stopBot(botId); return true; }
function sendCommand(botId, command, extra = null) { const p = botProcesses.get(botId); if (p) p.send({ type: 'command', command, extra }); }
function getPublicCameraUrl(botId) { return botNgrokUrls.get(botId); }

module.exports = { startBot, stopBot, getBotLogs, getBotStats, getBotInventory, sendCommand, deleteBot, botProcesses, getPublicCameraUrl };