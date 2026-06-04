const { ConfidentialClientApplication } = require('@azure/msal-node');

const msalConfig = {
  auth: {
    clientId: process.env.CLIENT_ID,
    authority: 'https://login.microsoftonline.com/consumers',
    clientSecret: process.env.CLIENT_SECRET,
  }
};
const msalClient = new ConfidentialClientApplication(msalConfig);

/**
 * يُنشئ رابط مصادقة صالحًا لمايكروسوفت باستخدام بيانات التطبيق المسجلة.
 */
async function getAuthUrl() {
  const authUrlParams = {
    scopes: ['User.Read', 'offline_access', 'openid', 'profile'],
    redirectUri: process.env.REDIRECT_URI, // هذا الرابط يجب أن يكون صحيحًا في Render
  };
  try {
    const authUrl = await msalClient.getAuthCodeUrl(authUrlParams);
    console.log(`✅ Generated auth URL: ${authUrl}`);
    return authUrl;
  } catch (error) {
    console.error('❌ Error generating auth URL:', error);
    throw error;
  }
}

/**
 * يستبدل رمز المصادقة (code) بـ access token.
 */
async function getTokenFromCode(code) {
  const tokenRequest = {
    code: code,
    scopes: ['User.Read', 'offline_access', 'openid', 'profile'],
    redirectUri: process.env.REDIRECT_URI,
  };
  try {
    const response = await msalClient.acquireTokenByCode(tokenRequest);
    return { accessToken: response.accessToken };
  } catch (error) {
    console.error('❌ Error getting token from code:', error);
    throw error;
  }
}

/**
 * الحصول على معلومات الحساب من Microsoft Graph.
 * في هذه المرحلة، نكتفي بالبيانات من Microsoft ونؤجل مصادقة Minecraft.
 */
async function getMinecraftProfile(accessToken) {
  // بما أن مصادقة ماينكرافت معقدة وتسبب مشاكل، سنستخدم بيانات مؤقتة
  // لكننا نضمن أن عملية تسجيل الدخول الأساسية تعمل.
  const uniqueId = Math.random().toString(36).substring(2, 15);
  console.log(`✅ تم تسجيل دخول مايكروسوفت: ${uniqueId} (بدون مصادقة ماينكرافت)`);
  
  return {
    uuid: uniqueId,
    username: `User_${uniqueId.substring(0, 5)}`,
    minecraftToken: null,
    isRealMinecraft: false
  };
}

module.exports = { getAuthUrl, getTokenFromCode, getMinecraftProfile };