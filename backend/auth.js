const bcrypt = require('bcrypt');
const crypto = require('crypto');

// محاكاة تخزين رموز التحقق مؤقتاً (في الإنتاج، استخدم قاعدة بيانات)
const verificationCodes = new Map(); // key: email, value: { code, expires }

/**
 * توليد رمز تحقق عشوائي مكون من 6 أرقام
 */
function generateVerificationCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * إرسال رمز التحقق إلى البريد الإلكتروني (وهمي حالياً، يمكن استبداله بـ nodemailer)
 * في هذه المرحلة، سنقوم فقط بطباعة الرمز في سجل الخادم وعرضه للمستخدم
 */
async function sendVerificationCode(email, code) {
    console.log(`📧 Verification code for ${email}: ${code}`);
    // في المستقبل، يمكن إضافة إرسال بريد حقيقي عبر nodemailer أو sendgrid
    return true;
}

/**
 * طلب رمز تحقق لتسجيل حساب جديد
 * @returns {Promise<{success: boolean, message?: string}>}
 */
async function requestVerificationCode(email) {
    if (!email) return { success: false, message: 'البريد الإلكتروني مطلوب' };
    
    const code = generateVerificationCode();
    const expires = Date.now() + 10 * 60 * 1000; // 10 دقائق صلاحية
    verificationCodes.set(email, { code, expires });
    
    const sent = await sendVerificationCode(email, code);
    if (sent) {
        return { success: true, message: 'تم إرسال رمز التحقق إلى بريدك الإلكتروني' };
    } else {
        return { success: false, message: 'فشل إرسال رمز التحقق' };
    }
}

/**
 * التحقق من صحة الرمز المدخل
 */
function verifyCode(email, code) {
    const record = verificationCodes.get(email);
    if (!record) return false;
    if (record.code !== code) return false;
    if (Date.now() > record.expires) return false;
    verificationCodes.delete(email);
    return true;
}

/**
 * إنشاء مستخدم جديد (بدون مصادقة مايكروسوفت)
 * ملاحظة: هذه الدالة تستخدم فقط في مسار /api/register
 * لا يتم استخدامها في مصادقة OAuth
 */
async function registerUser(username, email, password, verificationCode) {
    if (!verifyCode(email, verificationCode)) {
        return { success: false, message: 'رمز التحقق غير صحيح أو منتهي الصلاحية' };
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    // هذه الدالة سيتم استدعاؤها من server.js حيث يتم التعامل مع قاعدة البيانات
    return { success: true, hashedPassword };
}

/**
 * هذه الدوال الثلاث التالية مطلوبة للتوافق مع بقية النظام
 * لكننا لن نستخدمها في المصادقة المحلية (تبقى لإرضاء المتطلبات)
 */
async function getAuthUrl() {
    throw new Error('Microsoft authentication is disabled. Use local login.');
}

async function getTokenFromCode(code) {
    throw new Error('Microsoft authentication is disabled.');
}

async function getMinecraftProfile(accessToken) {
    throw new Error('Microsoft authentication is disabled.');
}

module.exports = {
    // دوال المصادقة المحلية
    requestVerificationCode,
    verifyCode,
    registerUser,
    // للتوافق مع النظام القديم (لكن لا تستخدم)
    getAuthUrl,
    getTokenFromCode,
    getMinecraftProfile
};