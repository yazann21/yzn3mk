const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const fs = require('fs');
const path = require('path');
const { Authflow, Titles } = require('prismarine-auth');

let bot = null;
let currentWindow = null;
let flow = null;
let sellCommandSent = false;
let totalItems = 0;
let totalSales = 0;
let startTime = Date.now();
let isProcessing = false;

// متغيرات إضافية للأوضاع الأخرى
let combatInterval = null;
let huntInterval = null;
let currentTarget = null;
let teamList = [];
let killCount = 0;
let deathCount = 0;
let isDisconnecting = false;
let isEating = false;
let logFile = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 999;

const args = process.argv.slice(2);
const config = {
  botId: process.env.BOT_ID || args[0] || 'unknown',
  minecraftToken: process.env.MC_TOKEN || args[1] || null,
  username: process.env.BOT_USERNAME || args[2] || 'Ss51',
  profileId: process.env.BOT_PROFILE_ID || args[3] || null,
  serverIp: process.env.SERVER_IP || args[4] || 'donutsmp.net',
  botType: process.env.BOT_TYPE || args[5] || 'seller',
  teamNames: process.env.TEAM_NAMES || args[6] || '',
  version: process.env.MC_VERSION || args[7] || '1.21'
};

if (config.teamNames) teamList = config.teamNames.split(',').map(n => n.trim().toLowerCase());

const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
logFile = fs.createWriteStream(path.join(logDir, `bot-${config.botId}.log`), { flags: 'a' });

function log(msg) { 
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${msg}`); 
  logFile.write(`[${timestamp}] ${msg}\n`); 
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ===== دوال البيع (معدلة لتكون بنفس سرعة الكود الثاني) =====
function getInventorySlots(window) {
  const slots = [];
  for (let i = 54; i <= 89; i++) {
    if (window.slots[i]) {
      slots.push(i);
    }
  }
  return slots;
}

function countTradeItems(window) {
  let count = 0;
  for (let i = 0; i <= 44; i++) {
    if (window.slots[i]) count++;
  }
  return count;
}

// ===== نقل الأغراض بـ Shift + Click (معدل ليكون بنفس سرعة الكود الثاني) =====
async function moveAllItems(window) {
  if (isProcessing) return;
  isProcessing = true;
  
  try {
    // 1. جلب كل السلوتات في المخزون (54-89)
    const inventorySlots = getInventorySlots(window);
    
    if (inventorySlots.length === 0) {
      log(`⚠️ المخزون فارغ`);
      isProcessing = false;
      return;
    }
    
    log(`📦 نقل ${inventorySlots.length} غرض بـ Shift+Click`);
    
    // 2. Shift + Click على كل غرض في المخزون
    for (const slot of inventorySlots) {
      if (window.slots[slot]) {
        bot.clickWindow(slot, 0, 1); // Shift + Click
        await sleep(3); // تأخير صغير جداً (نفس الكود الثاني)
      }
    }
    
    log(`✅ تم نقل كل الأغراض`);
    
    // 3. التحقق المستمر: هل امتلأت القائمة؟
    let checkCount = 0;
    const maxChecks = 200; // 200 × 50ms = 10 ثواني كحد أقصى
    
    while (checkCount < maxChecks) {
      const tradeCount = countTradeItems(window);
      
      if (tradeCount >= 45) {
        log(`🎯 القائمة ممتلئة! (${tradeCount}/45)`);
        break;
      }
      
      // إذا كان في أغراض متبقية في المخزون → انقلها
      const remaining = getInventorySlots(window);
      if (remaining.length > 0) {
        log(`📦 نقل ${remaining.length} غرض متبقي`);
        for (const slot of remaining) {
          if (window.slots[slot]) {
            bot.clickWindow(slot, 0, 1);
            await sleep(3);
          }
        }
      }
      
      await sleep(50);
      checkCount++;
    }
    
    // 4. إغلاق النافذة (بيع تلقائي)
    const finalCount = countTradeItems(window);
    if (finalCount > 0) {
      await sleep(50);
      log(`🚪 إغلاق النافذة (بيع ${finalCount} غرض)`);
      bot.closeWindow(window);
      
      // كتابة /sell مرة ثانية
      sellCommandSent = false;
      setTimeout(() => {
        if (bot) {
          log(`💬 كتابة /sell`);
          bot.chat('/sell');
          sellCommandSent = true;
        }
      }, 300);
    } else {
      log(`⚠️ لا توجد أغراض للبيع`);
    }
    
  } catch (err) {
    log(`⚠️ خطأ: ${err.message}`);
  } finally {
    isProcessing = false;
  }
}

// ===== المصادقة (نفس الكود الأصلي) =====
async function authenticate() {
  flow = new Authflow('bot_seller', './ms-cache', {
    authTitle: Titles.MinecraftJava,
    deviceType: 'Win32',
    flow: 'sisu',
    onMsaCode: (data) => {
      log(`🔗 ${data.verification_uri}`);
      log(`🔢 ${data.user_code}`);
    }
  });
  
  const tokenResult = await flow.getMinecraftJavaToken({ fetchProfile: true });
  if (tokenResult && tokenResult.token && tokenResult.profile) {
    log(`✅ ${tokenResult.profile.name}`);
    return tokenResult;
  } else {
    throw new Error('فشل المصادقة');
  }
}

// ===== دوال للأوضاع الأخرى =====
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
  } catch (err) {}
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

function cleanup() {
  if (combatInterval) clearInterval(combatInterval);
  if (huntInterval) clearInterval(huntInterval);
  combatInterval = huntInterval = null;
  currentTarget = null;
}

// ===== تشغيل البوت =====
async function startBot() {
  try {
    const tokenData = await authenticate();
    startTime = Date.now();
    totalItems = 0;
    totalSales = 0;
    
    bot = mineflayer.createBot({
      host: config.serverIp,
      port: 25565,
      username: tokenData.profile.name,
      version: config.version,
      auth: 'microsoft',
      session: {
        accessToken: tokenData.token,
        selectedProfile: { id: tokenData.profile.id, name: tokenData.profile.name }
      }
    });
    
    bot.loadPlugin(pathfinder);

    bot.on('login', () => log(`✅ دخل`));
    
    bot.on('spawn', () => {
      log(`📍 ظهر البوت في العالم`);
      
      setTimeout(() => equipEverythingFast(), 100);
      setInterval(() => equipEverythingFast(), 1000);
      
      // ===== وضع البياع (SELLER) - معدل ليكون مطابقاً للكود الثاني =====
      if (config.botType === 'seller') {
        log(`🛒 تفعيل وضع البياع`);
        
        // كتابة /sell بعد 1.5 ثانية (نفس الكود الثاني)
        setTimeout(() => {
          if (bot && !sellCommandSent) {
            sellCommandSent = true;
            bot.chat('/sell');
            log(`💬 كتابة /sell`);
          }
        }, 1500);
        
        // معالج فتح النافذة (نفس الكود الثاني)
        bot.on('windowOpen', async (window) => {
          currentWindow = window;
          log(`📦 نافذة مفتوحة`);
          isProcessing = false;
          await sleep(50);
          moveAllItems(window);
        });
        
        // معالج إغلاق النافذة (نفس الكود الثاني)
        bot.on('windowClose', () => {
          currentWindow = null;
          log(`📦 نافذة مقفلة`);
        });
      
      // ===== وضع AFK =====
      } else if (config.botType === 'afk') {
        bot.on('entityHurt', (e) => { if (e === bot.entity) attackNearest(); });
      
      // ===== وضع HUNTER =====
      } else if (config.botType === 'hunter') {
        huntInterval = setInterval(() => attackNearest(), 2000);
        bot.on('entityHurt', (e) => { if (e === bot.entity) attackNearest(); });
      
      // ===== وضع COWARD =====
      } else if (config.botType === 'coward') {
        bot.on('entityHurt', (entity) => {
          if (entity === bot.entity) {
            log(`😨 تعرض البوت للضرب! قطع الاتصال فوراً.`);
            if (bot && !isDisconnecting) {
              isDisconnecting = true;
              bot.end();
              setTimeout(() => process.exit(0), 100);
            }
          }
        });
      }
    });
    
    bot.on('error', (err) => log(`⚠️ ${err.message}`));
    
    bot.on('end', () => {
      currentWindow = null;
      sellCommandSent = false;
      cleanup();
      log(`🔄 إعادة تشغيل...`);
      setTimeout(startBot, 3000);
    });
    
    log(`🤖 شغال بوضع: ${config.botType}`);
    
  } catch (err) {
    log(`❌ ${err.message}`);
    setTimeout(startBot, 5000);
  }
}

process.on('SIGINT', () => {
  if (bot && !isDisconnecting) {
    isDisconnecting = true;
    bot.end();
    setTimeout(() => process.exit(0), 500);
  } else {
    process.exit(0);
  }
});

process.on('SIGTERM', () => {
  if (bot && !isDisconnecting) {
    isDisconnecting = true;
    bot.end();
    setTimeout(() => process.exit(0), 500);
  } else {
    process.exit(0);
  }
});

startBot();