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
let botStats = { health: 20, food: 20, position: '0,0,0', armor: 'لا يوجد', weapon: 'لا يوجد', xp: 0, level: 0 };
let gearCheckInterval = null;

const args = process.argv.slice(2);
const config = {
  username: process.env.MC_USERNAME || args[0],
  uuid: process.env.MC_UUID || args[1],
  serverIp: process.env.SERVER_IP || args[2],
  botType: process.env.BOT_TYPE || args[3] || 'afk',
  botId: process.env.BOT_ID || args[4] || 'unknown',
  teamNames: process.env.TEAM_NAMES || args[5] || '',
  version: process.env.MC_VERSION || args[6] || '1.21.10'
};

if (config.teamNames) teamList = config.teamNames.split(',').map(n => n.trim().toLowerCase());

const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
logFile = fs.createWriteStream(path.join(logDir, `bot-${config.botId}.log`), { flags: 'a' });

function log(msg) { console.log(msg); logFile.write(`[${new Date().toISOString()}] ${msg}\n`); if (process.send) process.send({ type: 'log', message: msg }); }

function updateStats() {
  if (!bot || !bot.entity) return;
  botStats = {
    health: bot.health || 20,
    food: bot.food || 20,
    position: `${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.y)}, ${Math.floor(bot.entity.position.z)}`,
    armor: getBestArmorName(),
    weapon: getBestWeaponName(),
    xp: bot.experience?.level || 0,
    level: bot.experience?.level || 0
  };
  if (process.send) process.send({ type: 'stats', stats: botStats });
}

function getInventory() {
  if (!bot || !bot.inventory) return { inventory: [], helmet: 'فارغ', chest: 'فارغ', legs: 'فارغ', boots: 'فارغ', weapon: 'فارغ' };
  const items = bot.inventory.slots.map(slot => slot ? { name: slot.name, count: slot.count, slot: slot.slot } : null);
  const helmet = bot.inventory.slots[5]?.name || 'فارغ';
  const chest = bot.inventory.slots[6]?.name || 'فارغ';
  const legs = bot.inventory.slots[7]?.name || 'فارغ';
  const boots = bot.inventory.slots[8]?.name || 'فارغ';
  const weapon = bot.inventory.slots[bot.getEquipmentDestSlot('hand')]?.name || 'فارغ';
  return { inventory: items.slice(9, 45), helmet, chest, legs, boots, weapon };
}

function getBestArmorName() {
  const armorTypes = ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather', 'turtle'];
  for (const type of armorTypes) {
    const chest = bot.inventory.items().find(i => i.name.includes(`${type}_chestplate`));
    if (chest) return `${type}_chestplate`;
  }
  return 'لا يوجد';
}

function getBestWeaponName() {
  const weaponTypes = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword', 'netherite_axe', 'diamond_axe', 'iron_axe'];
  for (const type of weaponTypes) {
    const weapon = bot.inventory.items().find(i => i.name.includes(type));
    if (weapon) return weapon.name.replace('_', ' ');
  }
  return 'لا يوجد';
}

function getBestWeapon() {
  const weaponTypes = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword', 'netherite_axe', 'diamond_axe', 'iron_axe'];
  for (const type of weaponTypes) {
    const weapon = bot.inventory.items().find(item => item.name.includes(type));
    if (weapon) return weapon;
  }
  return null;
}

function findNearestEntity() {
  if (!bot || !bot.entities) return null;
  let nearest = null, nearestDist = 4;
  for (const [id, e] of Object.entries(bot.entities)) {
    if (e === bot.entity || !e.position) continue;
    const dist = bot.entity.position.distanceTo(e.position);
    if (dist < nearestDist) { nearest = e; nearestDist = dist; }
  }
  return nearest;
}

function cleanup() {
  if (combatInterval) clearInterval(combatInterval);
  if (huntInterval) clearInterval(huntInterval);
  if (gearCheckInterval) clearInterval(gearCheckInterval);
  combatInterval = huntInterval = gearCheckInterval = null;
  currentTarget = null;
}

// ========== لبس أفضل درع كامل ==========
function equipBestFullGear() {
  try {
    const armorSlots = [
      { type: 'helmet', slot: 'head', order: ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather', 'turtle'] },
      { type: 'chestplate', slot: 'torso', order: ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'] },
      { type: 'leggings', slot: 'legs', order: ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'] },
      { type: 'boots', slot: 'feet', order: ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'] }
    ];
    
    for (const armor of armorSlots) {
      for (const material of armor.order) {
        const item = bot.inventory.items().find(i => i.name.includes(`${material}_${armor.type}`));
        if (item) {
          bot.equip(item, armor.slot);
          log(`🛡️ لبس ${material}_${armor.type}`);
          break;
        }
      }
    }
    
    // لبس أفضل سلاح
    const weapon = getBestWeapon();
    if (weapon) {
      bot.equip(weapon, 'hand');
      log(`⚔️ لبس ${weapon.name}`);
    }
    
    log(`✅ تم تجهيز البوت بأفضل المعدات`);
  } catch (err) {
    log(`⚠️ خطأ في تجهيز المعدات: ${err.message}`);
  }
}

function autoEat() {
  bot.on('health', () => {
    if (bot.food < 18 && bot.food > 0) {
      const food = bot.inventory.items().find(i => i.name.includes('bread') || i.name.includes('apple') || i.name.includes('cooked') || i.name.includes('steak') || i.name.includes('porkchop'));
      if (food) { bot.equip(food, 'hand'); bot.consume(); log(`🍎 أكل ${food.name}`); }
    }
  });
}

function followAndAttack(entity, name) {
  if (currentTarget === name) return;
  currentTarget = name;
  log(`🏃 يطارد ${name}!`);
  bot.pathfinder.setGoal(new GoalFollow(entity, 2), true);
  if (combatInterval) clearInterval(combatInterval);
  combatInterval = setInterval(() => {
    if (!entity || !entity.position || !bot.entity) { clearInterval(combatInterval); currentTarget = null; return; }
    if (bot.entity.position.distanceTo(entity.position) < 3.5) {
      const weapon = getBestWeapon();
      if (weapon) bot.equip(weapon, 'hand');
      bot.attack(entity);
      log(`⚔️ يضرب ${name}!`);
    }
  }, 400); // أسرع (400ms بدل 600)
  setTimeout(() => { if (combatInterval) { clearInterval(combatInterval); combatInterval = null; currentTarget = null; bot.pathfinder.setGoal(null); } }, 30000);
}

function attackNearest() {
  const nearest = findNearestEntity();
  if (nearest) {
    const player = bot.players[nearest.username];
    if (!player || !teamList.includes(player.username.toLowerCase())) followAndAttack(nearest, nearest.username || 'كائن');
  }
}

function createBot() {
  cleanup();
  log(`🤖 تشغيل بوت ${config.botType} على ${config.serverIp} [${config.version}]`);
  
  bot = mineflayer.createBot({
    host: config.serverIp, username: config.username, auth: 'microsoft', version: config.version,
    checkTimeoutInterval: 0, chatLengthLimit: 256, connectTimeout: 60000, keepAlive: true, viewDistance: 'tiny'
  });

  bot.loadPlugin(pathfinder);

  bot.on('login', () => log(`✅ دخل البوت بنجاح`));
  
  bot.on('spawn', () => {
    log(`📍 ظهر البوت في العالم`);
    try { const mcData = require('minecraft-data')(bot.version); const defaultMove = new Movements(bot, mcData); bot.pathfinder.setMovements(defaultMove); } catch (err) {}
    
    // لبس أفضل معدات فور الظهور
    setTimeout(() => equipBestFullGear(), 1000);
    
    // كل 5 ثواني يتأكد من اللبس (في حال لبس شيء جديد)
    gearCheckInterval = setInterval(() => equipBestFullGear(), 5000);
    
    setInterval(updateStats, 1000);
    
    if (!viewerStarted) {
      try { const viewerPort = 3001 + parseInt(config.botId); require('prismarine-viewer').mineflayer(bot, { port: viewerPort, firstPerson: false, viewDistance: 6 }); log(`🎥 كاميرا: http://localhost:${viewerPort}`); viewerStarted = true; } catch (err) {}
    }
    
    if (config.botType === 'afk') {
      log('😴 وضع المأفك - يضرب بقوة إذا انضرب');
      bot.on('entityHurt', (e) => { if (e === bot.entity) attackNearest(); });
      autoEat();
    } 
    else if (config.botType === 'hunter') {
      log('⚔️ وضع الصياد - يبحث عن اللاعبين ويضربهم');
      huntInterval = setInterval(() => {
        for (const [name, p] of Object.entries(bot.players)) {
          if (p.entity && p.entity !== bot.entity && !teamList.includes(name.toLowerCase())) {
            log(`🎯 صيد: ${name}`);
            followAndAttack(p.entity, name);
            break;
          }
        }
      }, 3000);
      bot.on('entityHurt', (e) => { if (e === bot.entity) attackNearest(); });
      autoEat();
    }
    else if (config.botType === 'coward') {
      log('😨 وضع الجبان');
      bot.on('entityHurt', (e) => {
        if (e === bot.entity) {
          log(`😨 انضرب البوت! يتم قطع الاتصال`);
          isRunning = false;
          bot.end();
          process.exit(0);
        }
      });
      autoEat();
    }
  });

  // كل ما يموت أو يدخل السيرفر مرة ثانية، يلبس المعدات
  bot.on('death', () => {
    log('💀 مات البوت');
    setTimeout(() => equipBestFullGear(), 2000);
  });
  
  bot.on('respawn', () => {
    log(`🔄 ظهر البوت من جديد`);
    setTimeout(() => equipBestFullGear(), 1000);
  });

  bot.on('chat', (username, msg) => log(`💬 [${username}]: ${msg}`));
  bot.on('end', (reason) => { log(`❌ انقطع الاتصال: ${reason}`); cleanup(); viewerStarted = false; if (isRunning) setTimeout(createBot, 5000); });
  bot.on('error', (err) => log(`⚠️ خطأ: ${err.message}`));
}

process.on('SIGINT', () => { log('🛑 إغلاق'); isRunning = false; cleanup(); if (bot) bot.end(); if (logFile) logFile.end(); process.exit(0); });
createBot();