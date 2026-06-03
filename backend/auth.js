const { ConfidentialClientApplication } = require('@azure/msal-node');
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
    // 1. الحصول على معلومات مستخدم Microsoft
    const graphResponse = await axios.get('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const email = graphResponse.data.userPrincipalName;
    const username = graphResponse.data.displayName || email.split('@')[0];

    // 2. مصادقة Xbox Live (هذه الخطوة تحتاج مكتبة إضافية)
    // حالياً، نستخدم معرفاً مؤقتاً للتجربة
    console.log(`✅ User info: ${username}`);
    console.log(`⚠️ ملاحظة: يستخدم UUID مؤقتاً لأن Xbox Live auth يتطلب مكتبة إضافية.`);
    
    return {
      uuid: 'temp-' + Math.random().toString(36).substring(2, 15),
      username: username,
      minecraftToken: 'temp-token-' + Date.now()
    };
  } catch (error) {
    console.error('Failed to get user info:', error.message);
    return {
      uuid: 'fallback-' + Math.random().toString(36).substring(2, 10),
      username: 'MinecraftUser',
      minecraftToken: 'fallback-token'
    };
  }
}

module.exports = { getAuthUrl, getTokenFromCode, getMinecraftProfile };