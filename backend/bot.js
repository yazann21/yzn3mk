const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const fs = require('fs');
const path = require('path');
const { Authflow, Titles } = require('prismarine-auth');
const axios = require('axios');
const localtunnel = require('localtunnel');

let bot = null;
let logFile = null;
let viewerStarted = false;
let combatInterval = null;
let huntInterval = null;
let currentTarget = null;
let teamList = [];
let killCount = 0;
let deathCount = 0;
let isDisconnecting = false;
let isEating = false;

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

async function startViewer() {
  if (viewerStarted) return;
  try {
    const viewerPort = parseInt(process.env.VIEWER_PORT) || (8080 + parseInt(config.botId));
    const { mineflayer: mineflayerViewer } = require('prismarine-viewer');
    mineflayerViewer(bot, { port: viewerPort, firstPerson: false, viewDistance: 6 });
    viewerStarted = true;
    log(`🎥 كاميرا محلية على المنفذ ${viewerPort}`);

    const tunnel = await localtunnel({ port: viewerPort });
    log(`🌍 كاميرا عامة عبر LocalTunnel: ${tunnel.url}`);

    const apiUrl = process.env.API_URL || `http://localhost:${process.env.PORT || 3000}`;
    await axios.post(`${apiUrl}/api/register-camera-url`, {
      botId: config.botId,
      url: tunnel.url
    });
  } catch (err) {
    log(`⚠️ فشل تشغيل الكاميرا: ${err.message}`);
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function createBot() {
  const authType = process.env.AUTH_TYPE || 'offline';
  
  log(`📌 [DEBUG] نوع البوت المستلم: ${config.botType}`);
  log(`📌 [DEBUG] نوع المصادقة: ${authType}`);
  
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
  
  bot.on('spawn', async () => {
    log(`📍 ظهر البوت في العالم`);
    
    setTimeout(() => equipEverythingFast(), 100);
    setInterval(() => equipEverythingFast(), 1000);
    setInterval(() => updateStats(), 1000);
    setInterval(() => sendInventory(), 3000);
    
    // الأكل التلقائي
    setInterval(() => {
      if (!bot || !bot.entity || bot.health <= 0) return;
      if (isEating) return;
      if (bot.food < 18 && bot.food > 0) {
        const food = bot.inventory.items().find(i => i.name.includes('bread') || i.name.includes('apple') || i.name.includes('cooked') || i.name.includes('steak') || i.name.includes('golden_apple'));
        if (food) {
          isEating = true;
          bot.equip(food, 'hand').then(() => {
            bot.consume().catch(err => {
              log(`⚠️ فشل الأكل: ${err.message}`);
            }).finally(() => {
              setTimeout(() => { isEating = false; }, 1000);
            });
          }).catch(err => {
            log(`⚠️ فشل تجهيز الطعام: ${err.message}`);
            isEating = false;
          });
          log(`🍴 بدأ أكل ${food.name}`);
        }
      }
    }, 5000);
    
    if (!viewerStarted) await startViewer();

// ========== وضع البياع (SELLER MODE) - النظام الذكي المتطور ==========
if (config.botType === 'seller') {
  const sellCmd = process.env.SELL_COMMAND || '/sell';
  let isProcessing = false;
  let currentWindow = null;
  let saleHistory = [];
  let targetItems = 2800; // الهدف: 2.8K قطعة

  log(`🛒 ===== بدء وضع البياع (النظام الذكي المتطور) ====`);
  log(`🛒 نوع البوت: ${config.botType}`);
  log(`🛒 الأمر المستخدم: ${sellCmd}`);
  log(`🎯 الهدف: بيع ${targetItems} قطعة في كل دورة`);

  // دالة لجلب الأماكن الفارغة في قائمة البيع (0-44 فقط)
  function getEmptyTradeSlots(window) {
    const slots = [];
    for (let i = 0; i <= 44; i++) {
      if (!window.slots[i]) {
        slots.push(i);
      }
    }
    return slots;
  }

  // دالة لجلب الأغراض من المخزون (54-89)
  function getInventoryItems(window) {
    const items = [];
    for (let i = 54; i <= 89; i++) {
      if (window.slots[i]) {
        items.push({ 
          slot: i, 
          name: window.slots[i].name, 
          count: window.slots[i].count 
        });
      }
    }
    return items;
  }

  // دالة لحساب العدد الإجمالي للقطع في المخزون
  function countTotalItems(window) {
    let total = 0;
    for (let i = 54; i <= 89; i++) {
      if (window.slots[i]) {
        total += window.slots[i].count;
      }
    }
    return total;
  }

  // دالة للتحقق من امتلاء قائمة البيع (0-44)
  function isTradeFull(window) {
    for (let i = 0; i <= 44; i++) {
      if (!window.slots[i]) return false;
    }
    return true;
  }

  // دالة لحساب عدد الأغراض في قائمة البيع
  function countTradeItems(window) {
    let count = 0;
    for (let i = 0; i <= 44; i++) {
      if (window.slots[i]) count++;
    }
    return count;
  }

  // دالة لحساب إجمالي القطع في قائمة البيع
  function countTradeTotalItems(window) {
    let total = 0;
    for (let i = 0; i <= 44; i++) {
      if (window.slots[i]) {
        total += window.slots[i].count;
      }
    }
    return total;
  }

  // ===== تحليل الوضع الحالي =====
  function analyzeState(window) {
    const inventoryCount = countTotalItems(window);
    const tradeCount = countTradeItems(window);
    const tradeTotal = countTradeTotalItems(window);
    const isFull = isTradeFull(window);
    const emptySlots = getEmptyTradeSlots(window).length;
    
    return {
      inventoryCount,
      tradeCount,
      tradeTotal,
      isFull,
      emptySlots,
      needToFill: 45 - tradeCount,
      canSell: isFull,
      hasItems: inventoryCount > 0
    };
  }

  async function executeSell(window) {
    if (isProcessing) return;
    isProcessing = true;
    
    try {
      const state = analyzeState(window);
      
      // ===== البوت يفكر: "كم قطعة بعت؟" =====
      if (state.tradeTotal > 0) {
        log(`🧠 التحليل: قطع=${state.inventoryCount}, قائمة البيع=${state.tradeTotal} قطعة, أغراض=${state.tradeCount}/45`);
      } else {
        log(`🧠 التحليل: مخزون=${state.inventoryCount}, قائمة البيع=${state.tradeCount}/45, فارغ=${state.emptySlots}`);
      }

      // ===== الحالة 1: قائمة البيع ممتلئة → بيع =====
      if (state.canSell) {
        const totalItems = state.tradeTotal;
        log(`🛒 قائمة البيع ممتلئة! (${totalItems} قطعة) بيع...`);
        bot.clickWindow(53, 0, 0);
        await sleep(20);
        log(`✅ تم البيع! (${totalItems} قطعة)`);
        
        // تسجيل كمية البيع
        saleHistory.push(totalItems);
        if (saleHistory.length > 10) saleHistory.shift();
        
        isProcessing = false;
        if (currentWindow) {
          setTimeout(() => executeSell(currentWindow), 50);
        }
        return;
      }

      // ===== الحالة 2: في أغراض بالمخزون → انقلها =====
      if (state.hasItems) {
        const items = getInventoryItems(window);
        const emptySlots = getEmptyTradeSlots(window);
        const itemsToMove = Math.min(items.length, emptySlots.length);
        
        if (itemsToMove > 0) {
          // نقل الأغراض بسرعة
          for (let i = 0; i < itemsToMove; i++) {
            const fromSlot = items[i].slot;
            const toSlot = emptySlots[i];
            
            if (window.slots[fromSlot]) {
              bot.clickWindow(fromSlot, 0, 0);
              await sleep(2);
              bot.clickWindow(toSlot, 0, 0);
              await sleep(2);
            }
          }
          log(`✅ تم نقل ${itemsToMove} غرض`);
          
          isProcessing = false;
          if (currentWindow) {
            setTimeout(() => executeSell(currentWindow), 10);
          }
          return;
        }
      }

      // ===== الحالة 3: المخزون فاضي وقائمة البيع مش متعبة → انتظر =====
      if (!state.hasItems && !state.canSell) {
        log(`⏳ المخزون فاضي، قائمة البيع ${state.tradeCount}/45. بستنى أغراض من الأرض...`);
        
        let waitCycles = 0;
        let foundItems = false;
        
        while (!foundItems && !state.canSell) {
          await sleep(200);
          const newState = analyzeState(window);
          
          if (newState.hasItems) {
            log(`📦 وصلت أغراض جديدة! (${newState.inventoryCount} قطعة)`);
            foundItems = true;
            break;
          }
          
          if (newState.canSell) {
            log(`📦 قائمة البيع امتلأت!`);
            foundItems = true;
            break;
          }
          
          waitCycles++;
          if (waitCycles % 25 === 0) {
            log(`⏳ لسا مستني أغراض... (${waitCycles * 0.2} ثانية)`);
          }
        }
        
        isProcessing = false;
        if (currentWindow) {
          setTimeout(() => executeSell(currentWindow), 50);
        }
        return;
      }

      isProcessing = false;
      if (currentWindow) {
        setTimeout(() => executeSell(currentWindow), 50);
      }

    } catch (err) {
      log(`⚠️ خطأ: ${err.message}`);
      isProcessing = false;
      if (currentWindow) {
        setTimeout(() => executeSell(currentWindow), 100);
      }
    }
  }

  // كتابة الأمر /sell بعد 1.5 ثانية
  setTimeout(() => {
    log(`💬 كتابة الأمر ${sellCmd}`);
    bot.chat(sellCmd);
  }, 1500);

  // عند فتح النافذة
  bot.on('windowOpen', (window) => {
    currentWindow = window;
    log(`📦 تم فتح نافذة البيع`);
    setTimeout(() => {
      executeSell(window);
    }, 100);
  });

  // عند إغلاق النافذة
  bot.on('windowClose', (window) => {
    if (window === currentWindow) {
      log(`🚪 النافذة أغلقت! رح أفتحها تاني...`);
      currentWindow = null;
      isProcessing = false;
      setTimeout(() => {
        bot.chat(sellCmd);
      }, 300);
    }
  });

  // عرض إحصائيات البيع كل دقيقة
  setInterval(() => {
    if (saleHistory.length > 0) {
      const avg = saleHistory.reduce((a, b) => a + b, 0) / saleHistory.length;
      const total = saleHistory.reduce((a, b) => a + b, 0);
      log(`📊 إحصائيات: ${saleHistory.length} عملية بيع، متوسط ${Math.round(avg)} قطعة، إجمالي ${total} قطعة`);
    }
  }, 60000);

  log(`🛒 ===== تم إعداد البوت الذكي المتطور بنجاح =====`);
}  
    // ========== الأنواع الأخرى ==========
    if (config.botType === 'afk') {
      bot.on('entityHurt', (e) => { if (e === bot.entity) attackNearest(); });
    } else if (config.botType === 'hunter') {
      huntInterval = setInterval(() => attackNearest(), 2000);
      bot.on('entityHurt', (e) => { if (e === bot.entity) attackNearest(); });
    } else if (config.botType === 'coward') {
      bot.on('entityHurt', (entity) => {
        if (entity === bot.entity) {
          log(`😨 تعرض البوت للضرب! قطع الاتصال فوراً.`);
          if (bot && !isDisconnecting) {
            isDisconnecting = true;
            bot.end();
            setTimeout(() => process.exit(0), 100);
          } else {
            process.exit(0);
          }
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
    viewerStarted = false;
    if (isDisconnecting) {
      process.exit(0);
    }
  });
  
  bot.on('error', (err) => log(`⚠️ خطأ في البوت: ${err.message}`));
}

process.on('message', (msg) => {
  if (msg && msg.type === 'disconnect') {
    log(`📢 استلام أمر قطع الاتصال. يتم قطع الاتصال بالسيرفر...`);
    if (bot && !isDisconnecting) {
      isDisconnecting = true;
      bot.end();
      setTimeout(() => process.exit(0), 500);
    } else {
      process.exit(0);
    }
  } else if (msg && msg.type === 'force_exit') {
    log(`📢 أمر إنهاء فوري (غير نظيف).`);
    process.exit(0);
  }
});

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

createBot();