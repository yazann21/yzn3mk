// ========================================
// BOT CRAFT v4.0 - مع زر تحقق (Device Code Flow)
// ========================================

let currentUser = null;
let currentBots = [];
let logsInterval = null;
let currentLogsBotId = null;
let controlBotId = null;
let statsInterval = null;
let inventoryInterval = null;
let currentInventory = [];
let selectedSlot = null;
let globalColor = '#7c3aed';
let activityChart = null;
let distributionChart = null;

const allVersions = [
    '1.21.11', '1.21.10', '1.21.9', '1.21.8', '1.21.7', '1.21.6', '1.21.5', '1.21.4', '1.21.3', '1.21.2', '1.21.1', '1.21',
    '1.20.4', '1.20.3', '1.20.2', '1.20.1', '1.20', '1.19.4', '1.19.2', '1.19', '1.18.2', '1.18.1', '1.18',
    '1.17.1', '1.17', '1.16.5', '1.16.4', '1.16.3', '1.16.2', '1.16.1', '1.16', '1.15.2', '1.15.1', '1.15',
    '1.14.4', '1.14.3', '1.14.2', '1.14.1', '1.14', '1.13.2', '1.13.1', '1.13', '1.12.2', '1.12.1', '1.12',
    '1.11.2', '1.11.1', '1.11', '1.10.2', '1.10.1', '1.10', '1.9.4', '1.9.3', '1.9.2', '1.9.1', '1.9', '1.8.9', '1.8.8'
];

const specialServerVersions = {
    'hypixel.net': '1.8.9',
    'donutsmp.net': '1.21.10',
    'donut': '1.21.10'
};

// ---------- تهيئة الصفحة ----------
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        const loading = document.getElementById('loadingOverlay');
        if (loading) loading.style.display = 'none';
        const wrapper = document.getElementById('appWrapper');
        if (wrapper) wrapper.style.display = 'flex';
    }, 1000);
    initEventListeners();
    initCharts();
    initColorPicker();
    initAuth();
    loadDashboard();
    loadBots();
});

// ---------- مصادقة مايكروسوفت ----------
function initAuth() {
    fetch('/api/user', { credentials: 'include' })
        .then(res => {
            if (res.status === 401) {
                showLogin();
                return null;
            }
            return res.json();
        })
        .then(user => {
            if (user && user.username) {
                currentUser = user;
                showApp();
                loadDashboard();
                loadBots();
            } else {
                showLogin();
            }
        })
        .catch(() => showLogin());

    const loginBtn = document.getElementById('loginMicrosoftBtn');
    if (loginBtn) {
        loginBtn.addEventListener('click', () => {
            fetch('/auth/login', { credentials: 'include' })
                .then(res => res.json())
                .then(data => { if (data.url) window.location.href = data.url; });
        });
    }
}

function showLogin() {
    const overlay = document.getElementById('loginOverlay');
    const wrapper = document.getElementById('appWrapper');
    if (overlay) overlay.style.display = 'flex';
    if (wrapper) wrapper.style.display = 'none';
}

function showApp() {
    const overlay = document.getElementById('loginOverlay');
    const wrapper = document.getElementById('appWrapper');
    if (overlay) overlay.style.display = 'none';
    if (wrapper) wrapper.style.display = 'flex';
    
    const sidebarName = document.getElementById('sidebarUsername');
    if (sidebarName) sidebarName.innerHTML = currentUser.username;
    const settingsName = document.getElementById('settingsUsername');
    if (settingsName) settingsName.innerHTML = currentUser.username;
    const welcomeName = document.getElementById('welcomeUsername');
    if (welcomeName) welcomeName.innerHTML = currentUser.username;
}

function logout() {
    fetch('/api/logout', { method: 'POST', credentials: 'include' }).then(() => {
        currentUser = null;
        showLogin();
    });
}

// ---------- أحداث الواجهة ----------
function initEventListeners() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    
    const createType = document.getElementById('createBotType');
    if (createType) createType.addEventListener('change', () => {});
    const editType = document.getElementById('editBotType');
    if (editType) {
        editType.addEventListener('change', (e) => {
            const teamRow = document.getElementById('editTeamGroup');
            if (teamRow) teamRow.style.display = e.target.value === 'hunter' ? 'block' : 'none';
        });
    }
    const serverIp = document.getElementById('createServerIp');
    if (serverIp) serverIp.addEventListener('input', (e) => updateVersionsForServer(e.target.value, 'createVersion'));
    
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo(link.dataset.page);
        });
    });
    const menuToggle = document.getElementById('mobileMenuToggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', () => {
            const sidebar = document.querySelector('.glass-sidebar');
            if (sidebar) sidebar.classList.toggle('open');
        });
    }
    const createFloat = document.getElementById('createBotFloatBtn');
    if (createFloat) createFloat.addEventListener('click', () => navigateTo('create'));
    
    const filterStatus = document.getElementById('filterStatus');
    if (filterStatus) filterStatus.addEventListener('change', () => renderBots());
    const filterType = document.getElementById('filterType');
    if (filterType) filterType.addEventListener('change', () => renderBots());
    const botSearch = document.getElementById('botSearch');
    if (botSearch) botSearch.addEventListener('input', () => renderBots());
    
    const darkMode = document.getElementById('darkModeToggle');
    if (darkMode) {
        darkMode.addEventListener('change', (e) => {
            if (!e.target.checked) {
                document.body.style.background = '#f0f0f0';
                document.body.style.color = '#1a1a2e';
            } else {
                document.body.style.background = 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #0f0f1a 100%)';
                document.body.style.color = '#ffffff';
            }
        });
    }
    
    setInterval(() => {
        if (document.getElementById('dashboardPage')?.classList.contains('active')) loadDashboard();
        if (document.getElementById('botsPage')?.classList.contains('active')) loadBots();
    }, 15000);
}

function navigateTo(page) {
    const pages = ['dashboard', 'bots', 'create', 'analytics', 'settings'];
    pages.forEach(p => {
        const el = document.getElementById(`${p}Page`);
        if (el) el.classList.remove('active');
    });
    const activePage = document.getElementById(`${page}Page`);
    if (activePage) activePage.classList.add('active');
    
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => link.classList.remove('active'));
    const activeLink = document.querySelector(`.nav-link[data-page="${page}"]`);
    if (activeLink) activeLink.classList.add('active');
    
    const titles = { dashboard: 'لوحة التحكم', bots: 'البوتات الخاصة', create: 'إنشاء بوت', analytics: 'الإحصائيات', settings: 'الإعدادات' };
    const titleEl = document.getElementById('pageTitle');
    if (titleEl) titleEl.innerHTML = titles[page] || 'BotCraft';
    
    if (page === 'dashboard') loadDashboard();
    if (page === 'bots') loadBots();
    if (page === 'analytics') loadAnalytics();
}

function updateVersionsForServer(serverIp, selectId) {
    const serverLower = serverIp.toLowerCase();
    const versionSelect = document.getElementById(selectId);
    if (!versionSelect) return;
    for (const [key, forcedVersion] of Object.entries(specialServerVersions)) {
        if (serverLower.includes(key)) {
            versionSelect.innerHTML = `<option value="${forcedVersion}">🔒 ${forcedVersion}</option>`;
            showServerWarning(serverLower);
            return;
        }
    }
    versionSelect.innerHTML = allVersions.map(v => `<option value="${v}">${v}</option>`).join('');
    hideServerWarning();
}

function showServerWarning(serverName) {
    let warning = document.getElementById('serverWarning');
    if (!warning) {
        warning = document.createElement('div');
        warning.id = 'serverWarning';
        warning.className = 'info-banner';
        warning.style.background = 'rgba(239,68,68,0.1)';
        warning.style.borderLeftColor = '#ef4444';
        const container = document.querySelector('#createPage .form-container');
        if (container) container.appendChild(warning);
    }
    if (serverName.includes('hypixel')) warning.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Hypixel يدعم 1.8.9 فقط';
    else if (serverName.includes('donut')) warning.innerHTML = '<i class="fas fa-info-circle"></i> DonutSMP يدعم 1.21';
}

function hideServerWarning() {
    const w = document.getElementById('serverWarning');
    if (w) w.remove();
}

function initCharts() {
    const ctx1 = document.getElementById('activityChart')?.getContext('2d');
    if (ctx1) {
        activityChart = new Chart(ctx1, {
            type: 'line',
            data: { labels: ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'], datasets: [{ label: 'نشاط البوتات', data: [12, 19, 15, 17, 14, 20, 25], borderColor: globalColor, backgroundColor: globalColor + '20', borderWidth: 2, fill: true, tension: 0.4, pointBackgroundColor: globalColor, pointBorderColor: '#fff' }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#a0a0c0' } } }, scales: { y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#a0a0c0' } }, x: { grid: { display: false }, ticks: { color: '#a0a0c0' } } } }
        });
    }
    const ctx2 = document.getElementById('distributionChart')?.getContext('2d');
    if (ctx2) {
        distributionChart = new Chart(ctx2, {
            type: 'doughnut',
            data: { labels: ['مأفك', 'صياد', 'جبان'], datasets: [{ data: [0, 0, 0], backgroundColor: ['#a855f7', '#3b82f6', '#f59e0b'], borderWidth: 0 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: '#a0a0c0' } } } }
        });
    }
}

function initColorPicker() {
    document.querySelectorAll('.color-option').forEach(opt => {
        opt.addEventListener('click', () => {
            globalColor = opt.dataset.color;
            document.documentElement.style.setProperty('--primary', globalColor);
            document.documentElement.style.setProperty('--primary-dark', globalColor);
            document.querySelectorAll('.color-option').forEach(o => o.classList.remove('active'));
            opt.classList.add('active');
            if (activityChart) {
                activityChart.data.datasets[0].borderColor = globalColor;
                activityChart.data.datasets[0].backgroundColor = globalColor + '20';
                activityChart.update();
            }
        });
    });
}

function loadDashboard() {
    fetch('/api/bots', { credentials: 'include' }).then(res => res.json()).then(data => {
        const bots = data.bots || [];
        const totalSpan = document.getElementById('statTotalBots');
        if (totalSpan) totalSpan.innerHTML = bots.length;
        const onlineSpan = document.getElementById('statOnlineBots');
        if (onlineSpan) onlineSpan.innerHTML = bots.filter(b => b.status === 'online').length;
        const serversSpan = document.getElementById('statServers');
        if (serversSpan) serversSpan.innerHTML = [...new Set(bots.map(b => b.server_ip))].length;
        const countNav = document.getElementById('botsCountNav');
        if (countNav) countNav.innerHTML = bots.length;
        if (distributionChart) {
            distributionChart.data.datasets[0].data = [bots.filter(b => b.bot_type === 'afk').length, bots.filter(b => b.bot_type === 'hunter').length, bots.filter(b => b.bot_type === 'coward').length];
            distributionChart.update();
        }
        const recentDiv = document.getElementById('recentActivities');
        if (recentDiv) {
            recentDiv.innerHTML = bots.slice(0, 5).map(b => `<div class="activity-item"><div class="activity-icon ${b.status === 'online' ? 'success' : 'danger'}"><i class="fas fa-${b.status === 'online' ? 'plug' : 'power-off'}"></i></div><div class="activity-content"><div class="activity-title">${escapeHtml(b.bot_name)} ${b.status === 'online' ? 'تم تشغيله' : 'تم إيقافه'}</div><div class="activity-time">${new Date(b.created_at).toLocaleString()}</div></div></div>`).join('') || '<div class="activity-skeleton">لا توجد نشاطات</div>';
        }
    });
}

function loadBots() {
    fetch('/api/bots', { credentials: 'include' }).then(res => res.json()).then(data => {
        currentBots = data.bots || [];
        renderBots();
    });
}

function renderBots() {
    const filterStatus = document.getElementById('filterStatus')?.value || 'all';
    const filterType = document.getElementById('filterType')?.value || 'all';
    const searchTerm = document.getElementById('botSearch')?.value?.toLowerCase() || '';
    let filtered = currentBots.filter(b => (filterStatus === 'all' || b.status === filterStatus) && (filterType === 'all' || b.bot_type === filterType) && (b.bot_name.toLowerCase().includes(searchTerm)));
    const container = document.getElementById('botsGrid');
    if (!container) return;
    if (filtered.length === 0) {
        container.innerHTML = '<div class="activity-skeleton">🤖 لا توجد بوتات</div>';
        return;
    }
    container.innerHTML = filtered.map(b => `
        <div class="bot-card" onclick="openBotControl(${b.id}, '${escapeHtml(b.bot_name)}')">
            <div class="bot-header"><div class="bot-name"><i class="fas fa-robot" style="color: ${b.status === 'online' ? '#22c55e' : '#6b7280'}"></i>${escapeHtml(b.bot_name)}</div><div class="bot-status"><span class="status-dot ${b.status === 'online' ? 'online' : 'offline'}"></span>${b.status === 'online' ? 'متصل' : 'غير متصل'}</div></div>
            <div class="bot-details"><div><i class="fas fa-globe"></i> ${escapeHtml(b.server_ip)}</div><div><i class="fas fa-tag"></i> ${b.bot_type === 'afk' ? 'مأفك' : b.bot_type === 'hunter' ? 'صياد' : 'جبان'}</div><div><i class="fas fa-code-branch"></i> ${b.version || '1.21.10'}</div><div><i class="fas fa-calendar"></i> ${new Date(b.created_at).toLocaleDateString('ar-EG')}</div></div>
            <div class="bot-actions" onclick="event.stopPropagation()">
                ${b.status === 'online' 
                    ? `<button class="btn-stop" onclick="stopBot(${b.id})"><i class="fas fa-stop"></i> إيقاف</button>
                       <button class="btn-restart" onclick="restartBot(${b.id})"><i class="fas fa-sync-alt"></i> إعادة تشغيل</button>`
                    : `<button class="btn-start" onclick="startBot(${b.id})"><i class="fas fa-play"></i> تشغيل</button>`
                }
                <button class="btn-verify" onclick="verifyBotAccount(${b.id})"><i class="fas fa-check-double"></i> تحقق</button>
                <button class="btn-camera" onclick="openCameraViewer(${b.id})"><i class="fas fa-video"></i> كاميرا</button>
                <button class="btn-logs" onclick="openLogs(${b.id})"><i class="fas fa-terminal"></i> سجلات</button>
                <button class="btn-edit" onclick="openEditModal(${b.id})"><i class="fas fa-pen"></i> تعديل</button>
                <button class="btn-delete" onclick="deleteBot(${b.id})"><i class="fas fa-trash"></i> حذف</button>
            </div>
        </div>
    `).join('');
}

// دالة التحقق من البوت (تظهر رابط ورمز في سجل Render)
function verifyBotAccount(botId) {
    fetch(`/api/bot-verify/${botId}`, { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
            if (data.message) {
                alert(data.message);
                if (data.message.includes('افتح سجل Render')) {
                    alert('⚠️ اذهب إلى سجل Render (Logs) وابحث عن الرابط والرمز، ثم افتح الرابط في متصفح آخر وسجل الدخول بحساب ماينكرافت الحقيقي.');
                }
            } else if (data.error) {
                alert('خطأ: ' + data.error);
            }
        })
        .catch(err => {
            console.error(err);
            alert('حدث خطأ أثناء محاولة التحقق');
        });
}

function startBot(id) {
    fetch('/api/start-cloud-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ botId: parseInt(id) })
    }).then(res => res.json()).then(data => {
        if (data.error === 'need_minecraft_auth') {
            alert('⚠️ يجب التحقق من البوت أولاً (اضغط زر تحقق)');
        } else {
            loadBots();
            loadDashboard();
        }
    }).catch(err => console.error(err));
}

function stopBot(id) {
    fetch('/api/stop-bot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ botId: parseInt(id) }) }).then(() => { loadBots(); loadDashboard(); });
}

function restartBot(id) {
    fetch('/api/restart-bot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ botId: parseInt(id) }) }).then(() => setTimeout(() => { loadBots(); loadDashboard(); }, 2000));
}

function deleteBot(id) {
    if (confirm('حذف البوت نهائياً؟')) {
        fetch('/api/delete-bot', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ botId: parseInt(id) }) }).then(() => { loadBots(); loadDashboard(); });
    }
}

function openEditModal(id) {
    const bot = currentBots.find(b => b.id === id);
    if (!bot) return;
    
    const editId = document.getElementById('editBotId');
    const editName = document.getElementById('editBotName');
    const editType = document.getElementById('editBotType');
    const editServer = document.getElementById('editServerIp');
    const editTeamNames = document.getElementById('editTeamNames');
    const editVersion = document.getElementById('editVersion');
    const editTeamGroup = document.getElementById('editTeamGroup');
    const editModal = document.getElementById('editModal');
    
    if (!editId || !editName || !editType || !editServer || !editTeamNames || !editVersion || !editModal) return;
    
    editId.value = bot.id;
    editName.value = bot.bot_name;
    editType.value = bot.bot_type;
    editServer.value = bot.server_ip;
    editTeamNames.value = bot.team_names || '';
    editVersion.innerHTML = allVersions.map(v => `<option value="${v}" ${v === (bot.version || '1.21.10') ? 'selected' : ''}>${v}</option>`).join('');
    if (editTeamGroup) editTeamGroup.style.display = bot.bot_type === 'hunter' ? 'block' : 'none';
    editModal.style.display = 'flex';
}

function closeEditModal() {
    const modal = document.getElementById('editModal');
    if (modal) modal.style.display = 'none';
}

function saveEditBot() {
    const botId = parseInt(document.getElementById('editBotId')?.value);
    const botName = document.getElementById('editBotName')?.value;
    const botType = document.getElementById('editBotType')?.value;
    const serverIp = document.getElementById('editServerIp')?.value;
    const teamNames = document.getElementById('editTeamNames')?.value;
    const version = document.getElementById('editVersion')?.value;
    if (!botId) return;
    fetch('/api/update-bot', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ botId, botName, botType, serverIp, teamNames, version })
    }).then(() => { closeEditModal(); loadBots(); });
}

document.getElementById('createBotForm')?.addEventListener('submit', (e) => {
    e.preventDefault();
    fetch('/api/create-bot-cloud', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
            botName: document.getElementById('createBotName').value,
            botType: document.getElementById('createBotType').value,
            serverIp: document.getElementById('createServerIp').value,
            teamNames: '',
            version: document.getElementById('createVersion').value
        })
    }).then(res => res.json()).then(data => {
        if (data.error) alert('خطأ: ' + data.error);
        else { alert('تم إنشاء البوت'); navigateTo('bots'); }
    });
});

function openCameraViewer(botId) {
    window.open(`/camera/${botId}`, '_blank', 'width=1200,height=800');
}

function closeCameraModal() {
    const modal = document.getElementById('cameraModal');
    if (modal) modal.style.display = 'none';
}

function openLogs(id) {
    const modal = document.getElementById('logsModal');
    const logsPre = document.getElementById('logsText');
    if (!modal || !logsPre) return;
    currentLogsBotId = id;
    modal.style.display = 'flex';
    if (logsInterval) clearInterval(logsInterval);
    const fetchLogs = () => {
        fetch(`/api/bot-logs/${id}`, { credentials: 'include' })
            .then(res => res.json())
            .then(data => { logsPre.innerHTML = (data.logs || []).join('\n'); })
            .catch(err => console.error('Failed to fetch logs:', err));
    };
    fetchLogs();
    logsInterval = setInterval(fetchLogs, 3000);
}

function closeLogs() {
    if (logsInterval) clearInterval(logsInterval);
    const modal = document.getElementById('logsModal');
    if (modal) modal.style.display = 'none';
}

function refreshLogs() {
    if (currentLogsBotId) {
        fetch(`/api/bot-logs/${currentLogsBotId}`, { credentials: 'include' })
            .then(res => res.json())
            .then(data => {
                const logsPre = document.getElementById('logsText');
                if (logsPre) logsPre.innerHTML = (data.logs || []).join('\n');
            });
    }
}

function clearLogs() {
    if (currentLogsBotId) {
        fetch(`/api/clear-logs/${currentLogsBotId}`, { method: 'POST', credentials: 'include' }).catch(console.error);
        refreshLogs();
    }
}

function openBotControl(id, name) {
    controlBotId = id;
    const title = document.getElementById('controlTitle');
    if (title) title.innerHTML = `🎮 التحكم بـ ${name}`;
    const cameraFrame = document.getElementById('controlCameraFrame');
    if (cameraFrame) cameraFrame.src = `/camera/${id}`;
    const modal = document.getElementById('controlModal');
    if (modal) modal.style.display = 'flex';
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
    const modal = document.getElementById('controlModal');
    if (modal) modal.style.display = 'none';
    controlBotId = null;
}

function fetchBotStats(id) {
    fetch(`/api/bot-stats/${id}`, { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
            const statHealth = document.getElementById('statHealth');
            if (statHealth) statHealth.innerHTML = data.health || '20';
            const statFood = document.getElementById('statFood');
            if (statFood) statFood.innerHTML = data.food || '20';
            const statPosition = document.getElementById('statPosition');
            if (statPosition) statPosition.innerHTML = data.position || '0,0,0';
            const statArmor = document.getElementById('statArmor');
            if (statArmor) statArmor.innerHTML = data.armor || 'لا يوجد';
            const statWeapon = document.getElementById('statWeapon');
            if (statWeapon) statWeapon.innerHTML = data.weapon || 'لا يوجد';
            const statLevel = document.getElementById('statLevel');
            if (statLevel) statLevel.innerHTML = data.level || '0';
            const detailLevel = document.getElementById('detailLevel');
            if (detailLevel) detailLevel.innerHTML = data.level || '0';
            const detailXp = document.getElementById('detailXp');
            if (detailXp) detailXp.innerHTML = data.xp || '0';
            const detailKills = document.getElementById('detailKills');
            if (detailKills) detailKills.innerHTML = data.kills || '0';
            const detailDeaths = document.getElementById('detailDeaths');
            if (detailDeaths) detailDeaths.innerHTML = data.deaths || '0';
        }).catch(() => {});
}

function fetchInventory(id) {
    fetch(`/api/bot-inventory/${id}`, { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
            if (data.inventory) {
                currentInventory = data.inventory;
                renderInventory();
                const invHelmet = document.getElementById('invHelmet');
                if (invHelmet) invHelmet.innerHTML = data.helmet || 'فارغ';
                const invChest = document.getElementById('invChest');
                if (invChest) invChest.innerHTML = data.chest || 'فارغ';
                const invLegs = document.getElementById('invLegs');
                if (invLegs) invLegs.innerHTML = data.legs || 'فارغ';
                const invBoots = document.getElementById('invBoots');
                if (invBoots) invBoots.innerHTML = data.boots || 'فارغ';
                const invWeapon = document.getElementById('invWeapon');
                if (invWeapon) invWeapon.innerHTML = data.weapon || 'فارغ';
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
        div.innerHTML = item ? `${item.name}<br><small>${item.count || 1}</small>` : '<i class="fas fa-box-open"></i>';
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

function sendCommand(cmd, extra = null) {
    if (!controlBotId) return;
    fetch('/api/bot-command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ botId: controlBotId, command: cmd, extra })
    });
}

function sendChatMessage() {
    const msg = document.getElementById('chatInput')?.value;
    if (!msg) return;
    sendCommand('chat', msg);
    const chatInput = document.getElementById('chatInput');
    if (chatInput) chatInput.value = '';
}

document.querySelectorAll('.move-btn, .action-btn, .recipe-btn').forEach(btn => {
    const cmd = btn.dataset.cmd || btn.dataset.recipe;
    if (cmd) {
        btn.addEventListener('click', () => {
            if (btn.dataset.cmd) sendCommand(btn.dataset.cmd);
            else if (btn.dataset.recipe) sendCommand('craft', btn.dataset.recipe);
        });
    }
});

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
        const activePane = document.getElementById(`${tab}Tab`);
        if (activePane) activePane.classList.add('active');
    });
});

function loadAnalytics() {
    fetch('/api/bots', { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
            const bots = data.bots || [];
            const daysSpan = document.getElementById('analyticsDaysActive');
            if (daysSpan) daysSpan.innerHTML = Math.ceil(bots.length * 1.2) || '1';
            const commandsSpan = document.getElementById('analyticsTotalCommands');
            if (commandsSpan) commandsSpan.innerHTML = Math.floor(bots.length * 42) || '0';
            let totalKills = 0, totalDeaths = 0;
            Promise.all(bots.map(bot => fetch(`/api/bot-stats/${bot.id}`, { credentials: 'include' }).then(r => r.json()).catch(() => ({})))).then(statsArray => {
                statsArray.forEach(stat => { totalKills += stat.kills || 0; totalDeaths += stat.deaths || 0; });
                const killsSpan = document.getElementById('analyticsKills');
                if (killsSpan) killsSpan.innerHTML = totalKills;
                const deathsSpan = document.getElementById('analyticsDeaths');
                if (deathsSpan) deathsSpan.innerHTML = totalDeaths;
            });
        });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function populateVersions(selectId) {
    const select = document.getElementById(selectId);
    if (select) select.innerHTML = allVersions.map(v => `<option value="${v}">${v}</option>`).join('');
}
populateVersions('createVersion');
populateVersions('editVersion');

window.closeEditModal = closeEditModal;
window.closeLogs = closeLogs;
window.closeBotControl = closeBotControl;
window.closeCameraModal = closeCameraModal;
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
window.navigateTo = navigateTo;
window.verifyBotAccount = verifyBotAccount;