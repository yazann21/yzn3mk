const { ConfidentialClientApplication } = require('@azure/msal-node');
const { Authflow, Titles } = require('prismarine-auth');
const crypto = require('crypto');

// إعدادات تطبيق Azure
const msalConfig = {
    auth: {
        clientId: process.env.CLIENT_ID,
        authority: 'https://login.microsoftonline.com/consumers',
        clientSecret: process.env.CLIENT_SECRET,
    }
};
const msalClient = new ConfidentialClientApplication(msalConfig);

/**
 * 1. يُنشئ رابط تسجيل الدخول إلى مايكروسوفت (باستخدام MSAL)
 */
async function getAuthUrl() {
    const authUrlParams = {
        scopes: ['XboxLive.signin', 'offline_access', 'openid', 'profile'],
        redirectUri: process.env.REDIRECT_URI,
    };
    try {
        const authUrl = await msalClient.getAuthCodeUrl(authUrlParams);
        return authUrl;
    } catch (error) {
        console.error('Error generating auth URL:', error);
        throw error;
    }
}

/**
 * 2. يستبدل الكود بـ Access Token (باستخدام MSAL)
 */
async function getTokenFromCode(code) {
    const tokenRequest = {
        code: code,
        scopes: ['XboxLive.signin', 'offline_access', 'openid', 'profile'],
        redirectUri: process.env.REDIRECT_URI,
    };
    const response = await msalClient.acquireTokenByCode(tokenRequest);
    return { accessToken: response.accessToken };
}

/**
 * 3. يحصل على معلومات ماينكرافت الحقيقية (باستخدام prismarine-auth)
 */
async function getMinecraftProfile(accessToken) {
    try {
        // تعريف مستخدم مؤقت لـ prismarine-auth
        const userIdentifier = `minecraft_user_${crypto.randomBytes(8).toString('hex')}`;
        // إنشاء كائن Authflow باستخدام الـ accessToken الذي حصلنا عليه من MSAL
        const flow = new Authflow(userIdentifier, './ms-cache', {
            authTitle: Titles.MinecraftJava,
            deviceType: 'Win32',
            flow: 'msal'
        });

        // الحصول على بيانات حساب ماينكرافت
        const minecraftToken = await flow.getMinecraftJavaToken({ accessToken });
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
        // في حالة الفشل (مثلاً الحساب لا يملك Minecraft)، ننشئ بيانات مؤقتة
        const tempId = `temp-${crypto.randomBytes(8).toString('hex')}`;
        return {
            uuid: tempId,
            username: `TempUser_${tempId.substring(0, 6)}`,
            minecraftToken: 'temp-token',
            isRealMinecraft: false
        };
    }
}

module.exports = { getAuthUrl, getTokenFromCode, getMinecraftProfile };