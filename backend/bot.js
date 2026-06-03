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
let healthCheckInterval = null;
let lastAttacker = null;

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
  if (!bot || !bot.inventory) return { inventory: [], helmet: 'فارغ', chest: 'فارغ', legs: 'فارغ', boots: 'فارغ', weapon: 'فارغ', totem: 'لا يوجد' };
  const items = bot.inventory.slots.map(slot => slot ? { name: slot.name, count: slot.count, slot: slot.slot } : null);
  const helmet = bot.inventory.slots[5]?.name || 'فارغ';
  const chest = bot.inventory.slots[6]?.name || 'فارغ';
  const legs = bot.inventory.slots[7]?.name || 'فارغ';
  const boots = bot.inventory.slots[8]?.name || 'فارغ';
  const weapon = bot.inventory.slots[bot.getEquipmentDestSlot('hand')]?.name || 'فارغ';
  const totem = bot.inventory.items().find(i => i.name.includes('totem')) ? '✅ يوجد' : '❌ لا يوجد';
  return { inventory: items.slice(9, 45), helmet, chest, legs, boots, weapon, totem };
}

function getBestArmorName() {
  const armorTypes = ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'];
  for (const type of armorTypes) {
    const chest = bot.inventory.items().find(i => i.name.includes(`${type}_chestplate`));
    if (chest) return `${type}`;
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

function hasTotem() {
  return bot.inventory.items().some(i => i.name.includes('totem'));
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

function cleanup() {
  if (combatInterval) clearInterval(combatInterval);
  if (huntInterval) clearInterval(huntInterval);
  if (gearCheckInterval) clearInterval(gearCheckInterval);
  if (healthCheckInterval) clearInterval(healthCheckInterval);
  combatInterval = huntInterval = gearCheckInterval = healthCheckInterval = null;
  currentTarget = null;
  lastAttacker = null;
}

// ========== لبس كل شيء فوراً (مو حبة حبة) ==========
function equipEverythingFast() {
  try {
    // لبس جميع قطع الدرع دفعة واحدة
    const armorTypes = [
      { type: 'helmet', slot: 'head', order: ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'] },
      { type: 'chestplate', slot: 'torso', order: ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'] },
      { type: 'leggings', slot: 'legs', order: ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'] },
      { type: 'boots', slot: 'feet', order: ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'] }
    ];
    
    let equipped = false;
    for (const armor of armorTypes) {
      for (const material of armor.order) {
        const item = bot.inventory.items().find(i => i.name.includes(`${material}_${armor.type}`));
        if (item) {
          bot.equip(item, armor.slot);
          log(`🛡️ لبس ${material}_${armor.type}`);
          equipped = true;
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
    
    // تجهيز التوتم في اليد الثانية (off-hand)
    const totem = bot.inventory.items().find(i => i.name.includes('totem'));
    if (totem && bot.supportFeature('doesntHaveOffHandSlot')) {
      bot.equip(totem, 'off-hand');
      log(`🪄 تم تجهيز التوتم في اليد الثانية`);
    } else if (totem) {
      log(`🪄 يوجد توتم في المخزون (النسخة ما تدعم اليد الثانية)`);
    }
    
    if (equipped) log(`✅ تم تجهيز المعدات بالكامل`);
  } catch (err) {
    log(`⚠️ خطأ في التجهيز: ${err.message}`);
  }
}

// ========== فحص الصحة والتوتم بشكل مستمر ==========
function healthAndTotemCheck() {
  if (!bot || !bot.entity) return;
  
  // فحص الصحة - إذا الصحة قليلة، حاول يهرب أو يستخدم التوتم
  if (bot.health < 8) {
    log(`⚠️ الصحة منخفضة (${bot.health}), محاولة الابتعاد...`);
    if (hasTotem()) {
      log(`🪄 يوجد توتم، سينشط تلقائياً عند الموت`);
    } else {
      log(`😨 لا يوجد توتم، يفضل الابتعاد عن القتال`);
    }
  }
  
  // فحص التوتم بشكل مستمر وإشعار
  if (hasTotem()) {
    // كل شيء تمام
  }
}

function autoEat() {
  if (bot.food < 18 && bot.food > 0) {
    const food = bot.inventory.items().find(i => 
      i.name.includes('bread') || i.name.includes('apple') || 
      i.name.includes('cooked') || i.name.includes('steak') ||
      i.name.includes('porkchop') || i.name.includes('golden_carrot')
    );
    if (food) { 
      bot.equip(food, 'hand'); 
      bot.consume(); 
      log(`🍎 أكل ${food.name}`);
    }
  }
}

function followAndAttack(entity, name) {
  if (currentTarget === name) return;
  currentTarget = name;
  log(`🏃 يطارد ${name}!`);
  
  // استخدام GoalFollow للمطاردة الذكية مع مسافة مناسبة
  bot.pathfinder.setGoal(new GoalFollow(entity, 2.5), true);
  
  if (combatInterval) clearInterval(combatInterval);
  
  // هجوم سريع وذكي
  combatInterval = setInterval(() => {
    if (!entity || !entity.position || !bot.entity) { 
      clearInterval(combatInterval); 
      currentTarget = null; 
      return; 
    }
    
    const distance = bot.entity.position.distanceTo(entity.position);
    
    // إذا كان قريب كفاية، يضرب
    if (distance < 3.5) {
      const weapon = getBestWeapon();
      if (weapon) bot.equip(weapon, 'hand');
      
      // يضرب بسرعة (كل 0.3 ثانية)
      bot.attack(entity);
      log(`⚔️ يضرب ${name}! (المسافة: ${distance.toFixed(1)})`);
    }
    // إذا كان بعيد، يستمر في المطاردة
    else if (distance < 10) {
      bot.pathfinder.setGoal(new GoalFollow(entity, 2.5), true);
    }
    
  }, 300); // 0.3 ثانية بين الضربات
  
  // يوقف القتال بعد 45 ثانية (يضل يضرب لحد ما يقتل)
  setTimeout(() => { 
    if (combatInterval) { 
      clearInterval(combatInterval); 
      combatInterval = null; 
      currentTarget = null; 
      bot.pathfinder.setGoal(null);
      log(`⏹️ توقف عن مطاردة ${name} (وقت القتال انتهى)`);
    } 
  }, 45000);
}

function attackNearest() {
  const nearest = findNearestEntity();
  if (nearest) {
    const player = bot.players[nearest.username];
    if (player && !teamList.includes(player.username.toLowerCase())) {
      followAndAttack(nearest, nearest.username);
    } else if (!player) {
      followAndAttack(nearest, 'مخلوق');
    }
  }
}

function createBot() {
  cleanup();
  log(`🤖 تشغيل بوت ذكي (${config.botType}) على ${config.serverIp} [${config.version}]`);
  
  bot = mineflayer.createBot({
    host: config.serverIp, username: config.username, auth: 'microsoft', version: config.version,
    checkTimeoutInterval: 0, chatLengthLimit: 256, connectTimeout: 60000, keepAlive: true, viewDistance: 'tiny'
  });

  bot.loadPlugin(pathfinder);

  bot.on('login', () => log(`✅ دخل البوت بنجاح`));
  
  bot.on('spawn', () => {
    log(`📍 ظهر البوت في العالم`);
    try { 
      const mcData = require('minecraft-data')(bot.version); 
      const defaultMove = new Movements(bot, mcData); 
      bot.pathfinder.setMovements(defaultMove); 
    } catch (err) {}
    
    // تجهيز المعدات فوراً
    equipEverythingFast();
    
    // فحص المعدات كل ثانية (مو كل 5 ثواني)
    gearCheckInterval = setInterval(() => equipEverythingFast(), 1000);
    
    // فحص الصحة والتوتم كل ثانية
    healthCheckInterval = setInterval(() => healthAndTotemCheck(), 1000);
    
    // تحديث الإحصائيات كل ثانية
    setInterval(updateStats, 1000);
    
    // فحص الجوع كل ثانية
    setInterval(() => autoEat(), 1000);
    
    if (!viewerStarted) {
      try { 
        const viewerPort = 3001 + parseInt(config.botId); 
        require('prismarine-viewer').mineflayer(bot, { port: viewerPort, firstPerson: false, viewDistance: 6 }); 
        log(`🎥 كاميرا: http://localhost:${viewerPort}`); 
        viewerStarted = true; 
      } catch (err) {}
    }
    
    if (config.botType === 'afk') {
      log('😴 وضع المأفك الذكي - يضرب بقوة ويحاول يتجنب الموت');
      bot.on('entityHurt', (e) => { 
        if (e === bot.entity) {
          const attacker = findNearestEntity();
          if (attacker) log(`💥 انضرب! يرد الهجوم بقوة`);
          attackNearest(); 
        } 
      });
    } 
    else if (config.botType === 'hunter') {
      log('⚔️ وضع الصياد الذكي - يبحث عن اللاعبين ويطاردهم');
      huntInterval = setInterval(() => {
        for (const [name, p] of Object.entries(bot.players)) {
          if (p.entity && p.entity !== bot.entity && !teamList.includes(name.toLowerCase())) {
            log(`🎯 صيد: ${name}`);
            followAndAttack(p.entity, name);
            break;
          }
        }
      }, 2000); // كل ثانيتين
      bot.on('entityHurt', (e) => { if (e === bot.entity) attackNearest(); });
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
    }
  });

  bot.on('death', () => {
    log('💀 مات البوت');
    setTimeout(() => equipEverythingFast(), 1000);
  });
  
  bot.on('respawn', () => {
    log(`🔄 ظهر البوت من جديد`);
    setTimeout(() => equipEverythingFast(), 1000);
  });

  bot.on('chat', (username, msg) => log(`💬 [${username}]: ${msg}`));
  bot.on('end', (reason) => { log(`❌ انقطع الاتصال: ${reason}`); cleanup(); viewerStarted = false; if (isRunning) setTimeout(createBot, 5000); });
  bot.on('error', (err) => log(`⚠️ خطأ: ${err.message}`));
}

process.on('SIGINT', () => { log('🛑 إغلاق'); isRunning = false; cleanup(); if (bot) bot.end(); if (logFile) logFile.end(); process.exit(0); });
createBot();