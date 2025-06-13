import crypto from 'crypto';

const SECRET_KEY = crypto.createHash('sha256').update(process.env.FILE_SECRET).digest(); 
const ALGORITHM = 'aes-256-cbc';

export function encryptChunk(buffer, fileId) {
    const iv = crypto.createHash('md5').update(fileId).digest(); 
    const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, iv);
    return Buffer.concat([cipher.update(buffer), cipher.final()]);
}

export function decryptChunk(buffer, fileId) {
    const iv = crypto.createHash('md5').update(fileId).digest();
    const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, iv);
    return Buffer.concat([decipher.update(buffer), decipher.final()]);
}
