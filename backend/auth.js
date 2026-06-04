const { Authflow } = require('prismarine-auth');
const crypto = require('crypto');

// معرف ثابت للمستخدم (يمكن تغييره)
const USER_IDENTIFIER = 'botcraft_user';
const CACHE_DIR = './ms-cache';

let currentFlow = null;

function getFlow() {
    if (!currentFlow) {
        currentFlow = new Authflow(USER_IDENTIFIER, CACHE_DIR, {
            authTitle: 'Minecraft',
            deviceType: 'Win32',
            flow: 'msal',
            redirectUri: process.env.REDIRECT_URI
        });
    }
    return currentFlow;
}

async function getAuthUrl() {
    try {
        const flow = getFlow();
        // نطلب رابط المصادقة من مايكروسوفت
        const url = await flow.getAuthCodeUrl();
        return url;
    } catch (error) {
        console.error('Error getting auth URL:', error);
        throw error;
    }
}

async function getTokenFromCode(code) {
    // مع Authflow، لا نحتاج هذه الدالة مباشرة، لكننا نضعها للتوافق
    return { accessToken: null };
}

async function getMinecraftProfile(accessToken) {
    try {
        const flow = getFlow();
        // الحصول على توكن ماينكرافت الحقيقي
        const minecraftToken = await flow.getMinecraftJavaToken();
        const uuid = minecraftToken.profile.id;
        const username = minecraftToken.profile.name;

        console.log(`✅ ماينكرافت حقيقي: ${username} (UUID: ${uuid})`);
        return {
            uuid: uuid,
            username: username,
            minecraftToken: minecraftToken.token,
            isRealMinecraft: true
        };
    } catch (error) {
        console.error('❌ فشل الحصول على بيانات ماينكرافت:', error.message);
        // إنشاء بيانات مؤقتة
        const tempId = crypto.randomBytes(8).toString('hex');
        return {
            uuid: tempId,
            username: `TempUser_${tempId.substring(0, 6)}`,
            minecraftToken: 'temp-token',
            isRealMinecraft: false
        };
    }
}

module.exports = { getAuthUrl, getTokenFromCode, getMinecraftProfile };