const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const Movements = require('mineflayer-pathfinder').Movements;
const { GoalFollow } = require('mineflayer-pathfinder').goals;
const fs = require('fs');
const path = require('path');

let bot = null;
let isRunning = true;
let logFile = null;
let combatInterval = null;
let huntInterval = null;
let currentTarget = null;
let teamList = [];
let gearCheckInterval = null;
let autoTotemInterval = null;
let scheduledTasks = [];
let killCount = 0;
let deathCount = 0;

const args = process.argv.slice(2);
const config = {
  username: process.env.MC_USERNAME || args[0],
  uuid: process.env.MC_UUID || args[1],
  serverIp: process.env.SERVER_IP || args[2],
  botType: process.env.BOT_TYPE || args[3] || 'afk',
  botId: process.env.BOT_ID || args[4] || 'unknown',
  teamNames: process.env.TEAM_NAMES || args[5] || '',
  version: process.env.MC_VERSION || args[6] || '1.21.10',
  minecraftToken: process.env.MC_TOKEN || null
};

if (config.teamNames) teamList = config.teamNames.split(',').map(n => n.trim().toLowerCase());

const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
logFile = fs.createWriteStream(path.join(logDir, `bot-${config.botId}.log`), { flags: 'a' });

function log(msg) { 
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${msg}`); 
  logFile.write(`[${timestamp}] ${msg}\n`); 
  if (process.send) process.send({ type: 'log', message: msg }); 
}

// ... توابع getBestArmor و getBestWeapon و equipEverythingFast (نفس الكود القديم) ...
function updateStats() { /* نفس الكود القديم */ }
function getBestArmorName() { /* نفس الكود القديم */ }
function getBestWeaponName() { /* نفس الكود القديم */ }
function getBestWeapon() { /* نفس الكود القديم */ }
function equipEverythingFast() { /* نفس الكود القديم */ }
function sendInventory() { /* نفس الكود القديم */ }
function loadTasks() { /* نفس الكود القديم */ }
function followAndAttack(entity, name) { /* نفس الكود القديم */ }
function attackNearest() { /* نفس الكود القديم */ }

function createBot() {
  log(`🤖 تشغيل بوت ${config.botType} على ${config.serverIp} [${config.version}]`);
  const auth = config.minecraftToken ? 'microsoft' : 'offline';
  bot = mineflayer.createBot({
    host: config.serverIp,
    username: config.username,
    auth: auth,
    version: config.version,
    session: config.minecraftToken ? { accessToken: config.minecraftToken, selectedProfile: { id: config.uuid, name: config.username } } : null,
    checkTimeoutInterval: 0,
    connectTimeout: 60000,
    keepAlive: true,
    viewDistance: 'tiny'
  });

  bot.loadPlugin(pathfinder);

  bot.on('login', () => log(`✅ دخل البوت بنجاح`));
  
  bot.on('spawn', () => {
    log(`📍 ظهر البوت في العالم`);
    setTimeout(() => equipEverythingFast(), 500);
    gearCheckInterval = setInterval(() => equipEverythingFast(), 1000);
    autoTotemInterval = setInterval(() => {
      const totem = bot.inventory.items().find(i => i.name.includes('totem'));
      if (totem && bot.supportFeature('doesntHaveOffHandSlot')) bot.equip(totem, 'off-hand');
    }, 500);
    setInterval(() => updateStats(), 1000);
    setInterval(() => sendInventory(), 3000);
    setInterval(() => {
      if (bot.food < 18 && bot.food > 0) {
        const food = bot.inventory.items().find(i => i.name.includes('bread') || i.name.includes('apple') || i.name.includes('cooked') || i.name.includes('steak'));
        if (food) { bot.equip(food, 'hand'); bot.consume(); log(`🍎 أكل ${food.name}`); }
      }
    }, 1000);
    
    // --- دمج الكاميرا: إرسال إشارة للـ Server لبدء خدمة الـ viewer ---
    if (process.send) {
      process.send({ type: 'spawned', viewerPort: 0 });
    }
    
    loadTasks();
    
    if (config.botType === 'afk') {
      bot.on('entityHurt', (e) => { if (e === bot.entity) attackNearest(); });
    } else if (config.botType === 'hunter') {
      huntInterval = setInterval(() => attackNearest(), 2000);
      bot.on('entityHurt', (e) => { if (e === bot.entity) attackNearest(); });
    } else if (config.botType === 'coward') {
      bot.on('entityHurt', (e) => { if (e === bot.entity) { log(`😨 انضرب البوت! يتم قطع الاتصال`); isRunning = false; bot.end(); process.exit(0); } });
    }
  });

  bot.on('death', () => {
    deathCount++;
    log(`💀 مات البوت (إجمالي الوفيات: ${deathCount})`);
    setTimeout(() => equipEverythingFast(), 1000);
  });
  
  bot.on('entityHurt', (entity) => {
    if (entity === bot.entity) return;
    const player = bot.players[entity.username];
    if (player && player !== bot.player && !teamList.includes(entity.username?.toLowerCase())) {
      killCount++;
      log(`⚔️ قتل ${entity.username}! (إجمالي القتلى: ${killCount})`);
    }
  });

  bot.on('chat', (username, msg) => log(`💬 [${username}]: ${msg}`));
  bot.on('end', (reason) => { log(`❌ انقطع الاتصال: ${reason}`); cleanup(); if (isRunning) setTimeout(createBot, 5000); });
}

function cleanup() {
  if (combatInterval) clearInterval(combatInterval);
  if (huntInterval) clearInterval(huntInterval);
  if (gearCheckInterval) clearInterval(gearCheckInterval);
  if (autoTotemInterval) clearInterval(autoTotemInterval);
  scheduledTasks.forEach(task => clearInterval(task.interval));
  combatInterval = huntInterval = gearCheckInterval = autoTotemInterval = null;
  scheduledTasks = [];
  currentTarget = null;
}

process.on('SIGINT', () => { log('🛑 إغلاق'); cleanup(); if (bot) bot.end(); process.exit(0); });
createBot();