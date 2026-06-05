const { spawn } = require('child_process');
const path = require('path');

const botProcesses = new Map();
const botLogs = new Map();
const botStats = new Map();
const botInventory = new Map();

const VIEWER_BASE_PORT = 8080;

function startBot(botId, botName, mcToken, mcUsername, mcProfileId, serverIp, botType, teamNames = '', version = '1.21.10', authType = 'offline') {
    const viewerPort = VIEWER_BASE_PORT + parseInt(botId);
    // إعداد متغيرات البيئة لتمريرها للبوت الفرعي
    const envVars = {
        ...process.env,
        BOT_ID: botId,
        MC_TOKEN: mcToken || '',
        BOT_USERNAME: mcUsername || botName,
        BOT_PROFILE_ID: mcProfileId || '',
        SERVER_IP: serverIp,
        BOT_TYPE: botType,
        TEAM_NAMES: teamNames,
        MC_VERSION: version,
        VIEWER_PORT: viewerPort,
        AUTH_TYPE: authType,          // 'microsoft' أو 'offline'
        API_URL: process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`
    };

    const botProcess = spawn('node', [path.join(__dirname, 'bot.js')], {
        env: envVars,
        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    const logs = [];
    botLogs.set(botId, logs);

    botProcess.stdout.on('data', (d) => {
        const msg = d.toString();
        logs.push(msg);
        console.log(`[Bot ${botId}] ${msg}`);
    });

    botProcess.stderr.on('data', (d) => {
        const msg = d.toString();
        logs.push(`ERROR: ${msg}`);
        console.error(`[Bot ${botId}] ${msg}`);
    });

    botProcess.on('message', (msg) => {
        if (msg.type === 'log') logs.push(msg.message);
        if (msg.type === 'stats') botStats.set(botId, msg.stats);
        if (msg.type === 'inventory') botInventory.set(botId, msg.inventory);
    });

    botProcesses.set(botId, botProcess);
    console.log(`✅ Bot ${botId} (${mcUsername || botName}) started with camera on port ${viewerPort}`);
    return { process: botProcess, logs };
}

function stopBot(botId) {
    const p = botProcesses.get(botId);
    if (p) { p.kill(); botProcesses.delete(botId); return true; }
    return false;
}

function getBotLogs(botId) { return botLogs.get(botId) || []; }
function getBotStats(botId) { return botStats.get(botId) || { health: 20, food: 20, position: '0,0,0', armor: 'لا يوجد', weapon: 'لا يوجد', level: 0, kills: 0, deaths: 0 }; }
function getBotInventory(botId) { return botInventory.get(botId) || { inventory: [], helmet: 'فارغ', chest: 'فارغ', legs: 'فارغ', boots: 'فارغ', weapon: 'فارغ' }; }
function deleteBot(botId) { stopBot(botId); return true; }
function sendCommand(botId, command, extra = null) { const p = botProcesses.get(botId); if (p) p.send({ type: 'command', command, extra }); }

module.exports = { startBot, stopBot, getBotLogs, getBotStats, getBotInventory, sendCommand, deleteBot, botProcesses };