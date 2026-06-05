const { PublicClientApplication } = require('@azure/msal-node');
const axios = require('axios');

const msalConfig = {
    auth: {
        clientId: process.env.CLIENT_ID,
        authority: 'https://login.microsoftonline.com/consumers',
        // no clientSecret needed for PublicClientApplication
    }
};

const msalClient = new PublicClientApplication(msalConfig);

async function getAuthUrl() {
    const authCodeUrlParameters = {
        scopes: ['User.Read', 'offline_access', 'openid', 'profile', 'email'],
        redirectUri: process.env.REDIRECT_URI,
    };
    return await msalClient.getAuthCodeUrl(authCodeUrlParameters);
}

async function getTokenFromCode(code) {
    const tokenRequest = {
        code: code,
        scopes: ['User.Read', 'offline_access', 'openid', 'profile', 'email'],
        redirectUri: process.env.REDIRECT_URI,
    };
    const response = await msalClient.acquireTokenByCode(tokenRequest);
    return { accessToken: response.accessToken };
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

module.exports = { getAuthUrl, getTokenFromCode, getMinecraftProfile };