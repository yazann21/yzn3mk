// تشفير refresh token - نسخة مبسطة
function encryptToken(token) {
  if (!token) return null;
  try {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(process.env.SESSION_SECRET || 'default-secret-key-32-bytes-long!!!', 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return `${iv.toString('hex')}:${encrypted}`;
  } catch (error) {
    console.error('Encryption error:', error.message);
    return null;
  }
}

function decryptToken(encryptedData) {
  if (!encryptedData) return null;
  try {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(process.env.SESSION_SECRET || 'default-secret-key-32-bytes-long!!!', 'salt', 32);
    const [ivHex, encrypted] = encryptedData.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error.message);
    return null;
  }
}