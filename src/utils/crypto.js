const crypto = require('crypto');

// Derive 32-byte master key using SHA-256
const getMasterKey = () => {
  const secret =
    process.env.META_ENCRYPTION_KEY ||
    process.env.JWT_SECRET ||
    'estateflow_meta_default_secure_fallback_key_2026';
  return crypto.createHash('sha256').update(secret).digest();
};

/**
 * Encrypt plain text using AES-256-GCM with authentication tag
 * Returns format: "ivHex:authTagHex:encryptedHex"
 */
const encrypt = (plainText) => {
  if (!plainText || typeof plainText !== 'string') {
    return '';
  }
  const key = getMasterKey();
  const iv = crypto.randomBytes(12); // Standard 12 bytes for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const authTag = cipher.getAuthTag().toString('hex');

  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
};

/**
 * Decrypt string encrypted with encrypt()
 */
const decrypt = (encryptedString) => {
  if (!encryptedString || typeof encryptedString !== 'string') {
    return '';
  }

  const parts = encryptedString.split(':');
  if (parts.length !== 3) {
    // If not matching format, return empty or plain if unencrypted legacy
    return '';
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = getMasterKey();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
};

/**
 * Verify Meta Webhook SHA256 signature against incoming raw payload
 * Header format: sha256=<hex_hash>
 */
const verifyMetaSignature = (rawPayload, signatureHeader, appSecret) => {
  if (!signatureHeader || !appSecret) {
    return false;
  }

  const parts = signatureHeader.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256') {
    return false;
  }

  const receivedHash = parts[1];
  const expectedHash = crypto
    .createHmac('sha256', appSecret)
    .update(typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload))
    .digest('hex');

  try {
    const receivedBuffer = Buffer.from(receivedHash, 'hex');
    const expectedBuffer = Buffer.from(expectedHash, 'hex');
    if (receivedBuffer.length !== expectedBuffer.length) {
      return false;
    }
    return crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
  } catch (err) {
    return false;
  }
};

/**
 * Generate secure OAuth CSRF state token tied to organization
 */
const generateOAuthState = (organizationId, userId) => {
  const payload = `${organizationId}:${userId}:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`;
  const hmac = crypto.createHmac('sha256', getMasterKey()).update(payload).digest('hex');
  return Buffer.from(`${payload}:${hmac}`).toString('base64url');
};

/**
 * Validate OAuth CSRF state token
 */
const verifyOAuthState = (stateString) => {
  try {
    const decoded = Buffer.from(stateString, 'base64url').toString('utf8');
    const parts = decoded.split(':');
    if (parts.length !== 5) {
      return null;
    }
    const [orgId, userId, timestamp, salt, receivedHmac] = parts;
    const payload = `${orgId}:${userId}:${timestamp}:${salt}`;
    const expectedHmac = crypto.createHmac('sha256', getMasterKey()).update(payload).digest('hex');

    if (receivedHmac !== expectedHmac) {
      return null;
    }

    // Check expiration (max 30 minutes for OAuth state)
    const age = Date.now() - parseInt(timestamp, 10);
    if (age > 30 * 60 * 1000) {
      return null;
    }

    return { organizationId: orgId, userId };
  } catch (err) {
    return null;
  }
};

module.exports = {
  encrypt,
  decrypt,
  verifyMetaSignature,
  generateOAuthState,
  verifyOAuthState,
};
