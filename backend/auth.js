const { Authflow } = require('prismarine-auth');
const express = require('express');

// يجب أن يكون هذا هو عنوان URL للتطبيق نفسه، وليس رابط الإعادة
const flow = new Authflow(process.env.CLIENT_ID || '', './ms-cache', {
    authTitle: 'Minecraft',
    deviceType: 'Win32',
    flow: 'msal',
    redirectUri: process.env.REDIRECT_URI
});

async function getAuthUrl() {
    // هذه الوظيفة قد لا تكون مستخدمة بهذه الطريقة مع Authflow
    return { url: '/auth/callback' };
}

async function getTokenFromCode(code) {
    // لا حاجة لهذه الوظيفة بعد الآن
    return { accessToken: null };
}

async function getMinecraftProfile(accessToken) {
    try {
        const userIdentifier = await flow.getMinecraftJavaToken();
        const uuid = userIdentifier.profile.id;
        const username = userIdentifier.profile.name;
        const minecraftToken = userIdentifier.token;

        console.log(`✅ ماينكرافت حقيقي: ${username} (UUID: ${uuid})`);
        return {
            uuid: uuid,
            username: username,
            minecraftToken: minecraftToken,
            isRealMinecraft: true
        };
    } catch (error) {
        console.error('❌ فشل الحصول على بيانات ماينكرافت:', error.message);
        return {
            uuid: 'fallback-' + Math.random().toString(36).substring(2, 10),
            username: 'MinecraftUser',
            minecraftToken: 'fallback-token',
            isRealMinecraft: false
        };
    }
}

module.exports = { getAuthUrl, getTokenFromCode, getMinecraftProfile };