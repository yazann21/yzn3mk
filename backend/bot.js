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
let healthCheckInterval = null;
let autoTotemInterval = null;

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

function log(msg) { 
  const timestamp = new Date().toISOString();
  const shortMsg = msg.length > 200 ? msg.substring(0, 200) + '...' : msg;
  console.log(`[${timestamp}] ${shortMsg}`); 
  logFile.write(`[${timestamp}] ${msg}\n`); 
  if (process.send) process.send({ type: 'log', message: msg }); 
}

// ========== إحصائيات البوت ==========
function updateStats() {
  if (!bot || !bot.entity) return;
  const stats = {
    health: bot.health || 20,
    food: bot.food || 20,
    position: `${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.y)}, ${Math.floor(bot.entity.position.z)}`,
    armor: getBestArmorName(),
    weapon: getBestWeaponName(),
    level: bot.experience?.level || 0
  };
  if (process.send) process.send({ type: 'stats', stats: stats });
}

// ========== الحصول على أفضل درع ==========
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

function hasTotem() {
  return bot.inventory.items().some(i => i.name.includes('totem'));
}

// ========== تجهيز كل المعدات بسرعة ==========
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
        if (item) {
          bot.equip(item, armor.slot);
          break;
        }
      }
    }
    
    const weapon = getBestWeapon();
    if (weapon) bot.equip(weapon, 'hand');
    
    // تجهيز التوتم
    const totem = bot.inventory.items().find(i => i.name.includes('totem'));
    if (totem && bot.supportFeature('doesntHaveOffHandSlot')) {
      bot.equip(totem, 'off-hand');
    }
  } catch (err) {}
}

// ========== Auto Totem - يجهز التوتم باستمرار ==========
function autoTotem() {
  if (!bot || !bot.inventory) return;
  try {
    const totem = bot.inventory.items().find(i => i.name.includes('totem_of_undying') || i.name.includes('totem'));
    if (totem && bot.supportFeature('doesntHaveOffHandSlot')) {
      const currentOffHand = bot.inventory.slots[45];
      if (!currentOffHand || !currentOffHand.name.includes('totem')) {
        bot.equip(totem, 'off-hand');
      }
    }
  } catch (err) {}
}

// ========== حركات نوكباك ذكية (crits + strafing) ==========
let critMode = false;
let strafeDirection = 1;

function smartAttack(entity) {
  if (!entity || !bot.entity) return;
  
  const distance = bot.entity.position.distanceTo(entity.position);
  
  // ضربات حرجة (قفز قبل الضرب)
  if (!bot.entity.isOnGround && distance < 3.5) {
    bot.attack(entity);
    critMode = true;
  } 
  // ضربات عادية
  else if (distance < 3.5) {
    bot.attack(entity);
    // حركة مراوغة ذكية (strafing)
    if (Math.random() < 0.3) {
      strafeDirection = -strafeDirection;
      bot.setControlState('left', strafeDirection === 1);
      bot.setControlState('right', strafeDirection === -1);
      setTimeout(() => {
        bot.setControlState('left', false);
        bot.setControlState('right', false);
      }, 200);
    }
  }
}

function findNearestEntity() {
  if (!bot || !bot.entities) return null;
  let nearest = null, nearestDist = 5;
  for (const [id, e] of Object.entries(bot.entities)) {
    if (e === bot.entity || !e.position) continue;
    const dist = bot.entity.position.distanceTo(e.position);
    if (dist < nearestDist) { nearest = e; nearestDist = dist; }
  }
  return nearest;
}

function findNearestPlayer() {
  if (!bot || !bot.players) return null;
  let nearest = null, nearestDist = 20;
  for (const [name, player] of Object.entries(bot.players)) {
    if (!player.entity || player.entity === bot.entity) continue;
    if (teamList.includes(name.toLowerCase())) continue;
    const dist = bot.entity.position.distanceTo(player.entity.position);
    if (dist < nearestDist) { nearest = player.entity; nearestDist = dist; }
  }
  return nearest;
}

function cleanup() {
  if (combatInterval) clearInterval(combatInterval);
  if (huntInterval) clearInterval(huntInterval);
  if (gearCheckInterval) clearInterval(gearCheckInterval);
  if (healthCheckInterval) clearInterval(healthCheckInterval);
  if (autoTotemInterval) clearInterval(autoTotemInterval);
  combatInterval = huntInterval = gearCheckInterval = healthCheckInterval = autoTotemInterval = null;
  currentTarget = null;
}

function autoEat() {
  if (bot.food < 18 && bot.food > 0) {
    const food = bot.inventory.items().find(i => 
      i.name.includes('bread') || i.name.includes('apple') || 
      i.name.includes('cooked') || i.name.includes('steak') ||
      i.name.includes('golden_carrot')
    );
    if (food) { 
      bot.equip(food, 'hand'); 
      bot.consume(); 
    }
  }
}

// ========== مطاردة وهجوم متواصل ==========
function followAndAttack(entity, name) {
  if (currentTarget === name || !entity) return;
  currentTarget = name;
  
  bot.pathfinder.setGoal(new GoalFollow(entity, 2.5), true);
  
  if (combatInterval) clearInterval(combatInterval);
  
  combatInterval = setInterval(() => {
    if (!entity || !entity.position || !bot.entity) { 
      clearInterval(combatInterval); 
      currentTarget = null; 
      return; 
    }
    
    const distance = bot.entity.position.distanceTo(entity.position);
    
    if (distance < 4) {
      smartAttack(entity);
    } else if (distance < 15) {
      bot.pathfinder.setGoal(new GoalFollow(entity, 2.5), true);
    }
    
  }, 250); // أسرع بين الضربات
}

function attackNearest() {
  const nearest = findNearestPlayer();
  if (nearest) {
    const playerName = Object.keys(bot.players).find(name => bot.players[name].entity === nearest);
    if (playerName && !teamList.includes(playerName.toLowerCase())) {
      followAndAttack(nearest, playerName);
    }
  }
}

// ========== تشغيل البوت ==========
function createBot() {
  cleanup();
  
  let version = config.version;
  if (config.serverIp.includes('hypixel.net')) version = '1.8.9';
  else if (version === 'auto') version = '1.21.10';
  
  log(`تشغيل بوت ${config.botType} على ${config.serverIp}`);
  
  bot = mineflayer.createBot({
    host: config.serverIp,
    username: config.username,
    auth: 'microsoft',
    version: version,
    checkTimeoutInterval: 0,
    chatLengthLimit: 256,
    connectTimeout: 60000,
    keepAlive: true,
    viewDistance: 'tiny'
  });

  bot.loadPlugin(pathfinder);

  bot.on('login', () => {});
  
  bot.on('spawn', () => {
    // تجهيز كل شيء فوراً
    setTimeout(() => equipEverythingFast(), 500);
    
    // فحص المعدات كل ثانية
    gearCheckInterval = setInterval(() => equipEverythingFast(), 1000);
    
    // Auto Totem كل نصف ثانية
    autoTotemInterval = setInterval(() => autoTotem(), 500);
    
    setInterval(() => updateStats(), 1000);
    setInterval(() => autoEat(), 1000);
    
    // كاميرا
    if (!viewerStarted) {
      try { 
        const viewerPort = 3001 + parseInt(config.botId); 
        require('prismarine-viewer').mineflayer(bot, { port: viewerPort, firstPerson: false, viewDistance: 6 }); 
        viewerStarted = true; 
      } catch (err) {}
    }
    
    if (config.botType === 'afk') {
      bot.on('entityHurt', (e) => { if (e === bot.entity) attackNearest(); });
    } 
    else if (config.botType === 'hunter') {
      huntInterval = setInterval(() => attackNearest(), 2000);
      bot.on('entityHurt', (e) => { if (e === bot.entity) attackNearest(); });
    }
    else if (config.botType === 'coward') {
      bot.on('entityHurt', (e) => {
        if (e === bot.entity) {
          isRunning = false;
          bot.end();
          process.exit(0);
        }
      });
    }
  });

  bot.on('death', () => { setTimeout(() => equipEverythingFast(), 1000); });
  bot.on('respawn', () => { setTimeout(() => equipEverythingFast(), 1000); });
  bot.on('end', (reason) => { cleanup(); viewerStarted = false; if (isRunning) setTimeout(createBot, 5000); });
}

process.on('SIGINT', () => { isRunning = false; cleanup(); if (bot) bot.end(); process.exit(0); });
createBot();