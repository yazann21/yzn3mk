let sessionId = null;
let currentUser = null;
let currentBots = [];
let logsInterval = null;
let controlBotId = null;
let statsInterval = null;
let inventoryInterval = null;
let currentInventory = [];
let selectedSlot = null;

const urlParams = new URLSearchParams(window.location.search);
const sessionFromUrl = urlParams.get('session');
const usernameFromUrl = urlParams.get('username');
const uuidFromUrl = urlParams.get('uuid');

// إصدارات السيرفرات الخاصة
const specialServerVersions = {
    'hypixel.net': '1.8.9',
    'donutsmp.net': '1.21.10',
    'donut': '1.21.10'
};

// جميع الإصدارات المتاحة
const allVersions = [
    '1.21.11', '1.21.10', '1.21.9', '1.21.8', '1.21.7',
    '1.21.6', '1.21.5', '1.21.4', '1.21.3', '1.21.2', '1.21.1', '1.21',
    '1.20.4', '1.20.3', '1.20.2', '1.20.1', '1.20',
    '1.19.4', '1.19.2', '1.19',
    '1.18.2', '1.18.1', '1.18',
    '1.17.1', '1.17',
    '1.16.5', '1.16.4', '1.16.3', '1.16.2', '1.16.1', '1.16',
    '1.15.2', '1.15.1', '1.15',
    '1.14.4', '1.14.3', '1.14.2', '1.14.1', '1.14',
    '1.13.2', '1.13.1', '1.13',
    '1.12.2', '1.12.1', '1.12',
    '1.11.2', '1.11.1', '1.11',
    '1.10.2', '1.10.1', '1.10',
    '1.9.4', '1.9.3', '1.9.2', '1.9.1', '1.9',
    '1.8.9', '1.8.8'
];

// ========== تهيئة الصفحة ==========
if (sessionFromUrl && usernameFromUrl && uuidFromUrl) {
    sessionId = sessionFromUrl;
    currentUser = { username: decodeURIComponent(usernameFromUrl), uuid: uuidFromUrl };
    localStorage.setItem('sessionId', sessionId);
    localStorage.setItem('user', JSON.stringify(currentUser));
    window.history.replaceState({}, document.title, '/');
    showApp();
    loadDashboard();
} else {
    const savedSession = localStorage.getItem('sessionId');
    const savedUser = localStorage.getItem('user');
    if (savedSession && savedUser) {
        sessionId = savedSession;
        currentUser = JSON.parse(savedUser);
        verifySession();
    } else {
        showLogin();
    }
}

// ========== دوال تسجيل الدخول ==========
function showLogin() {
    document.getElementById('loginScreen').style.display = 'flex';
}

function hideLogin() {
    document.getElementById('loginScreen').style.display = 'none';
}

function showApp() {
    hideLogin();
    document.getElementById('profileUsername').innerHTML = currentUser?.username || 'Unknown';
    document.getElementById('settingsUsername').innerHTML = currentUser?.username || 'Unknown';
    document.getElementById('settingsUuid').innerHTML = currentUser?.uuid || 'N/A';
    document.getElementById('welcomeUsername').innerHTML = currentUser?.username || 'User';
}

function verifySession() {
    fetch(`/api/user/${sessionId}`)
        .then(res => {
            if (res.status === 401) {
                localStorage.clear();
                showLogin();
            } else {
                showApp();
                loadDashboard();
            }
        })
        .catch(() => showLogin());
}

// ========== تسجيل الخروج ==========
function logout() {
    localStorage.clear();
    sessionId = null;
    currentUser = null;
    showLogin();
}

// ========== التنقل بين الصفحات ==========
function navigateTo(page) {
    document.querySelectorAll('.page-content').forEach(p => p.classList.remove('active'));
    document.getElementById(`${page}Page`).classList.add('active');
    
    document.querySelectorAll('.nav-item').forEach(nav => nav.classList.remove('active'));
    document.querySelector(`.nav-item[data-page="${page}"]`).classList.add('active');
    
    if (page === 'bots') loadBots();
    if (page === 'dashboard') loadDashboard();
}

document.querySelectorAll('.nav-item').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.page));
});

document.getElementById('logoutButton')?.addEventListener('click', logout);
document.getElementById('loginButton')?.addEventListener('click', () => {
    fetch('/auth/login')
        .then(res => res.json())
        .then(data => { if (data.url) window.location.href = data.url; });
});

document.getElementById('createNewBotBtn')?.addEventListener('click', () => navigateTo('create'));

// ========== تحديث الإصدارات حسب السيرفر ==========
function updateVersionsForServer(serverIp) {
    const serverLower = serverIp.toLowerCase();
    const versionSelect = document.getElementById('createVersion');
    if (!versionSelect) return;
    
    for (const [key, forcedVersion] of Object.entries(specialServerVersions)) {
        if (serverLower.includes(key)) {
            versionSelect.innerHTML = `<option value="${forcedVersion}">🔒 ${forcedVersion} (الإصدار المطلوب لهذا السيرفر)</option>`;
            showServerWarning(serverLower);
            return;
        }
    }
    
    // سيرفر عادي - كل الإصدارات متاحة
    versionSelect.innerHTML = allVersions.map(v => `<option value="${v}">${v}</option>`).join('');
    hideServerWarning();
}

function showServerWarning(serverName) {
    let warning = document.getElementById('serverWarning');
    if (!warning) {
        warning = document.createElement('div');
        warning.id = 'serverWarning';
        warning.className = 'info-box warning-box';
        document.querySelector('#createPage .form-container')?.appendChild(warning);
    }
    
    if (serverName.includes('hypixel')) {
        warning.innerHTML = '⚠️ <strong>تنبيه:</strong> سيرفر Hypixel يدعم فقط الإصدار 1.8.9 للبوتات. استخدام إصدار آخر سيؤدي إلى قطع الاتصال.';
        warning.style.borderLeftColor = '#ef4444';
    } else if (serverName.includes('donut')) {
        warning.innerHTML = '🍩 <strong>DonutSMP:</strong> الإصدارات المدعومة: 1.21, 1.21.1, 1.21.2';
        warning.style.borderLeftColor = '#f59e0b';
    }
}

function hideServerWarning() {
    const warning = document.getElementById('serverWarning');
    if (warning) warning.remove();
}

// ========== إظهار/إخفاء حقل الأصدقاء ==========
function toggleTeamField() {
    const botType = document.getElementById('createBotType').value;
    const teamGroup = document.getElementById('teamInputGroup');
    if (teamGroup) {
        teamGroup.style.display = botType === 'hunter' ? 'block' : 'none';
    }
}

document.getElementById('createBotType')?.addEventListener('change', toggleTeamField);
document.getElementById('createServerIp')?.addEventListener('input', (e) => updateVersionsForServer(e.target.value));
document.getElementById('editBotType')?.addEventListener('change', (e) => {
    const teamRow = document.getElementById('editTeamGroup');
    if (teamRow) teamRow.style.display = e.target.value === 'hunter' ? 'block' : 'none';
});

// ========== لوحة التحكم ==========
function loadDashboard() {
    fetch(`/api/bots/${sessionId}`)
        .then(res => res.json())
        .then(data => {
            const bots = data.bots || [];
            document.getElementById('statTotalBots').innerHTML = bots.length;
            document.getElementById('statOnlineBots').innerHTML = bots.filter(b => b.status === 'online').length;
            document.getElementById('statServers').innerHTML = [...new Set(bots.map(b => b.server_ip))].length;
            
            const recentHtml = bots.slice(0, 4).map(b => `
                <div class="bot-card" onclick="openBotControl(${b.id}, '${escapeHtml(b.bot_name)}')">
                    <div class="bot-header">
                        <span class="bot-name">${escapeHtml(b.bot_name)}</span>
                        <span class="bot-status"><span class="status-dot ${b.status === 'online' ? 'online' : 'offline'}"></span> ${b.status === 'online' ? 'متصل' : 'متوقف'}</span>
                    </div>
                    <div class="bot-details">📡 ${escapeHtml(b.server_ip)}<br>🎮 ${getBotTypeName(b.bot_type)}</div>
                </div>
            `).join('');
            document.getElementById('recentBotsContainer').innerHTML = recentHtml || '<div class="placeholder">لا توجد بوتات بعد</div>';
        });
}

// ========== تحميل البوتات ==========
function loadBots() {
    fetch(`/api/bots/${sessionId}`)
        .then(res => res.json())
        .then(data => {
            currentBots = data.bots || [];
            const container = document.getElementById('botsGrid');
            if (!container) return;
            
            if (currentBots.length === 0) {
                container.innerHTML = '<div class="placeholder">🤖 لا توجد بوتات بعد. اضغط "بوت جديد" لإنشاء أول بوت</div>';
                return;
            }
            
            container.innerHTML = currentBots.map(b => `
                <div class="bot-card" onclick="openBotControl(${b.id}, '${escapeHtml(b.bot_name)}')">
                    <div class="bot-header">
                        <span class="bot-name">${escapeHtml(b.bot_name)}</span>
                        <span class="bot-status"><span class="status-dot ${b.status === 'online' ? 'online' : 'offline'}"></span> ${b.status === 'online' ? 'متصل' : 'متوقف'}</span>
                    </div>
                    <div class="bot-details">
                        📡 ${escapeHtml(b.server_ip)}<br>
                        🎮 ${getBotTypeName(b.bot_type)}<br>
                        🔧 ${b.version || '1.21.10'}
                    </div>
                    <div class="bot-actions" onclick="event.stopPropagation()">
                        ${b.status === 'online' 
                            ? `<button class="btn-stop" onclick="stopBot(${b.id})">⏹️ إيقاف</button>
                               <button class="btn-restart" onclick="restartBot(${b.id})">🔄 إعادة تشغيل</button>`
                            : `<button class="btn-start" onclick="startBot(${b.id})">▶️ تشغيل</button>`
                        }
                        <button class="btn-camera" onclick="openCameraViewer(${b.id})">📷 كاميرا</button>
                        <button class="btn-logs" onclick="openLogs(${b.id}, '${escapeHtml(b.bot_name)}')">📋 سجلات</button>
                        <button class="btn-edit" onclick="openEditModal(${b.id})">✏️ تعديل</button>
                        <button class="btn-delete" onclick="deleteBot(${b.id})">🗑️ حذف</button>
                    </div>
                </div>
            `).join('');
        });
}

function getBotTypeName(type) {
    const types = { 'afk': 'مأفك', 'hunter': 'صياد', 'coward': 'جبان' };
    return types[type] || type;
}

// ========== عمليات البوت الأساسية ==========
function startBot(id) {
    fetch('/api/start-cloud-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, botId: parseInt(id) })
    }).then(() => { loadBots(); loadDashboard(); });
}

function stopBot(id) {
    fetch('/api/stop-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, botId: parseInt(id) })
    }).then(() => { loadBots(); loadDashboard(); });
}

function restartBot(id) {
    fetch('/api/restart-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, botId: parseInt(id) })
    }).then(() => { setTimeout(() => { loadBots(); loadDashboard(); }, 2000); });
}

function deleteBot(id) {
    if (confirm('هل أنت متأكد من حذف هذا البوت؟')) {
        fetch('/api/delete-bot', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId, botId: parseInt(id) })
        }).then(() => { loadBots(); loadDashboard(); });
    }
}

// ========== كاميرا ==========
function openCameraViewer(id) {
    const port = 3001 + parseInt(id);
    window.open(`http://localhost:${port}`, '_blank', 'width=1200,height=800');
}

// ========== تعديل بوت ==========
function openEditModal(id) {
    const bot = currentBots.find(b => b.id === id);
    if (!bot) return;
    
    document.getElementById('editBotId').value = bot.id;
    document.getElementById('editBotName').value = bot.bot_name;
    document.getElementById('editBotType').value = bot.bot_type;
    document.getElementById('editServerIp').value = bot.server_ip;
    document.getElementById('editTeamNames').value = bot.team_names || '';
    document.getElementById('editVersion').value = bot.version || '1.21.10';
    
    const teamRow = document.getElementById('editTeamGroup');
    if (teamRow) teamRow.style.display = bot.bot_type === 'hunter' ? 'block' : 'none';
    
    document.getElementById('editModal').style.display = 'flex';
}

function closeEditModal() {
    document.getElementById('editModal').style.display = 'none';
}

function saveEditBot() {
    const botId = parseInt(document.getElementById('editBotId').value);
    const botName = document.getElementById('editBotName').value;
    const botType = document.getElementById('editBotType').value;
    const serverIp = document.getElementById('editServerIp').value;
    const teamNames = document.getElementById('editTeamNames').value;
    const version = document.getElementById('editVersion').value;
    
    fetch('/api/update-bot', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, botId, botName, botType, serverIp, teamNames, version })
    }).then(() => {
        closeEditModal();
        loadBots();
    });
}

// ========== إنشاء بوت ==========
document.getElementById('createBotForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const botName = document.getElementById('createBotName').value;
    const botType = document.getElementById('createBotType').value;
    const serverIp = document.getElementById('createServerIp').value;
    const teamNames = document.getElementById('createTeamNames').value;
    const version = document.getElementById('createVersion').value;
    
    if (!botName || !serverIp) {
        alert('الرجاء تعبئة جميع الحقول المطلوبة');
        return;
    }
    
    fetch('/api/create-bot-cloud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, botName, botType, serverIp, teamNames, version })
    }).then(res => res.json()).then(data => {
        if (data.error) {
            alert('خطأ: ' + data.error);
        } else {
            alert('✓ تم إنشاء البوت بنجاح!');
            document.getElementById('createBotForm').reset();
            navigateTo('bots');
        }
    });
});

// تهيئة خيارات الإصدارات عند تحميل الصفحة
updateVersionsForServer('');
toggleTeamField();

// ========== سجلات البوت ==========
function openLogs(id, name) {
    const modal = document.getElementById('logsModal');
    const title = document.getElementById('logsBotName');
    if (title) title.textContent = name;
    modal.style.display = 'flex';
    
    if (logsInterval) clearInterval(logsInterval);
    
    const fetchLogs = () => {
        fetch(`/api/bot-logs/${id}`).then(res => res.json()).then(data => {
            const logsText = document.getElementById('logsText');
            if (logsText) logsText.innerHTML = (data.logs || []).join('\n');
        });
    };
    fetchLogs();
    logsInterval = setInterval(fetchLogs, 3000);
}

function closeLogs() {
    if (logsInterval) clearInterval(logsInterval);
    document.getElementById('logsModal').style.display = 'none';
}

function refreshLogs() {
    if (logsInterval) {
        clearInterval(logsInterval);
        logsInterval = setInterval(() => {
            const modal = document.getElementById('logsModal');
            if (modal.style.display === 'flex') {
                fetch(`/api/bot-logs/${currentLogsBotId}`).then(res => res.json()).then(data => {
                    document.getElementById('logsText').innerHTML = (data.logs || []).join('\n');
                });
            }
        }, 3000);
    }
}

function clearLogs() {
    if (currentLogsBotId) {
        fetch(`/api/clear-logs/${currentLogsBotId}`, { method: 'POST' }).catch(console.error);
        refreshLogs();
    }
}

// ========== التحكم الكامل بالبوت ==========
function openBotControl(id, name) {
    controlBotId = id;
    document.getElementById('controlTitle').innerHTML = `🎮 التحكم بـ ${name}`;
    const cameraFrame = document.getElementById('cameraFrame');
    if (cameraFrame) cameraFrame.src = `http://localhost:${3001 + id}`;
    document.getElementById('controlModal').style.display = 'flex';
    
    if (statsInterval) clearInterval(statsInterval);
    if (inventoryInterval) clearInterval(inventoryInterval);
    
    statsInterval = setInterval(() => fetchBotStats(id), 2000);
    inventoryInterval = setInterval(() => fetchInventory(id), 3000);
    
    fetchBotStats(id);
    fetchInventory(id);
}

function closeBotControl() {
    if (statsInterval) clearInterval(statsInterval);
    if (inventoryInterval) clearInterval(inventoryInterval);
    document.getElementById('controlModal').style.display = 'none';
    const cameraFrame = document.getElementById('cameraFrame');
    if (cameraFrame) cameraFrame.src = 'about:blank';
    controlBotId = null;
}

function fetchBotStats(id) {
    fetch(`/api/bot-stats/${id}`).then(res => res.json()).then(data => {
        document.getElementById('statHealth').innerHTML = data.health || '--';
        document.getElementById('statFood').innerHTML = data.food || '--';
        document.getElementById('statPosition').innerHTML = data.position || '--';
        document.getElementById('statArmor').innerHTML = data.armor || 'لا يوجد';
        document.getElementById('statWeapon').innerHTML = data.weapon || 'لا يوجد';
        document.getElementById('statLevel').innerHTML = data.level || '--';
        document.getElementById('detailLevel').innerHTML = data.level || '--';
        document.getElementById('detailXp').innerHTML = data.xp || '--';
        document.getElementById('detailType').innerHTML = getBotTypeName(currentBots.find(b => b.id === id)?.bot_type);
        document.getElementById('detailServer').innerHTML = currentBots.find(b => b.id === id)?.server_ip;
        document.getElementById('detailVersion').innerHTML = currentBots.find(b => b.id === id)?.version;
    }).catch(() => {});
}

function fetchInventory(id) {
    fetch(`/api/bot-inventory/${id}`).then(res => res.json()).then(data => {
        if (data.inventory) {
            currentInventory = data.inventory;
            renderInventory();
            document.getElementById('invHelmet').innerHTML = data.helmet || 'فارغ';
            document.getElementById('invChest').innerHTML = data.chest || 'فارغ';
            document.getElementById('invLegs').innerHTML = data.legs || 'فارغ';
            document.getElementById('invBoots').innerHTML = data.boots || 'فارغ';
            document.getElementById('invWeapon').innerHTML = data.weapon || 'فارغ';
        }
    }).catch(() => {});
}

function renderInventory() {
    const grid = document.getElementById('inventoryGrid');
    if (!grid) return;
    grid.innerHTML = '';
    for (let i = 0; i < 36; i++) {
        const item = currentInventory[i];
        const div = document.createElement('div');
        div.className = 'inv-slot' + (selectedSlot === i ? ' selected' : '');
        div.innerHTML = item ? `${item.name}<br><small>${item.count || 1}</small>` : '🗑️';
        div.onclick = () => selectSlot(i);
        grid.appendChild(div);
    }
}

function selectSlot(slot) {
    selectedSlot = slot;
    renderInventory();
}

function refreshInventory() {
    if (controlBotId) fetchInventory(controlBotId);
}

// ========== إرسال الأوامر ==========
function sendCommand(cmd, extra = null) {
    if (!controlBotId) return;
    fetch('/api/bot-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ botId: controlBotId, command: cmd, extra })
    });
}

function sendChatMessage() {
    const msg = document.getElementById('chatInput')?.value;
    if (!msg) return;
    sendCommand('chat', msg);
    document.getElementById('chatInput').value = '';
}

// ========== ربط أزرار التحكم ==========
document.querySelectorAll('.move-btn, .action-btn, .ctrl-btn').forEach(btn => {
    const cmd = btn.dataset.cmd;
    if (cmd) {
        btn.addEventListener('click', () => sendCommand(cmd));
    }
});

document.querySelectorAll('.recipe-btn').forEach(btn => {
    btn.addEventListener('click', () => sendCommand('craft', btn.dataset.recipe));
});

// ========== تبويبات التحكم ==========
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        document.getElementById(`${tab}Tab`).classList.add('active');
    });
});

// ========== دوال مساعدة ==========
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// دوال عامة للوصول من HTML
window.closeEditModal = closeEditModal;
window.closeLogs = closeLogs;
window.closeBotControl = closeBotControl;
window.sendCommand = sendCommand;
window.sendChatMessage = sendChatMessage;
window.refreshInventory = refreshInventory;
window.openBotControl = openBotControl;
window.stopBot = stopBot;
window.startBot = startBot;
window.restartBot = restartBot;
window.deleteBot = deleteBot;
window.openEditModal = openEditModal;
window.openLogs = openLogs;
window.refreshLogs = refreshLogs;
window.clearLogs = clearLogs;
window.openCameraViewer = openCameraViewer;