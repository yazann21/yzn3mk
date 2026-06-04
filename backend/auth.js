const { ConfidentialClientApplication } = require('@azure/msal-node');

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
    // نحن لا نستخدمها حالياً – سنعيد بيانات مؤقتة
    return {
        uuid: 'temp-' + Math.random().toString(36).substring(2, 15),
        username: 'MinecraftUser',
        minecraftToken: null,
        isRealMinecraft: false
    };
}

module.exports = { getAuthUrl, getTokenFromCode, getMinecraftProfile };