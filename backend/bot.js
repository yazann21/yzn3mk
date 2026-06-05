const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const Movements = require('mineflayer-pathfinder').Movements;
const { GoalFollow } = require('mineflayer-pathfinder').goals;
const fs = require('fs');
const path = require('path');

let bot = null;
let isRunning = true;
let logFile = null;
let viewerStarted = false;
let combatInterval = null;
let huntInterval = null;
let currentTarget = null;
let teamList = [];
let gearCheckInterval = null;
let autoTotemInterval = null;
let killCount = 0;
let deathCount = 0;

const args = process.argv.slice(2);
const config = {
  botId: process.env.BOT_ID || args[0] || 'unknown',
  minecraftToken: process.env.MC_TOKEN || args[1] || null,
  username: process.env.BOT_USERNAME || args[2] || 'BotUser',
  profileId: process.env.BOT_PROFILE_ID || args[3] || 'offline-uuid',
  serverIp: process.env.SERVER_IP || args[4],
  botType: process.env.BOT_TYPE || args[5] || 'afk',
  teamNames: process.env.TEAM_NAMES || args[6] || '',
  version: process.env.MC_VERSION || args[7] || '1.21.10'
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

function updateStats() {
  if (!bot || !bot.entity) return;
  const stats = {
    health: bot.health || 20,
    food: bot.food || 20,
    position: `${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.y)}, ${Math.floor(bot.entity.position.z)}`,
    armor: getBestArmorName(),
    weapon: getBestWeaponName(),
    level: bot.experience?.level || 0,
    kills: killCount,
    deaths: deathCount
  };
  if (process.send) process.send({ type: 'stats', stats: stats });
}

function getBestArmorName() {
  const armorTypes = ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'];
  for (const type of armorTypes) {
    const chest = bot.inventory.items().find(i => i.name.includes(`${type}_chestplate`));
    if (chest) return type;
  }
  return 'لا يوجد';
}
function getBestWeaponName() {
  const weaponTypes = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword'];
  for (const type of weaponTypes) {
    const weapon = bot.inventory.items().find(i => i.name.includes(type));
    if (weapon) return weapon.name.replace('_', ' ');
  }
  return 'لا يوجد';
}
function getBestWeapon() {
  const weaponTypes = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword'];
  for (const type of weaponTypes) {
    const weapon = bot.inventory.items().find(item => item.name.includes(type));
    if (weapon) return weapon;
  }
  return null;
}

function equipEverythingFast() {
  try {
    const armorSlots = [
      { type: 'helmet', slot: 'head', order: ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'] },
      { type: 'chestplate', slot: 'torso', order: ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'] },
      { type: 'leggings', slot: 'legs', order: ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'] },
      { type: 'boots', slot: 'feet', order: ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'] }
    ];
    for (const armor of armorSlots) {
      for (const material of armor.order) {
        const item = bot.inventory.items().find(i => i.name.includes(`${material}_${armor.type}`));
        if (item) { bot.equip(item, armor.slot); break; }
      }
    }
    const weapon = getBestWeapon();
    if (weapon) bot.equip(weapon, 'hand');
    const totem = bot.inventory.items().find(i => i.name.includes('totem'));
    if (totem && bot.supportFeature('doesntHaveOffHandSlot')) bot.equip(totem, 'off-hand');
  } catch (err) {}
}

function sendInventory() {
  if (!bot || !bot.inventory) return;
  const items = bot.inventory.slots.map(slot => slot ? { name: slot.name, count: slot.count, slot: slot.slot } : null);
  const helmet = bot.inventory.slots[5]?.name || 'فارغ';
  const chest = bot.inventory.slots[6]?.name || 'فارغ';
  const legs = bot.inventory.slots[7]?.name || 'فارغ';
  const boots = bot.inventory.slots[8]?.name || 'فارغ';
  const weapon = bot.inventory.slots[bot.getEquipmentDestSlot('hand')]?.name || 'فارغ';
  process.send({ type: 'inventory', inventory: items.slice(9, 45), helmet, chest, legs, boots, weapon });
}

function followAndAttack(entity, name) {
  if (currentTarget === name) return;
  currentTarget = name;
  log(`🏃 يطارد ${name}!`);
  bot.pathfinder.setGoal(new GoalFollow(entity, 2.5), true);
  if (combatInterval) clearInterval(combatInterval);
  combatInterval = setInterval(() => {
    if (!entity || !entity.position || !bot.entity) { clearInterval(combatInterval); currentTarget = null; return; }
    const distance = bot.entity.position.distanceTo(entity.position);
    if (distance < 4) {
      const weapon = getBestWeapon();
      if (weapon) bot.equip(weapon, 'hand');
      bot.attack(entity);
      log(`⚔️ يضرب ${name}!`);
    } else if (distance < 15) {
      bot.pathfinder.setGoal(new GoalFollow(entity, 2.5), true);
    }
  }, 300);
  setTimeout(() => { if (combatInterval) { clearInterval(combatInterval); combatInterval = null; currentTarget = null; bot.pathfinder.setGoal(null); } }, 45000);
}

function attackNearest() {
  let nearest = null, nearestDist = 20;
  for (const [name, player] of Object.entries(bot.players)) {
    if (!player.entity || player.entity === bot.entity) continue;
    if (teamList.includes(name.toLowerCase())) continue;
    const dist = bot.entity.position.distanceTo(player.entity.position);
    if (dist < nearestDist) { nearest = player.entity; nearestDist = dist; }
  }
  if (nearest) {
    const playerName = Object.keys(bot.players).find(name => bot.players[name].entity === nearest);
    if (playerName && !teamList.includes(playerName.toLowerCase())) followAndAttack(nearest, playerName);
  }
}

function createBot() {
  log(`🤖 تشغيل بوت ${config.botType} على ${config.serverIp} [${config.version}] باسم ${config.username}`);
  
  const auth = config.minecraftToken ? 'microsoft' : 'offline';
  const authConfig = {
    host: config.serverIp,
    port: 25565,
    username: config.username,
    auth: auth,
    version: config.version,
    checkTimeoutInterval: 0,
    connectTimeout: 60000,
    keepAlive: true,
    viewDistance: 'tiny'
  };
  
  if (config.minecraftToken && config.profileId) {
    authConfig.session = {
      accessToken: config.minecraftToken,
      selectedProfile: { id: config.profileId, name: config.username }
    };
  }
  
  bot = mineflayer.createBot(authConfig);

  bot.loadPlugin(pathfinder);

  bot.on('login', () => log(`✅ دخل البوت بنجاح باسم ${bot.username}`));
  
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
    
    if (!viewerStarted) {
      try { 
        const viewerPort = parseInt(process.env.VIEWER_PORT) || (8080 + parseInt(config.botId));
        require('prismarine-viewer').mineflayer(bot, { port: viewerPort, firstPerson: false, viewDistance: 6 }); 
        viewerStarted = true; 
        log(`🎥 كاميرا: http://localhost:${viewerPort}`);
      } catch (err) { log(`⚠️ فشل تشغيل الكاميرا: ${err.message}`); }
    }
    
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
  bot.on('end', (reason) => { log(`❌ انقطع الاتصال: ${reason}`); cleanup(); viewerStarted = false; if (isRunning) setTimeout(createBot, 5000); });
  bot.on('error', (err) => log(`⚠️ خطأ: ${err.message}`));
}

function cleanup() {
  if (combatInterval) clearInterval(combatInterval);
  if (huntInterval) clearInterval(huntInterval);
  if (gearCheckInterval) clearInterval(gearCheckInterval);
  if (autoTotemInterval) clearInterval(autoTotemInterval);
  combatInterval = huntInterval = gearCheckInterval = autoTotemInterval = null;
  currentTarget = null;
}

process.on('SIGINT', () => { log('🛑 إغلاق'); cleanup(); if (bot) bot.end(); process.exit(0); });
createBot();