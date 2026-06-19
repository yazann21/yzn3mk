// ========================================
// BOT CRAFT v6.0 - كامل مع وضع البياع وأمر البيع المخصص (يظهر فقط عند اختيار بياع)
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
    'donut': '1.21.10'
};

function populateBotTypes(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    const currentValue = select.value;
    const types = [
        { value: 'afk', label: '😴 مأفك - يدافع عن نفسه' },
        { value: 'hunter', label: '⚔️ صياد - يطارد اللاعبين' },
        { value: 'coward', label: '😨 جبان - ينفصل عند الضربة' },
        { value: 'seller', label: '🛒 بياع - يبيع الأغراض تلقائياً' }
    ];
    select.innerHTML = types.map(t => `<option value="${t.value}">${t.label}</option>`).join('');
    if (currentValue) select.value = currentValue;
}

// دالة لإظهار/إخفاء حقل أمر البيع
function toggleSellCommandField(selectElement, inputId, containerId) {
    const container = document.getElementById(containerId);
    const input = document.getElementById(inputId);
    if (!container || !input) return;
    if (selectElement.value === 'seller') {
        container.style.display = 'block';
    } else {
        container.style.display = 'none';
        input.value = ''; // مسح القيمة عند الإخفاء
    }
}

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
    populateBotTypes('createBotType');
    populateBotTypes('editBotType');

    // إظهار/إخفاء حقل أمر البيع عند تغيير نوع البوت في صفحة الإنشاء
    const createTypeSelect = document.getElementById('createBotType');
    if (createTypeSelect) {
        createTypeSelect.addEventListener('change', function() {
            toggleSellCommandField(this, 'createSellCommand', 'createSellGroup');
        });
        // تطبيق الحالة الأولية
        setTimeout(() => toggleSellCommandField(createTypeSelect, 'createSellCommand', 'createSellGroup'), 100);
    }

    // إظهار/إخفاء حقل أمر البيع عند تغيير نوع البوت في نافذة التعديل
    const editTypeSelect = document.getElementById('editBotType');
    if (editTypeSelect) {
        editTypeSelect.addEventListener('change', function() {
            toggleSellCommandField(this, 'editSellCommand', 'editSellGroup');
        });
    }
});

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
    document.getElementById('loginOverlay').style.display = 'flex';
    document.getElementById('appWrapper').style.display = 'none';
}

function showApp() {
    document.getElementById('loginOverlay').style.display = 'none';
    document.getElementById('appWrapper').style.display = 'flex';
    document.getElementById('sidebarUsername').innerHTML = currentUser.username;
    document.getElementById('settingsUsername').innerHTML = currentUser.username;
}

function logout() {
    fetch('/api/logout', { method: 'POST', credentials: 'include' }).then(() => {
        currentUser = null;
        showLogin();
    });
}

function initEventListeners() {
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('createServerIp').addEventListener('input', (e) => updateVersionsForServer(e.target.value, 'createVersion'));
    
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo(link.dataset.page);
        });
    });
    document.getElementById('mobileMenuToggle').addEventListener('click', () => {
        document.querySelector('.glass-sidebar').classList.toggle('open');
    });
    document.getElementById('createBotFloatBtn').addEventListener('click', () => navigateTo('create'));
    document.getElementById('filterStatus').addEventListener('change', () => renderBots());
    document.getElementById('filterType').addEventListener('change', () => renderBots());
    document.getElementById('botSearch').addEventListener('input', () => renderBots());
    document.getElementById('darkModeToggle').addEventListener('change', (e) => {
        if (!e.target.checked) {
            document.body.style.background = '#f0f0f0';
            document.body.style.color = '#1a1a2e';
        } else {
            document.body.style.background = 'linear-gradient(135deg, #0a0a0f 0%, #1a1a2e 50%, #0f0f1a 100%)';
            document.body.style.color = '#ffffff';
        }
    });
    
    setInterval(() => {
        if (document.getElementById('dashboardPage').classList.contains('active')) loadDashboard();
        if (document.getElementById('botsPage').classList.contains('active')) loadBots();
    }, 15000);
}

function navigateTo(page) {
    ['dashboard', 'bots', 'create', 'analytics', 'settings'].forEach(p => {
        document.getElementById(`${p}Page`).classList.remove('active');
    });
    document.getElementById(`${page}Page`).classList.add('active');
    document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
    document.querySelector(`.nav-link[data-page="${page}"]`).classList.add('active');
    const titles = { dashboard: 'لوحة التحكم', bots: 'البوتات الخاصة', create: 'إنشاء بوت', analytics: 'الإحصائيات', settings: 'الإعدادات' };
    document.getElementById('pageTitle').innerHTML = titles[page] || 'BotCraft';
    if (page === 'dashboard') loadDashboard();
    if (page === 'bots') loadBots();
    if (page === 'analytics') loadAnalytics();
}

function updateVersionsForServer(serverIp, selectId) {
    const serverLower = serverIp.toLowerCase();
    const versionSelect = document.getElementById(selectId);
    if (!versionSelect) return;

    if (serverLower.includes('donutsmp.net')) {
        const donutVersions = ['1.21', '1.21.1', '1.21.2'];
        versionSelect.innerHTML = donutVersions.map(v => `<option value="${v}">${v}</option>`).join('');
        versionSelect.value = '1.21';
        showServerWarning(serverLower);
        return;
    }

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
    else if (serverName.includes('donutsmp.net')) warning.innerHTML = '<i class="fas fa-info-circle"></i> DonutSMP يدعم الإصدارات 1.21, 1.21.1, 1.21.2';
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
            data: { labels: ['أحد', 'اثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'], datasets: [{ label: 'نشاط البوتات', data: [12, 19, 15, 17, 14, 20, 25], borderColor: globalColor, backgroundColor: globalColor + '20', borderWidth: 2, fill: true, tension: 0.4 }] },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#a0a0c0' } } }, scales: { y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#a0a0c0' } }, x: { grid: { display: false }, ticks: { color: '#a0a0c0' } } } }
        });
    }
    const ctx2 = document.getElementById('distributionChart')?.getContext('2d');
    if (ctx2) {
        distributionChart = new Chart(ctx2, {
            type: 'doughnut',
            data: { labels: ['مأفك', 'صياد', 'جبان', 'بياع'], datasets: [{ data: [0, 0, 0, 0], backgroundColor: ['#a855f7', '#3b82f6', '#f59e0b', '#22c55e'], borderWidth: 0 }] },
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
        document.getElementById('statTotalBots').innerHTML = bots.length;
        document.getElementById('statOnlineBots').innerHTML = bots.filter(b => b.status === 'online').length;
        document.getElementById('statServers').innerHTML = [...new Set(bots.map(b => b.server_ip))].length;
        document.getElementById('botsCountNav').innerHTML = bots.length;
        if (distributionChart) {
            const counts = { afk: 0, hunter: 0, coward: 0, seller: 0 };
            bots.forEach(b => { if (counts[b.bot_type] !== undefined) counts[b.bot_type]++; });
            distributionChart.data.datasets[0].data = [counts.afk, counts.hunter, counts.coward, counts.seller];
            distributionChart.update();
        }
        const recentDiv = document.getElementById('recentActivities');
        recentDiv.innerHTML = bots.slice(0, 5).map(b => `<div class="activity-item"><div class="activity-icon ${b.status === 'online' ? 'success' : 'danger'}"><i class="fas fa-${b.status === 'online' ? 'plug' : 'power-off'}"></i></div><div class="activity-content"><div class="activity-title">${escapeHtml(b.bot_name)} ${b.status === 'online' ? 'تم تشغيله' : 'تم إيقافه'}</div><div class="activity-time">${new Date(b.created_at).toLocaleString()}</div></div></div>`).join('') || '<div class="activity-skeleton">لا توجد نشاطات</div>';
    });
}

function loadBots() {
    fetch('/api/bots', { credentials: 'include' }).then(res => res.json()).then(data => {
        currentBots = data.bots || [];
        renderBots();
    });
}

function renderBots() {
    const filterStatus = document.getElementById('filterStatus').value;
    const filterType = document.getElementById('filterType').value;
    const searchTerm = document.getElementById('botSearch').value.toLowerCase();
    let filtered = currentBots.filter(b => (filterStatus === 'all' || b.status === filterStatus) && (filterType === 'all' || b.bot_type === filterType) && (b.bot_name.toLowerCase().includes(searchTerm)));
    const container = document.getElementById('botsGrid');
    if (filtered.length === 0) {
        container.innerHTML = '<div class="activity-skeleton">🤖 لا توجد بوتات</div>';
        return;
    }
    container.innerHTML = filtered.map(b => {
        const isVerified = b.mc_token && b.mc_token !== '';
        const typeLabels = {
            afk: 'مأفك',
            hunter: 'صياد',
            coward: 'جبان',
            seller: 'بياع'
        };
        return `
            <div class="bot-card" onclick="openBotControl(${b.id}, '${escapeHtml(b.bot_name)}')">
                <div class="bot-header">
                    <div class="bot-name"><i class="fas fa-robot" style="color: ${b.status === 'online' ? '#22c55e' : '#6b7280'}"></i>${escapeHtml(b.bot_name)}</div>
                    <div class="bot-status"><span class="status-dot ${b.status === 'online' ? 'online' : 'offline'}"></span>${b.status === 'online' ? 'متصل' : 'غير متصل'}</div>
                </div>
                <div class="bot-details">
                    <div><i class="fas fa-globe"></i> ${escapeHtml(b.server_ip)}</div>
                    <div><i class="fas fa-tag"></i> ${typeLabels[b.bot_type] || b.bot_type}</div>
                    <div><i class="fas fa-code-branch"></i> ${b.version || '1.21.10'}</div>
                    <div><i class="fas fa-calendar"></i> ${new Date(b.created_at).toLocaleDateString('ar-EG')}</div>
                    ${b.auth_type === 'microsoft' 
                        ? (isVerified ? `<div><i class="fas fa-check-circle" style="color:#22c55e"></i> ✓ مرتبط بحساب ${escapeHtml(b.mc_username)}</div>` : `<div><i class="fas fa-spinner fa-pulse"></i> في انتظار المصادقة (شغّل البوت)</div>`)
                        : `<div><i class="fas fa-user-secret"></i> وضع غير مسجل</div>`
                    }
                </div>
                <div class="bot-actions" onclick="event.stopPropagation()">
                    ${b.status === 'online' 
                        ? `<button class="btn-stop" onclick="stopBot(${b.id})"><i class="fas fa-stop"></i> إيقاف</button>
                           <button class="btn-restart" onclick="restartBot(${b.id})"><i class="fas fa-sync-alt"></i> إعادة تشغيل</button>`
                        : `<button class="btn-start" onclick="startBot(${b.id})"><i class="fas fa-play"></i> تشغيل</button>`
                    }
                    <button class="btn-camera" onclick="openCameraViewer(${b.id})"><i class="fas fa-video"></i> كاميرا</button>
                    <button class="btn-logs" onclick="openLogs(${b.id})"><i class="fas fa-terminal"></i> سجلات</button>
                    <button class="btn-edit" onclick="openEditModal(${b.id})"><i class="fas fa-pen"></i> تعديل</button>
                    <button class="btn-delete" onclick="deleteBot(${b.id})"><i class="fas fa-trash"></i> حذف</button>
                </div>
            </div>
        `;
    }).join('');
}

// ========== إنشاء بوت جديد ==========
document.getElementById('createBotForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const botName = document.getElementById('createBotName').value;
    const botType = document.getElementById('createBotType').value;
    const serverIp = document.getElementById('createServerIp').value;
    const version = document.getElementById('createVersion').value;
    const authType = document.querySelector('input[name="authType"]:checked').value;
    const sellCommand = document.getElementById('createSellCommand').value || '/sell';
    
    const submitBtn = document.querySelector('#createBotForm button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> جاري الإنشاء...';
    
    try {
        const response = await fetch('/api/create-bot-cloud', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ 
                botName, botType, serverIp, teamNames: '', version, authType,
                sellCommand: (botType === 'seller') ? sellCommand : ''
            })
        });
        const data = await response.json();
        if (data.error) {
            alert('❌ خطأ: ' + data.error);
            return;
        }
        if (authType === 'microsoft') {
            alert(`✅ تم إنشاء البوت (حساب حقيقي).\nعند الضغط على "تشغيل" سيقوم البوت بطلب مصادقة مايكروسوفت.\nافتح سجلات البوت (زر "سجلات") لرؤية الرابط والرمز.`);
        } else {
            alert(`✅ تم إنشاء البوت وتشغيله في وضع غير مسجل.`);
        }
        navigateTo('bots');
        loadBots();
    } catch (err) {
        console.error('Error creating bot:', err);
        alert('❌ حدث خطأ أثناء إنشاء البوت: ' + err.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
    }
});

function startBot(id) {
    fetch('/api/start-cloud-bot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ botId: parseInt(id) })
    }).then(res => res.json()).then(data => {
        if (data.success) {
            alert('✅ تم تشغيل البوت');
            loadBots();
            loadDashboard();
        } else {
            alert('❌ فشل التشغيل: ' + (data.error || 'خطأ'));
        }
    }).catch(err => {
        console.error(err);
        alert('حدث خطأ أثناء تشغيل البوت');
    });
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
    document.getElementById('editBotId').value = bot.id;
    document.getElementById('editBotName').value = bot.bot_name;
    document.getElementById('editBotType').value = bot.bot_type;
    document.getElementById('editServerIp').value = bot.server_ip;
    document.getElementById('editTeamNames').value = bot.team_names || '';
    document.getElementById('editVersion').innerHTML = allVersions.map(v => `<option value="${v}" ${v === (bot.version || '1.21.10') ? 'selected' : ''}>${v}</option>`).join('');
    document.getElementById('editTeamGroup').style.display = bot.bot_type === 'hunter' ? 'block' : 'none';
    
    // إظهار/إخفاء حقل أمر البيع حسب نوع البوت
    const sellGroup = document.getElementById('editSellGroup');
    const sellInput = document.getElementById('editSellCommand');
    if (sellGroup && sellInput) {
        if (bot.bot_type === 'seller') {
            sellGroup.style.display = 'block';
            sellInput.value = bot.sell_command || '/sell';
        } else {
            sellGroup.style.display = 'none';
            sellInput.value = '';
        }
    }
    
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
    const sellCommand = document.getElementById('editSellCommand').value || '/sell';
    fetch('/api/update-bot', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
            botId, botName, botType, serverIp, teamNames, version,
            sellCommand: (botType === 'seller') ? sellCommand : ''
        })
    }).then(() => { closeEditModal(); loadBots(); });
}

function openCameraViewer(botId) {
    window.open(`/camera/${botId}`, '_blank', 'width=1200,height=800');
}

function openLogs(id) {
    currentLogsBotId = id;
    const modal = document.getElementById('logsModal');
    if (modal) modal.style.display = 'flex';
    if (logsInterval) clearInterval(logsInterval);
    const fetchLogs = () => {
        fetch(`/api/bot-logs/${id}`, { credentials: 'include' })
            .then(res => res.json())
            .then(data => { 
                document.getElementById('logsText').innerHTML = (data.logs || []).join('\n');
                const authBox = document.getElementById('authInfoBox');
                if (authBox) authBox.style.display = 'none';
            })
            .catch(err => console.error('Failed to fetch logs:', err));
    };
    fetchLogs();
    logsInterval = setInterval(fetchLogs, 3000);
}

function closeLogs() {
    if (logsInterval) clearInterval(logsInterval);
    document.getElementById('logsModal').style.display = 'none';
}

function refreshLogs() {
    if (currentLogsBotId) {
        fetch(`/api/bot-logs/${currentLogsBotId}`, { credentials: 'include' })
            .then(res => res.json())
            .then(data => { document.getElementById('logsText').innerHTML = (data.logs || []).join('\n'); });
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
    document.getElementById('controlTitle').innerHTML = `🎮 التحكم بـ ${name}`;
    document.getElementById('controlCameraFrame').src = `/camera/${id}`;
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
    controlBotId = null;
}

function fetchBotStats(id) {
    fetch(`/api/bot-stats/${id}`, { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
            document.getElementById('statHealth').innerHTML = data.health || '20';
            document.getElementById('statFood').innerHTML = data.food || '20';
            document.getElementById('statPosition').innerHTML = data.position || '0,0,0';
            document.getElementById('statArmor').innerHTML = data.armor || 'لا يوجد';
            document.getElementById('statWeapon').innerHTML = data.weapon || 'لا يوجد';
            document.getElementById('statLevel').innerHTML = data.level || '0';
            document.getElementById('detailLevel').innerHTML = data.level || '0';
            document.getElementById('detailXp').innerHTML = data.xp || '0';
            document.getElementById('detailKills').innerHTML = data.kills || '0';
            document.getElementById('detailDeaths').innerHTML = data.deaths || '0';
        }).catch(() => {});
}

function fetchInventory(id) {
    fetch(`/api/bot-inventory/${id}`, { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
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
    const msg = document.getElementById('chatInput').value;
    if (!msg) return;
    sendCommand('chat', msg);
    document.getElementById('chatInput').value = '';
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
        document.getElementById(`${tab}Tab`).classList.add('active');
    });
});

function loadAnalytics() {
    fetch('/api/bots', { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
            const bots = data.bots || [];
            document.getElementById('analyticsDaysActive').innerHTML = Math.ceil(bots.length * 1.2) || '1';
            document.getElementById('analyticsTotalCommands').innerHTML = Math.floor(bots.length * 42) || '0';
            let totalKills = 0, totalDeaths = 0;
            Promise.all(bots.map(bot => fetch(`/api/bot-stats/${bot.id}`, { credentials: 'include' }).then(r => r.json()).catch(() => ({})))).then(statsArray => {
                statsArray.forEach(stat => { totalKills += stat.kills || 0; totalDeaths += stat.deaths || 0; });
                document.getElementById('analyticsKills').innerHTML = totalKills;
                document.getElementById('analyticsDeaths').innerHTML = totalDeaths;
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

// ربط الدوال العامة
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