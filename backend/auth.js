const { ConfidentialClientApplication } = require('@azure/msal-node');
const { Authflow, Titles } = require('prismarine-auth');
const axios = require('axios');

const msalConfig = {
    auth: {
        clientId: process.env.CLIENT_ID,
        authority: 'https://login.microsoftonline.com/consumers',
        clientSecret: process.env.CLIENT_SECRET,
    }
};
const msalClient = new ConfidentialClientApplication(msalConfig);

async function getAuthUrl() {
    const authUrlParams = {
        scopes: ['User.Read', 'offline_access', 'openid', 'profile'],
        redirectUri: process.env.REDIRECT_URI,
    };
    return await msalClient.getAuthCodeUrl(authUrlParams);
}

async function getTokenFromCode(code) {
    const tokenRequest = {
        code: code,
        scopes: ['User.Read', 'offline_access', 'openid', 'profile'],
        redirectUri: process.env.REDIRECT_URI,
    };
    return await msalClient.acquireTokenByCode(tokenRequest);
}

async function getMinecraftProfile(accessToken) {
    try {
        const graphResponse = await axios.get('https://graph.microsoft.com/v1.0/me', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const email = graphResponse.data.userPrincipalName;
        const username = graphResponse.data.displayName || email.split('@')[0];
        console.log(`✅ تم تسجيل دخول مايكروسوفت: ${username}`);
        return { username };
    } catch (error) {
        console.error('❌ فشل الحصول على بيانات المستخدم:', error.message);
        throw error;
    }
}

/**
 * بدء عملية مصادقة الجهاز – تعيد الرابط والرمز فوراً (بدون انتظار)
 */
async function startBotDeviceAuth(botId) {
    // إنشاء flow جديد ولكن نمنع الـ onMsaCode من الطباعة في الكونسول
    const flow = new Authflow(`bot_${botId}_${Date.now()}`, './ms-cache', {
        authTitle: Titles.MinecraftJava,
        deviceType: 'Win32',
        flow: 'msal'
    });
    // طريقة مبدئية للحصول على رابط وكود دون انتظار – نخترق المكتبة قليلاً
    // لسوء الحظ، المكتبة لا توفر طريقة سهلة للحصول على البيانات قبل المصادقة.
    // سنستخدم حدث 'msa:code' المخفي
    let deviceData = null;
    const originalOnMsaCode = flow['_onMsaCode'];
    flow['_onMsaCode'] = (data) => {
        deviceData = data;
        if (originalOnMsaCode) originalOnMsaCode(data);
    };
    // استدعاء getMinecraftJavaToken يبدأ العملية ولكنه لن ينتظر إذا لم نستدعِ شيئاً
    // بدلاً من ذلك، نقوم بإنشاء الـ flow وننتظر البيانات
    await new Promise((resolve) => {
        const interval = setInterval(() => {
            if (deviceData) {
                clearInterval(interval);
                resolve();
            }
        }, 200);
    });
    return { verification_uri: deviceData.verification_uri, user_code: deviceData.user_code, flow };
}

module.exports = { getAuthUrl, getTokenFromCode, getMinecraftProfile, startBotDeviceAuth };