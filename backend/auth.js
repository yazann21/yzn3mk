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

    // 2. حالياً نستخدم معرفاً مؤقتاً للتجربة (لأن المصادقة الكاملة لـ Xbox Live تحتاج مكتبة منفصلة)
    console.log(`✅ مستخدم مايكروسوفت: ${username}`);
    console.log(`⚠️ ملاحظة: يستخدم UUID مؤقتاً للبوتات. للدخول إلى سيرفرات مثل Hypixel، تحتاج إلى تفعيل مصادقة Xbox Live الكاملة.`);
    
    return {
      uuid: 'temp-' + Math.random().toString(36).substring(2, 15),
      username: username,
      minecraftToken: 'temp-token-' + Date.now()
    };
  } catch (error) {
    console.error('❌ فشل الحصول على بيانات المستخدم:', error.message);
    return {
      uuid: 'fallback-' + Math.random().toString(36).substring(2, 10),
      username: 'MinecraftUser',
      minecraftToken: 'fallback-token'
    };
  }
}

module.exports = { getAuthUrl, getTokenFromCode, getMinecraftProfile };