const { spawn } = require('child_process');
const path = require('path');
const ngrok = require('ngrok');

const botProcesses = new Map();
const botLogs = new Map();
const botStats = new Map();
const botInventory = new Map();
const botTunnels = new Map(); // تخزين روابط ngrok لكل بوت

const VIEWER_BASE_PORT = 8080;

// دالة لبدء نفق ngrok لمنفذ الكاميرا
async function startNgrokForBot(botId, port) {
    try {
        const url = await ngrok.connect({
            addr: port,
            authtoken: process.env.NGROK_AUTH_TOKEN || null
        });
        botTunnels.set(botId, url);
        console.log(`🌐 كاميرا البوت ${botId} متاحة على: ${url}`);
        return url;
    } catch (err) {
        console.error(`❌ فشل تشغيل ngrok للبوت ${botId}:`, err.message);
        return null;
    }
}

function startBot(botId, botName, mcToken, serverIp, botType, teamNames = '', version = '1.21.10') {
    const viewerPort = VIEWER_BASE_PORT + parseInt(botId);

    const botProcess = spawn('node', [path.join(__dirname, 'bot.js'), botName, mcToken, serverIp, botType, botId, teamNames, version], {
        env: {
            ...process.env,
            BOT_NAME: botName,
            MC_TOKEN: mcToken,
            SERVER_IP: serverIp,
            BOT_TYPE: botType,
            BOT_ID: botId,
            TEAM_NAMES: teamNames,
            MC_VERSION: version,
            VIEWER_PORT: viewerPort
        },
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
    
    // بدء نفق ngrok للكاميرا بعد ثانية من تشغيل البوت
    setTimeout(() => {
        startNgrokForBot(botId, viewerPort);
    }, 2000);

    console.log(`✅ Bot ${botId} (${botName}) started with camera on port ${viewerPort}`);
    return { process: botProcess, logs };
}

function stopBot(botId) {
    const p = botProcesses.get(botId);
    if (p) {
        p.kill();
        botProcesses.delete(botId);
    }
    // إغلاق نفق ngrok الخاص بالبوت
    const tunnelUrl = botTunnels.get(botId);
    if (tunnelUrl) {
        ngrok.disconnect(tunnelUrl).catch(console.error);
        botTunnels.delete(botId);
    }
    return true;
}

function getBotLogs(botId) {
    return botLogs.get(botId) || [];
}

function getBotStats(botId) {
    return botStats.get(botId) || {
        health: 20,
        food: 20,
        position: '0,0,0',
        armor: 'لا يوجد',
        weapon: 'لا يوجد',
        level: 0,
        kills: 0,
        deaths: 0
    };
}

function getBotInventory(botId) {
    return botInventory.get(botId) || {
        inventory: [],
        helmet: 'فارغ',
        chest: 'فارغ',
        legs: 'فارغ',
        boots: 'فارغ',
        weapon: 'فارغ'
    };
}

function deleteBot(botId) {
    stopBot(botId);
    botLogs.delete(botId);
    botStats.delete(botId);
    botInventory.delete(botId);
    return true;
}

function sendCommand(botId, command, extra = null) {
    const p = botProcesses.get(botId);
    if (p) p.send({ type: 'command', command, extra });
}

function getBotTunnelUrl(botId) {
    return botTunnels.get(botId);
}

module.exports = {
    startBot,
    stopBot,
    getBotLogs,
    getBotStats,
    getBotInventory,
    sendCommand,
    deleteBot,
    botProcesses,
    getBotTunnelUrl
};