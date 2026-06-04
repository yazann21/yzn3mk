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
 * بدء عملية مصادقة جهاز ماينكرافت - تعيد رابط ورمز للمستخدم
 * هذه الوظيفة ستعيد رابط التحقق بدلاً من انتظار التوكن مباشرة
 */
async function startBotDeviceAuth(botId) {
    return new Promise(async (resolve, reject) => {
        const flow = new Authflow(`bot_${botId}_${Date.now()}`, './ms-cache', {
            authTitle: Titles.MinecraftJava,
            deviceType: 'Win32',
            flow: 'msal',
            onMsaCode: (data) => {
                // عندما تحصل المكتبة على بيانات الجهاز، نعيدها للمستخدم
                resolve({
                    verificationUri: data.verification_uri,
                    userCode: data.user_code,
                    expiresIn: data.expires_in
                });
            }
        });
        try {
            // نبدأ عملية الحصول على التوكن ولكننا لن ننتظرها، لأن onMsaCode سيعيد البيانات
            flow.getMinecraftJavaToken().catch(err => {
                // تجاهل الأخطاء لأننا سنعتمد على onMsaCode
            });
        } catch (err) {
            reject(err);
        }
    });
}

module.exports = { getAuthUrl, getTokenFromCode, getMinecraftProfile, startBotDeviceAuth };