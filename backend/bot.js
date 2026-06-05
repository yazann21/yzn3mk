const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const fs = require('fs');
const path = require('path');
const { Authflow, Titles } = require('prismarine-auth');
const axios = require('axios');

let bot = null;
let logFile = null;
let combatInterval = null;
let huntInterval = null;
let currentTarget = null;
let teamList = [];
let killCount = 0;
let deathCount = 0;

const args = process.argv.slice(2);
const config = {
  botId: process.env.BOT_ID || args[0] || 'unknown',
  minecraftToken: process.env.MC_TOKEN || args[1] || null,
  username: process.env.BOT_USERNAME || args[2] || 'BotUser',
  profileId: process.env.BOT_PROFILE_ID || args[3] || null,
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
  if (!bot.inventory) return 'لا يوجد';
  const armorTypes = ['netherite', 'diamond', 'iron', 'golden', 'chainmail', 'leather'];
  for (const type of armorTypes) {
    const chest = bot.inventory.items().find(i => i.name.includes(`${type}_chestplate`));
    if (chest) return type;
  }
  return 'لا يوجد';
}

function getBestWeaponName() {
  if (!bot.inventory) return 'لا يوجد';
  const weaponTypes = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword'];
  for (const type of weaponTypes) {
    const weapon = bot.inventory.items().find(i => i.name.includes(type));
    if (weapon) return weapon.name.replace('_', ' ');
  }
  return 'لا يوجد';
}

function getBestWeapon() {
  if (!bot.inventory) return null;
  const weaponTypes = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword'];
  for (const type of weaponTypes) {
    const weapon = bot.inventory.items().find(item => item.name.includes(type));
    if (weapon) return weapon;
  }
  return null;
}

function equipEverythingFast() {
  if (!bot.inventory) return;
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
  const { GoalFollow } = require('mineflayer-pathfinder').goals;
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

async function authenticateBot() {
  log(`🔐 بدء مصادقة مايكروسوفت للحصول على توكن حساب حقيقي...`);
  const userIdentifier = `bot_${config.botId}_${Date.now()}`;
  const flow = new Authflow(userIdentifier, './ms-cache', {
    authTitle: Titles.MinecraftJava,
    deviceType: 'Win32',
    flow: 'sisu',
    onMsaCode: (data) => {
      log(`🔗 رابط المصادقة: ${data.verification_uri}`);
      log(`🔢 الرمز: ${data.user_code}`);
      log(`⏱️ الرمز صالح لمدة ${data.expires_in} ثانية`);
      log(`📌 الرجاء فتح الرابط في متصفح (يفضل نافذة خاصة) وإدخال الرمز`);
    }
  });
  const tokenResult = await flow.getMinecraftJavaToken({ fetchProfile: true });
  if (tokenResult && tokenResult.token && tokenResult.profile) {
    log(`✅ تم الحصول على توكن الحساب: ${tokenResult.profile.name}`);
    const apiUrl = process.env.API_URL || 'http://localhost:3000';
    try {
      await axios.post(`${apiUrl}/api/save-bot-token`, {
        botId: config.botId,
        mcToken: tokenResult.token,
        mcUsername: tokenResult.profile.name,
        mcProfileId: tokenResult.profile.id
      });
      log(`💾 تم حفظ التوكن في قاعدة البيانات`);
      return tokenResult;
    } catch (err) {
      log(`❌ فشل حفظ التوكن على الخادم: ${err.message}`);
      throw err;
    }
  } else {
    throw new Error('فشل الحصول على التوكن');
  }
}

function cleanup() {
  if (combatInterval) clearInterval(combatInterval);
  if (huntInterval) clearInterval(huntInterval);
  combatInterval = huntInterval = null;
  currentTarget = null;
}

async function createBot() {
  const authType = process.env.AUTH_TYPE || 'offline';
  
  if (authType === 'microsoft' && (!config.minecraftToken || config.minecraftToken === '')) {
    log(`⚠️ البوت من نوع "حساب حقيقي" لكن لا يوجد توكن مخزن. سيتم بدء المصادقة...`);
    try {
      const tokenData = await authenticateBot();
      config.minecraftToken = tokenData.token;
      config.username = tokenData.profile.name;
      config.profileId = tokenData.profile.id;
    } catch (err) {
      log(`❌ فشل المصادقة: ${err.message}`);
      log(`❌ لن يتم تشغيل البوت بدون توكن صالح.`);
      process.exit(1);
    }
  }

  log(`🤖 تشغيل بوت ${config.botType} على ${config.serverIp} [${config.version}] باسم ${config.username} (${config.minecraftToken ? 'حساب حقيقي' : 'وضع غير مسجل'})`);
  
  const authConfig = {
    host: config.serverIp,
    port: 25565,
    username: config.username,
    version: config.version,
    auth: config.minecraftToken ? 'microsoft' : 'offline',
    session: config.minecraftToken ? {
      accessToken: config.minecraftToken,
      selectedProfile: { id: config.profileId, name: config.username }
    } : undefined,
    connectTimeout: 5000,
    checkTimeoutInterval: 0,
    keepAlive: true,
    viewDistance: 'tiny',
    skipValidation: true,
  };
  
  bot = mineflayer.createBot(authConfig);
  bot.loadPlugin(pathfinder);

  bot.on('login', () => log(`✅ دخل البوت بنجاح باسم ${bot.username}`));
  
  bot.on('spawn', () => {
    log(`📍 ظهر البوت في العالم`);
    setTimeout(() => equipEverythingFast(), 100);
    setInterval(() => equipEverythingFast(), 1000);
    setInterval(() => updateStats(), 1000);
    setInterval(() => sendInventory(), 3000);
    setInterval(() => {
      if (bot.food < 18 && bot.food > 0) {
        const food = bot.inventory.items().find(i => i.name.includes('bread') || i.name.includes('apple') || i.name.includes('cooked') || i.name.includes('steak'));
        if (food) { bot.equip(food, 'hand'); bot.consume(); log(`🍎 أكل ${food.name}`); }
      }
    }, 1000);
    
    if (config.botType === 'afk') {
      bot.on('entityHurt', (e) => { if (e === bot.entity) attackNearest(); });
    } else if (config.botType === 'hunter') {
      huntInterval = setInterval(() => attackNearest(), 2000);
      bot.on('entityHurt', (e) => { if (e === bot.entity) attackNearest(); });
    } else if (config.botType === 'coward') {
      bot.on('entityHurt', (entity) => {
        if (entity === bot.entity) {
          log(`😨 تعرض البوت للضرب! قطع الاتصال فوراً.`);
          bot.end(); // فقط ننهي الاتصال، والمكتبة ستعيد المحاولة بسرعة
        }
      });
    }
  });

  bot.on('death', () => {
    deathCount++;
    log(`💀 مات البوت (إجمالي الوفيات: ${deathCount})`);
    setTimeout(() => equipEverythingFast(), 500);
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
  
  bot.on('end', (reason) => {
    log(`❌ انقطع الاتصال: ${reason}`);
    cleanup();
    // لا حاجة لإعادة الاتصال اليدوي، mineflayer يقوم بذلك تلقائياً بسرعة
  });
  
  bot.on('error', (err) => log(`⚠️ خطأ في البوت: ${err.message}`));
}

// استجابة فورية لأمر الإنهاء من الأب
process.on('message', (msg) => {
  if (msg && msg.type === 'force_exit') {
    // خروج فوري بدون أي تنظيف
    process.exit(0);
  }
});

process.on('SIGINT', () => {
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.exit(0);
});

createBot();