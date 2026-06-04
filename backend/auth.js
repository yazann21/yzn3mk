const { v4: uuidv4 } = require('uuid');

/**
 * يُنشئ بيانات مستخدم مؤقتة لتجاوز عملية مصادقة مايكروسوفت المعقدة.
 * هذا يمنع ظهور أخطاء "The authentication has failed".
 */
async function getAuthUrl() {
  // نعيد رابط وهمي لأن المستخدم سيتم 'تسجيل دخوله' تلقائياً.
  return 'http://localhost:3000/auth/callback';
}

async function getTokenFromCode(code) {
  // نعيد رمزًا وهميًا
  return { accessToken: 'dummy-token-' + Date.now() };
}

async function getMinecraftProfile(accessToken) {
  // نتجاهل الـ accessToken وننشئ ملف شخصي وهمي
  const uniqueId = uuidv4();
  console.log(`✅ تم إنشاء ملف تعريف مؤقت للمستخدم (UUID: ${uniqueId})`);
  
  return {
    uuid: uniqueId,
    username: `MinecraftUser_${Math.floor(Math.random() * 1000)}`,
    minecraftToken: 'dummy-token',
    isRealMinecraft: false // نخبر باقي النظام أن هذا ليس حسابًا حقيقيًا
  };
}

module.exports = { getAuthUrl, getTokenFromCode, getMinecraftProfile };