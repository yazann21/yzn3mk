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
 * بدء عملية مصادقة جهاز ماينكرافت (لكل بوت على حدة)
 * @param {number} botId - معرف البوت
 * @returns {Promise<{token: string, profile: object}>}
 */
async function startBotDeviceAuth(botId) {
    const flow = new Authflow(`bot_${botId}_${Date.now()}`, './ms-cache', {
        authTitle: Titles.MinecraftJava,
        deviceType: 'Win32',
        flow: 'msal',
        onMsaCode: (data) => {
            console.log(`\n🔐 مصادقة البوت ${botId}:`);
            console.log(`🔗 الرابط: ${data.verification_uri}`);
            console.log(`🔢 الرمز: ${data.user_code}`);
            console.log(`⏱️ ينتهي خلال ${data.expires_in} ثانية\n`);
        }
    });
    const tokenResult = await flow.getMinecraftJavaToken();
    return tokenResult;
}

module.exports = { getAuthUrl, getTokenFromCode, getMinecraftProfile, startBotDeviceAuth };