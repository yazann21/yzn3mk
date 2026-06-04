const { ConfidentialClientApplication } = require('@azure/msal-node');
const { Authflow, Titles } = require('prismarine-auth');

// للتطبيق العام (Public Client) لا حاجة لـ client secret
const msalConfig = {
    auth: {
        clientId: process.env.CLIENT_ID,
        authority: 'https://login.microsoftonline.com/consumers',
    }
};
const msalClient = new ConfidentialClientApplication(msalConfig);

async function getAuthUrl() {
    // هذه الدالة لن تُستخدم في تدفق الجهاز، لكنها موجودة للتوافق
    const authUrlParams = {
        scopes: ['User.Read', 'offline_access', 'openid', 'profile'],
        redirectUri: process.env.REDIRECT_URI || 'http://localhost',
    };
    return await msalClient.getAuthCodeUrl(authUrlParams);
}

async function getTokenFromCode(code) {
    // غير مستخدم
    return { accessToken: null };
}

async function getMinecraftProfile(accessToken) {
    // غير مستخدم لمصادقة المستخدم
    return { username: 'BotUser' };
}

// دالة متخصصة لتوليد رابط ورمز مصادقة ماينكرافت (تعمل في الخلفية)
async function startBotDeviceAuth(botId) {
    return new Promise(async (resolve, reject) => {
        const flow = new Authflow(`bot_${botId}_${Date.now()}`, './ms-cache', {
            authTitle: Titles.MinecraftJava,
            deviceType: 'Win32',
            flow: 'msal',
            onMsaCode: (data) => {
                // نعيد البيانات بدلاً من طباعتها
                resolve({
                    verification_uri: data.verification_uri,
                    user_code: data.user_code,
                    flow: flow
                });
            }
        });
        // نبدأ عملية الحصول على التوكن ولكن لا ننتظرها (سننتظر حدث onMsaCode)
        flow.getMinecraftJavaToken().catch(err => {
            // إذا فشلت بعد وقت طويل، نرفض الوعد
            reject(err);
        });
    });
}

module.exports = { getAuthUrl, getTokenFromCode, getMinecraftProfile, startBotDeviceAuth };