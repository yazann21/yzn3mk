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
    const graphResponse = await axios.get('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const email = graphResponse.data.userPrincipalName;
    const username = graphResponse.data.displayName || email.split('@')[0];
    
    // محاولة الحصول على بروفايل ماينكرافت الحقيقي
    let minecraftUuid = null;
    let minecraftUsername = null;
    let minecraftToken = null;
    
    try {
      // محاولة مصادقة Xbox (هذه تحتاج مكتبة إضافية)
      // لكننا سنحاول باستخدام API مباشر بسيط
      const xboxResponse = await axios.post('https://user.auth.xboxlive.com/user/authenticate', {
        Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: accessToken },
        RelyingParty: 'http://auth.xboxlive.com',
        TokenType: 'JWT'
      });
      const xboxToken = xboxResponse.data.Token;
      
      const xstsResponse = await axios.post('https://xsts.auth.xboxlive.com/xsts/authorize', {
        Properties: { SandboxId: 'RETAIL', UserTokens: [xboxToken] },
        RelyingParty: 'rp://api.minecraftservices.com/',
        TokenType: 'JWT'
      });
      const userHash = xstsResponse.data.DisplayClaims.xui[0].uhs;
      const xstsToken = xstsResponse.data.Token;
      
      const minecraftAuthResponse = await axios.post('https://api.minecraftservices.com/authentication/login_with_xbox', {
        identityToken: `XBL3.0 x=${userHash};${xstsToken}`
      });
      minecraftToken = minecraftAuthResponse.data.access_token;
      
      const profileResponse = await axios.get('https://api.minecraftservices.com/minecraft/profile', {
        headers: { Authorization: `Bearer ${minecraftToken}` }
      });
      minecraftUuid = profileResponse.data.id;
      minecraftUsername = profileResponse.data.name;
      
      console.log(`✅ ماينكرافت حقيقي: ${minecraftUsername} (UUID: ${minecraftUuid})`);
    } catch (mcError) {
      console.log(`⚠️ فشل الحصول على بروفايل ماينكرافت: ${mcError.message}`);
      minecraftUuid = 'temp-' + Math.random().toString(36).substring(2, 15);
      minecraftUsername = username;
      minecraftToken = 'temp-token-' + Date.now();
    }
    
    return {
      uuid: minecraftUuid,
      username: minecraftUsername,
      minecraftToken: minecraftToken,
      isRealMinecraft: minecraftUuid && !minecraftUuid.startsWith('temp')
    };
  } catch (error) {
    console.error('❌ فشل الحصول على بيانات المستخدم:', error.message);
    return {
      uuid: 'fallback-' + Math.random().toString(36).substring(2, 10),
      username: 'MinecraftUser',
      minecraftToken: 'fallback-token',
      isRealMinecraft: false
    };
  }
}

function isRealMinecraftAccount(uuid) {
  return uuid && !uuid.startsWith('temp') && !uuid.startsWith('fallback');
}

module.exports = { getAuthUrl, getTokenFromCode, getMinecraftProfile, isRealMinecraftAccount };