// crypto-service.js - Service de cryptographie hybride pour Node.js compatible Flutter

import { generateKeyPair, randomBytes, createCipheriv, createDecipheriv, publicEncrypt, constants, privateDecrypt, pbkdf2Sync, createHash, createPublicKey } from 'crypto';
import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import {fromBER} from 'asn1js';


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
            const __dirname = dirname(fileURLToPath(import.meta.url));
            this.keysDir = join(__dirname, 'keys');

            this.serverKeyPair = await this.loadServerKeys();
            global.serverKeyPair = this.serverKeyPair;
           // console.log('Clés serveur chargées avec succès.');
         //   console.log(convertPEMToFlutterFormat(this.serverKeyPair.publicKey) , " ==> server public key");
            console.log('Clés serveur chargées.');
        } catch (error) {
            console.log('Génération de nouvelles clés serveur...');
            this.serverKeyPair = await this.generateRSAKeyPair();
            await this.saveServerKeys(this.serverKeyPair);
            global.serverKeyPair = this.serverKeyPair;
            console.log('Nouvelles clés serveur générées et sauvegardées.');
        }
    }

    /**
     * Génère une paire de clés RSA avec les mêmes paramètres que Flutter
     */
    async generateRSAKeyPair() {
        return new Promise((resolve, reject) => {
            generateKeyPair('rsa', {
                modulusLength: 2048,
                publicExponent: 65537, // Même exposant que Flutter
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
     * Convertit une clé publique PEM vers le format Flutter (modulus:exponent)
     */
    convertPEMToFlutterFormat(pemPublicKey) {
         return this.extractRSAParametersManual(pemPublicKey);
    }

    /**
     * Méthode fallback pour extraire les paramètres RSA manuellement
     */
    extractRSAParametersManual(pemPublicKey) {
        // Cette méthode utilise une approche plus directe avec les APIs crypto de Node.js
        
        try {
            // Créer un objet clé publique
            const keyObject = crypto.createPublicKey({
                key: pemPublicKey,
                format: 'pem',
                type: 'spki'
            });
            
            // Exporter au format JWK pour accéder aux paramètres
            const jwk = keyObject.export({ format: 'jwk' });
            
            if (jwk.n && jwk.e) {
                // Convertir de base64url vers BigInt
                const modulus = this.base64urlToBigInt(jwk.n);
                const exponent = this.base64urlToBigInt(jwk.e);
                
                const flutterFormat = `${modulus.toString()}:${exponent.toString()}`;
                return Buffer.from(flutterFormat, 'utf8').toString('base64');
            }
            
            throw new Error('Impossible d\'extraire les paramètres RSA');
            
        } catch (error) {
            console.error('Erreur extraction manuelle:', error);
            // Dernière solution : utiliser les valeurs par défaut
            return;
        }
    }

    /**
     * Convertit base64url vers BigInt
     */
    base64urlToBigInt(base64url) {
        // Convertir base64url vers base64 standard
        let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
        while (base64.length % 4) {
            base64 += '=';
        }
        
        const buffer = Buffer.from(base64, 'base64');
        return this.bufferToBigInt(buffer);
    }

    /**
     * Convertit un Buffer vers BigInt
     */
    bufferToBigInt(buffer) {
        let result = BigInt(0);
        for (let i = 0; i < buffer.length; i++) {
            result = result * BigInt(256) + BigInt(buffer[i]);
        }
        return result;
    }

 

    /**
     * Convertit le format Flutter vers PEM pour utilisation côté serveur
     */
    convertFlutterFormatToPEM(flutterFormatKey) {
        try {
            // Décoder le format Flutter
            const decoded = Buffer.from(flutterFormatKey, 'base64').toString('utf8');
            const [modulus, exponent] = decoded.split(':');
            
            // Créer la structure ASN.1 pour une clé publique RSA
            // Cette partie nécessiterait une implémentation ASN.1 complète
            // Pour simplifier, nous utilisons les APIs Node.js
            
            const modulusBigInt = BigInt(modulus);
            const exponentBigInt = BigInt(exponent);
            
            // Convertir vers JWK puis vers PEM
            const jwk = {
                kty: 'RSA',
                n: this.bigIntToBase64url(modulusBigInt),
                e: this.bigIntToBase64url(exponentBigInt),
                use: 'enc'
            };
            
            const keyObject = crypto.createPublicKey({ key: jwk, format: 'jwk' });
            return keyObject.export({ type: 'spki', format: 'pem' });
            
        } catch (error) {
            console.error('Erreur conversion Flutter vers PEM:', error);
            throw error;
        }
    }

    /**
     * Convertit BigInt vers base64url
     */
    bigIntToBase64url(bigint) {
        const buffer = this.bigIntToBuffer(bigint);
        const base64 = buffer.toString('base64');
        return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    }

    /**
     * Convertit BigInt vers Buffer
     */
    bigIntToBuffer(bigint) {
        const hex = bigint.toString(16);
        const paddedHex = hex.length % 2 ? '0' + hex : hex;
        return Buffer.from(paddedHex, 'hex');
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
     * Chiffre un message avec AES - Compatible Flutter
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
     * Déchiffre un message avec AES - Compatible Flutter
     */
    decryptWithAES(encryptedMessage, key, iv) {
        const decipher = createDecipheriv('aes-256-cbc', key, iv);
        decipher.setAutoPadding(true);

        let decrypted = decipher.update(encryptedMessage, 'base64', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    }

    /**
     * Chiffre une clé AES avec RSA - Utilise OAEP comme Flutter
     */
    encryptAESKeyWithRSA(aesKey, publicKey) {
        return publicEncrypt({
            key: publicKey,
            padding: constants.RSA_PKCS1_OAEP_PADDING, // Même padding que Flutter
            oaepHash: 'sha1' // Flutter utilise SHA-1 par défaut avec OAEP
        }, aesKey).toString('base64');
    }

    /**
     * Déchiffre une clé AES avec RSA - Utilise OAEP comme Flutter
     */
    decryptAESKeyWithRSA(encryptedAESKey, privateKey) {
        return privateDecrypt({
            key: privateKey,
            padding: constants.RSA_PKCS1_OAEP_PADDING,
            oaepHash: 'sha1' // Même hash que côté Flutter
        }, Buffer.from(encryptedAESKey, 'base64'));
    }

    /**
     * Chiffrement hybride complet - Compatible Flutter
     */
    async hybridEncrypt(message, recipientPublicKey) {
        // Convertir la clé si elle est au format Flutter
        let publicKeyPEM = recipientPublicKey;
     

        const aesKey = this.generateAESKey();
        const iv = this.generateIV();

        const { encryptedMessage } = this.encryptWithAES(message, aesKey, iv);
        const encryptedAESKey = this.encryptAESKeyWithRSA(aesKey, publicKeyPEM);

        return {
            encryptedMessage,
            encryptedAESKey,
            iv: iv.toString('base64'),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Déchiffrement hybride complet - Compatible Flutter
     */
    async hybridDecrypt(encryptedData, recipientPrivateKey) {
        try {
            const aesKey = this.decryptAESKeyWithRSA(
                encryptedData.encryptedAESKey,
                recipientPrivateKey
            );

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
            console.error('Erreur déchiffrement hybride:', error);
            return {
                message: null,
                error: 'Échec du déchiffrement: ' + error.message,
                success: false
            };
        }
    }

    /**
     * Génère un hash de vérification pour les clés publiques - Compatible Flutter
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
     * Sauvegarde les clés serveur avec format Flutter
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
        return { publicKey : this.convertPEMToFlutterFormat(publicKey), privateKey };
    }

    /**
     * Retourne la clé publique du serveur au format PEM
     */
    getServerPublicKey() {
        return (global.serverKeyPair || this.serverKeyPair)?.publicKey;
    }

    /**
     * Retourne la clé publique du serveur au format Flutter
     */
   

    /**
     * Crée une sauvegarde chiffrée de l'historique
     */
    async createBackup(chatHistory, userPassword) {
        const backupKey = this.generateAESKey();
        const iv = this.generateIV();

        const encryptedHistory = this.encryptWithAES(
            JSON.stringify(chatHistory),
            backupKey,
            iv
        );

        const salt = randomBytes(32);
        const derivedKey = pbkdf2Sync(userPassword, salt, 100000, 32, 'sha256');

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
            const salt = Buffer.from(backupData.salt, 'base64');
            const derivedKey = pbkdf2Sync(userPassword, salt, 100000, 32, 'sha256');

            const decryptedBackupKey = this.decryptWithAES(
                backupData.encryptedBackupKey,
                derivedKey,
                Buffer.from(backupData.backupKeyIV, 'base64')
            );

            const backupKey = Buffer.from(decryptedBackupKey, 'base64');

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
}

export default CryptoService;