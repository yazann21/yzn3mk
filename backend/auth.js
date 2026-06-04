const { ConfidentialClientApplication } = require('@azure/msal-node');
const { authenticate } = require('@xboxreplay/xboxlive-auth');
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
    // الحصول على معلومات مستخدم Microsoft
    const graphResponse = await axios.get('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const email = graphResponse.data.userPrincipalName;
    const username = graphResponse.data.displayName || email.split('@')[0];

    // مصادقة Xbox Live
    const xboxAuth = await authenticate(email, accessToken);
    const profileRes = await axios.get('https://api.minecraftservices.com/minecraft/profile', {
      headers: { Authorization: `Bearer ${xboxAuth.accessToken}` }
    });
    const uuid = profileRes.data.id;
    const mcUsername = profileRes.data.name;

    console.log(`✅ ماينكرافت حقيقي: ${mcUsername} (UUID: ${uuid})`);
    return {
      uuid: uuid,
      username: mcUsername,
      minecraftToken: xboxAuth.accessToken,
      isRealMinecraft: true
    };
  } catch (error) {
    console.error('❌ فشل الحصول على بيانات ماينكرافت:', error.message);
    return {
      uuid: 'temp-' + Math.random().toString(36).substring(2, 15),
      username: 'MinecraftUser',
      minecraftToken: 'temp-token-' + Date.now(),
      isRealMinecraft: false
    };
  }
}

module.exports = { getAuthUrl, getTokenFromCode, getMinecraftProfile };