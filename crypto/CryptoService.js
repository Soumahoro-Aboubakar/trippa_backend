// crypto-service.js - Service de cryptographie hybride pour Node.js
import { generateKeyPair, randomBytes, createCipheriv, createDecipheriv, publicEncrypt, constants, privateDecrypt, pbkdf2Sync, createHash } from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';


class CryptoService {
    constructor() {
        this.serverKeyPair = null;
       this.keysReady = this.initializeServerKeys();
    }

    /**
     * Initialise les clés du serveur au démarrage
     */
  async initializeServerKeys() {
        try {
            // Correction pour __dirname avec ES modules
            const __dirname = dirname(fileURLToPath(import.meta.url));
            this.keysDir = join(__dirname, 'keys');

            // Tenter de charger les clés existantes
            this.serverKeyPair = await this.loadServerKeys();
            global.serverKeyPair = this.serverKeyPair; // Rendre accessible globalement
            console.log('Clés serveur chargées.');
        } catch (error) {
            // Générer de nouvelles clés si elles n'existent pas
            console.log('Génération de nouvelles clés serveur...');
            this.serverKeyPair = await this.generateRSAKeyPair();
            await this.saveServerKeys(this.serverKeyPair);
            global.serverKeyPair = this.serverKeyPair; // Rendre accessible globalement
            console.log('Nouvelles clés serveur générées et sauvegardées.');
        }
    }

    /**
     * Génère une paire de clés RSA
     */
    async generateRSAKeyPair() {
        return new Promise((resolve, reject) => {
            generateKeyPair('rsa', {
                modulusLength: 2048,
                publicKeyEncoding: {
                    type: 'spki',
                    format: 'pem'
                },
                privateKeyEncoding: {
                    type: 'pkcs8',
                    format: 'pem'
                }
            }, (err, publicKey, privateKey) => {
                if (err) reject(err);
                else resolve({ publicKey, privateKey });
            });
        });
    }

    /**
     * Génère une clé AES aléatoire
     */
    generateAESKey() {
        return randomBytes(32); // 256 bits
    }

    /**
     * Génère un IV aléatoire pour AES
     */
    generateIV() {
        return randomBytes(16); // 128 bits
    }

    /**
     * Chiffre un message avec AES
     */
 encryptWithAES(message, key, iv) {
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    cipher.setAutoPadding(true);

    let encrypted = cipher.update(message, 'utf8', 'base64');
    encrypted += cipher.final('base64');

    return {
        encryptedMessage: encrypted,
        iv: iv.toString('base64')
    };
}

    /**
     * Déchiffre un message avec AES
     */
 decryptWithAES(encryptedMessage, key, iv) {
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    decipher.setAutoPadding(true);

    let decrypted = decipher.update(encryptedMessage, 'base64', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}

    /**
     * Chiffre une clé AES avec RSA
     */
 async   encryptAESKeyWithRSA(aesKey, publicKey) {
        return publicEncrypt({
            key: publicKey,
            padding: constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256'
        }, aesKey).toString('base64');
    }

    /**
     * Déchiffre une clé AES avec RSA
     */
 async   decryptAESKeyWithRSA(encryptedAESKey, privateKey) {
        return privateDecrypt({
            key: privateKey,
            padding: constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha256'
        }, Buffer.from(encryptedAESKey, 'base64'));
    }

    /**
     * Chiffrement hybride complet d'un message
     */
 async    hybridEncrypt(message, recipientPublicKey) {
        // 1. Générer une clé AES aléatoire
        const aesKey = this.generateAESKey();
        const iv = this.generateIV();

        // 2. Chiffrer le message avec AES
        const { encryptedMessage } = this.encryptWithAES(message, aesKey, iv);

        // 3. Chiffrer la clé AES avec la clé publique RSA du destinataire
        const encryptedAESKey = this.encryptAESKeyWithRSA(aesKey, recipientPublicKey);

        return {
            encryptedMessage,
            encryptedAESKey,
            iv: iv.toString('base64'),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Déchiffrement hybride complet d'un message
     */
  async  hybridDecrypt(encryptedData, recipientPrivateKey) {
        try {
            // 1. Déchiffrer la clé AES avec la clé privée RSA
            const aesKey = this.decryptAESKeyWithRSA(
                encryptedData.encryptedAESKey,
                recipientPrivateKey
            );

            // 2. Déchiffrer le message avec la clé AES
            const decryptedMessage = this.decryptWithAES(
                encryptedData.encryptedMessage,
                aesKey,
                Buffer.from(encryptedData.iv, 'base64')
            );

            return {
                message: decryptedMessage,
                timestamp: encryptedData.timestamp,
                success: true
            };
        } catch (error) {
            return {
                message: null,
                error: 'Échec du déchiffrement',
                success: false
            };
        }
    }

    /**
     * Crée une sauvegarde chiffrée de l'historique
     */
    async createBackup(chatHistory, userPassword) {
        // Générer une clé de sauvegarde
        const backupKey = this.generateAESKey();
        const iv = this.generateIV();

        // Chiffrer l'historique avec la clé de sauvegarde
        const encryptedHistory = this.encryptWithAES(
            JSON.stringify(chatHistory),
            backupKey,
            iv
        );

        // Créer une clé dérivée du mot de passe utilisateur
        const salt = randomBytes(32);
        const derivedKey = pbkdf2Sync(userPassword, salt, 100000, 32, 'sha256');

        // Chiffrer la clé de sauvegarde avec la clé dérivée
        const backupKeyIV = this.generateIV();
        const encryptedBackupKey = this.encryptWithAES(
            backupKey.toString('base64'),
            derivedKey,
            backupKeyIV
        );

        return {
            encryptedHistory: encryptedHistory.encryptedMessage,
            historyIV: encryptedHistory.iv,
            encryptedBackupKey: encryptedBackupKey.encryptedMessage,
            backupKeyIV: encryptedBackupKey.iv,
            salt: salt.toString('base64'),
            createdAt: new Date().toISOString()
        };
    }

    /**
     * Restaure une sauvegarde chiffrée
     */
    async restoreBackup(backupData, userPassword) {
        try {
            // Reconstituer la clé dérivée du mot de passe
            const salt = Buffer.from(backupData.salt, 'base64');
            const derivedKey = pbkdf2Sync(userPassword, salt, 100000, 32, 'sha256');

            // Déchiffrer la clé de sauvegarde
            const decryptedBackupKey = this.decryptWithAES(
                backupData.encryptedBackupKey,
                derivedKey,
                Buffer.from(backupData.backupKeyIV, 'base64')
            );

            const backupKey = Buffer.from(decryptedBackupKey, 'base64');

            // Déchiffrer l'historique
            const decryptedHistory = this.decryptWithAES(
                backupData.encryptedHistory,
                backupKey,
                Buffer.from(backupData.historyIV, 'base64')
            );

            return {
                chatHistory: JSON.parse(decryptedHistory),
                success: true
            };
        } catch (error) {
            return {
                chatHistory: null,
                error: 'Mot de passe incorrect ou sauvegarde corrompue',
                success: false
            };
        }
    }

    /**
     * Génère un hash de vérification pour les clés publiques
     */
    generateKeyFingerprint(publicKey) {
        return createHash('sha256')
            .update(publicKey)
            .digest('hex')
            .substring(0, 16)
            .toUpperCase()
            .match(/.{4}/g)
            .join(' ');
    }

    /**
     * Sauvegarde les clés serveur
     */
    async saveServerKeys(keyPair) {
        await fs.mkdir(this.keysDir, { recursive: true });
        await fs.writeFile(join(this.keysDir, 'server_public.pem'), keyPair.publicKey);
        await fs.writeFile(join(this.keysDir, 'server_private.pem'), keyPair.privateKey);
    }

    /**
     * Charge les clés serveur
     */
 async loadServerKeys() {
        const publicKey = await fs.readFile(join(this.keysDir, 'server_public.pem'), 'utf8');
        const privateKey = await fs.readFile(join(this.keysDir, 'server_private.pem'), 'utf8');
        return { publicKey, privateKey };
    }
    /**
     * Retourne la clé publique du serveur
     */
   getServerPublicKey() {
        return (global.serverKeyPair || this.serverKeyPair)?.publicKey;
    }
}

export default CryptoService;